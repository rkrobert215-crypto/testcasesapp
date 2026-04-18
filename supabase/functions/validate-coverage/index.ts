import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGenerationMode, getGenerationModeProfile } from "../_shared/generationMode.ts";
import { computeRequestCacheKey, getCachedRequest, setCachedRequest } from "../_shared/requestCache.ts";
import { generateReviewedStructuredData } from "../_shared/reviewedStructuredGeneration.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { input, inputType, imagesBase64, imageBase64, testCases, aiSettings } = await req.json();
    const images: string[] = imagesBase64 || (imageBase64 ? [imageBase64] : []);
    const generationMode = getGenerationMode(aiSettings);
    const generationProfile = getGenerationModeProfile(generationMode);
    
    if (!testCases || testCases.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No test cases to validate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cacheKey = images.length === 0
      ? await computeRequestCacheKey('validate-coverage', aiSettings, {
          input: input || '',
          inputType: inputType || '',
          testCases,
        })
      : null;
    if (cacheKey) {
      const cached = getCachedRequest<{
        coverageScore: number;
        summary: string;
        coveredAreas: string[];
        missingScenarios: Array<{ scenario: string; priority: 'High' | 'Medium' | 'Low'; type: 'Positive' | 'Negative' }>;
        recommendations: string[];
      }>(cacheKey);
      if (cached) {
        return new Response(
          JSON.stringify(cached),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`Validating coverage for ${testCases.length} test cases`);

    // Build the validation prompt
    const userContent: Array<{ type: 'text'; text: string } | { type: 'image'; dataUrl: string }> = [];
    
    let validationPrompt = `You are a senior QA engineer reviewing test case coverage.

TASK: Analyze the given requirement/input and the generated test cases. Identify if there are any GAPS or MISSING scenarios.

GENERATION STYLE MODE: ${generationProfile.label}

REQUIREMENT/INPUT:
${input || 'No text input provided'}

GENERATED TEST CASES (${testCases.length} total):
${(testCases as Array<{ type?: string; testCase?: string }>).map((testCase, index: number) => `${index + 1}. [${testCase.type ?? 'Unknown'}] ${testCase.testCase ?? 'Untitled test case'}`).join('\n')}

`;

    if (images.length > 0) {
      validationPrompt += `\nI've also attached ${images.length} UI screenshot(s)/mockup(s) that were used for generating these test cases. Check if all UI elements are covered.`;
    }

    validationPrompt += `\n\nStyle guidance:\n${generationProfile.coveragePromptLines.map((line) => `- ${line}`).join('\n')}`;

    userContent.push({ type: 'text', text: validationPrompt });
    
    for (const img of images) {
      userContent.push({ type: 'image', dataUrl: img });
    }

    const parsed = await generateReviewedStructuredData<{
      coverageScore: number;
      summary: string;
      coveredAreas: string[];
      missingScenarios: Array<{ scenario: string; priority: 'High' | 'Medium' | 'Low'; type: 'Positive' | 'Negative' }>;
      recommendations: string[];
    }>({
      aiSettings,
      artifactLabel: 'coverage analysis report',
      featureName: 'validate-coverage',
      systemPrompt: `You are a senior QA engineer validating test coverage. Analyze the requirement and test cases to identify gaps.

Be thorough but practical. Focus on ACTUAL missing scenarios, not minor variations.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.coveragePromptLines.map((line) => `- ${line}`).join('\n')}`,
      userParts: userContent,
      output: {
        name: 'return_coverage_analysis',
        description: 'Return the structured coverage analysis result.',
        schema: {
          type: 'object',
          properties: {
            coverageScore: {
              type: 'number',
            },
            summary: {
              type: 'string',
            },
            coveredAreas: {
              type: 'array',
              items: { type: 'string' },
            },
            missingScenarios: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  scenario: { type: 'string' },
                  priority: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                  type: { type: 'string', enum: ['Positive', 'Negative'] },
                },
                required: ['scenario', 'priority', 'type'],
                additionalProperties: false,
              },
            },
            recommendations: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['coverageScore', 'summary', 'coveredAreas', 'missingScenarios', 'recommendations'],
          additionalProperties: false,
        },
      },
      reviewThreshold: generationProfile.reviewThreshold,
      reviewFocusLines: [
        'Check whether the score matches the actual gap severity instead of sounding inflated.',
        'Check whether covered areas, missing scenarios, and recommendations are requirement-driven and not generic filler.',
        'Check whether high-risk and high-priority missing scenarios are surfaced clearly.',
        'Check whether the report would be useful to a senior QA reviewer making next-step decisions.',
      ],
      correctionReminder:
        'Tighten the coverage judgment so the report is honest, risk-aware, and useful for real QA decision-making.',
    });

    console.log(`Coverage score: ${parsed.coverageScore}%, Missing: ${parsed.missingScenarios?.length || 0}`);
    if (cacheKey) {
      setCachedRequest(cacheKey, parsed);
    }
    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in validate-coverage:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

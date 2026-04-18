import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGenerationMode, getGenerationModeProfile } from "../_shared/generationMode.ts";
import { computeRequestCacheKey, getCachedRequest, setCachedRequest } from "../_shared/requestCache.ts";
import { generateReviewedStructuredData } from "../_shared/reviewedStructuredGeneration.ts";
import {
  deduplicateGeneratedTestCases,
  normalizeGeneratedTestCases,
  testCaseCollectionSchema,
} from "../_shared/testCaseSchema.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { files, aiSettings } = await req.json();
    const generationMode = getGenerationMode(aiSettings);
    const generationProfile = getGenerationModeProfile(generationMode);
    const cacheKey = await computeRequestCacheKey('smart-merge-testcases', aiSettings, {
      files: files ?? [],
    });

    if (!files || !Array.isArray(files) || files.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No files provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cached = getCachedRequest<{ testCases: ReturnType<typeof normalizeGeneratedTestCases> }>(cacheKey);
    if (cached) {
      return new Response(
        JSON.stringify(cached),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const allRows: Record<string, string>[] = [];
    files.forEach((fileRows: Record<string, string>[]) => {
      fileRows.forEach((row) => allRows.push(row));
    });

    const testCaseText = allRows.map((row, index) => {
      const parts: string[] = [`--- Test Case ${index + 1} ---`];
      for (const [key, value] of Object.entries(row)) {
        if (value && value.trim()) {
          parts.push(`${key}: ${value}`);
        }
      }
      return parts.join('\n');
    }).join('\n\n');

    const systemPrompt = `You are a senior QA engineer specializing in testcase refinement, deduplication, and enterprise QA formatting.

You will receive test cases from multiple files. Your job is to:
1. Identify duplicates and near-duplicates.
2. Keep unique coverage.
3. Merge overlapping cases into one stronger professional testcase.
4. Normalize the final output into enterprise-ready fields.

RULES:
- Preserve genuinely different scenarios.
- Remove vague or duplicate wording.
- Use practical modules, requirement references where possible, priority, test data, and post-condition fields.
- Expected results must be direct and observable.
- Return a refined, deduplicated, professional testcase suite.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.mergePromptLines.map((line) => `- ${line}`).join('\n')}`;

    const parsed = await generateReviewedStructuredData<{ testCases: unknown[] }>({
      aiSettings,
      artifactLabel: 'merged testcase suite',
      featureName: 'smart-merge-testcases',
      systemPrompt,
      userParts: [
        {
          type: 'text',
          text: [
            `Generation style mode: ${generationProfile.label}`,
            '',
            `I have ${allRows.length} uploaded rows from ${files.length} files. Deduplicate, refine, and normalize them.`,
            '',
            `Style guidance:`,
            ...generationProfile.mergePromptLines.map((line) => `- ${line}`),
            '',
            testCaseText,
          ].join('\n'),
        },
      ],
      output: {
        name: 'return_test_cases',
        description: 'Return the merged and refined test cases.',
        schema: testCaseCollectionSchema as unknown as Record<string, unknown>,
      },
      reviewThreshold: generationProfile.reviewThreshold,
      reviewFocusLines: [
        'Check whether duplicates and near-duplicates were truly consolidated.',
        'Check whether unique business coverage was preserved instead of accidentally removed.',
        'Check whether the final merged rows look normalized, professional, and directly usable by QA teams.',
        'Check whether expected results, priorities, and fields are strong enough for enterprise review.',
      ],
      correctionReminder:
        'Produce a deduplicated, coverage-preserving, enterprise-ready testcase suite with no weak filler rows.',
    });

    const normalized = deduplicateGeneratedTestCases(normalizeGeneratedTestCases(parsed.testCases || []))
      .filter((tc) => tc.testCase && tc.expectedResult);

    console.log(`Merged ${allRows.length} rows into ${normalized.length} refined test cases`);
    setCachedRequest(cacheKey, { testCases: normalized });

    return new Response(
      JSON.stringify({ testCases: normalized }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in smart-merge:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

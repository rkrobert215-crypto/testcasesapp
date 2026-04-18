import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { analyzeRequirementText } from "../_shared/requirementAnalysis.ts";
import { getGenerationMode, getGenerationModeProfile } from "../_shared/generationMode.ts";
import { formatRequirementInsights } from "../_shared/qaPlanningContext.ts";
import { testDataPlanSchema } from "../_shared/qaPlanningSchemas.ts";
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
    const { requirement, aiSettings } = await req.json();
    const trimmedRequirement = String(requirement ?? '').trim();

    if (!trimmedRequirement) {
      return new Response(
        JSON.stringify({ error: 'Missing requirement' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const generationMode = getGenerationMode(aiSettings);
    const generationProfile = getGenerationModeProfile(generationMode);
    const cacheKey = await computeRequestCacheKey('test-data-plan', aiSettings, { requirement: trimmedRequirement });
    const cached = getCachedRequest<unknown>(cacheKey);
    if (cached) {
      return new Response(
        JSON.stringify(cached),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const requirementInsights = await analyzeRequirementText(aiSettings, trimmedRequirement, 'test-data-plan-analysis');

    const parsed = await generateReviewedStructuredData({
      aiSettings,
      artifactLabel: 'test data plan',
      featureName: 'test-data-plan',
      systemPrompt: `You are a senior QA engineer designing a feature-specific test data plan.

Your job:
- Identify the data categories needed for this feature.
- Propose realistic datasets for happy path, negative, and edge testing.
- Explain why each dataset is needed.
- Mention useful preconditions and environment/privacy notes.

STRICT RULES:
- Keep the data plan tied to the requirement.
- Suggest realistic manual testing data, not fake filler.
- Include valid, invalid, and edge-oriented examples where relevant.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.testDataPromptLines.map((line) => `- ${line}`).join('\n')}`,
      userParts: [
        {
          type: 'text',
          text: [
            `Requirement:`,
            trimmedRequirement,
            ``,
            formatRequirementInsights(requirementInsights),
            ``,
            `Create a practical test data plan for this requirement.`,
          ].join('\n'),
        },
      ],
      output: {
        name: 'return_test_data_plan',
        description: 'Return a structured test data plan.',
        schema: testDataPlanSchema as unknown as Record<string, unknown>,
      },
      reviewThreshold: generationProfile.reviewThreshold,
      reviewFocusLines: [
        'Check whether the datasets are realistic and useful for real manual execution.',
        'Check whether valid, invalid, and edge data coverage is balanced and requirement-driven.',
        'Check whether sample data and preconditions are concrete instead of generic placeholders.',
      ],
      correctionReminder:
        'Make the test data plan more realistic, more risk-aware, and more directly usable by a senior QA team.',
    });

    setCachedRequest(cacheKey, parsed);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in test-data-plan:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

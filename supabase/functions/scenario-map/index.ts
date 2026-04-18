import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { analyzeRequirementText } from "../_shared/requirementAnalysis.ts";
import { getGenerationMode, getGenerationModeProfile } from "../_shared/generationMode.ts";
import { formatRequirementInsights } from "../_shared/qaPlanningContext.ts";
import { scenarioMapSchema } from "../_shared/qaPlanningSchemas.ts";
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
    const cacheKey = await computeRequestCacheKey('scenario-map', aiSettings, { requirement: trimmedRequirement });
    const cached = getCachedRequest<unknown>(cacheKey);
    if (cached) {
      return new Response(
        JSON.stringify(cached),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const requirementInsights = await analyzeRequirementText(aiSettings, trimmedRequirement, 'scenario-map-analysis');

    const parsed = await generateReviewedStructuredData({
      aiSettings,
      artifactLabel: 'scenario map',
      featureName: 'scenario-map',
      systemPrompt: `You are a senior QA engineer mapping a feature into a scenario map before detailed testcase creation.

Your job:
- State the feature goal clearly.
- Break the feature into primary flow, alternate flows, negative flows, and edge cases.
- Identify regression focus areas and high-risk intersections.

STRICT RULES:
- Keep the map tied to the actual requirement.
- Think like a manual tester walking the feature end to end.
- Do not invent unrelated modules or user journeys.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.scenarioPromptLines.map((line) => `- ${line}`).join('\n')}`,
      userParts: [
        {
          type: 'text',
          text: [
            `Requirement:`,
            trimmedRequirement,
            ``,
            formatRequirementInsights(requirementInsights),
            ``,
            `Create a scenario map that a senior QA would use before writing detailed testcases.`,
          ].join('\n'),
        },
      ],
      output: {
        name: 'return_scenario_map',
        description: 'Return a structured scenario map.',
        schema: scenarioMapSchema as unknown as Record<string, unknown>,
      },
      reviewThreshold: generationProfile.reviewThreshold,
      reviewFocusLines: [
        'Check whether the primary, alternate, negative, and edge flows are complete and requirement-driven.',
        'Check whether high-risk intersections and regression focus areas reflect senior-QA thinking.',
        'Check whether the scenario map is practical to convert into detailed testcase design later.',
      ],
      correctionReminder:
        'Make the scenario map more complete, more risk-aware, and more useful as a senior-QA pre-testcase artifact.',
    });

    setCachedRequest(cacheKey, parsed);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in scenario-map:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

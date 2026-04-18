import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { analyzeRequirementText } from "../_shared/requirementAnalysis.ts";
import { getGenerationMode, getGenerationModeProfile } from "../_shared/generationMode.ts";
import { formatRequirementInsights } from "../_shared/qaPlanningContext.ts";
import { traceabilityMatrixSchema } from "../_shared/qaPlanningSchemas.ts";
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
    const { requirement, testCases, aiSettings } = await req.json();
    const trimmedRequirement = String(requirement ?? '').trim();
    const normalizedTestCases = Array.isArray(testCases) ? testCases : [];

    if (!trimmedRequirement) {
      return new Response(
        JSON.stringify({ error: 'Missing requirement' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const generationMode = getGenerationMode(aiSettings);
    const generationProfile = getGenerationModeProfile(generationMode);
    const cacheKey = await computeRequestCacheKey('traceability-matrix', aiSettings, {
      requirement: trimmedRequirement,
      testCases: normalizedTestCases,
    });
    const cached = getCachedRequest<unknown>(cacheKey);
    if (cached) {
      return new Response(
        JSON.stringify(cached),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const requirementInsights = await analyzeRequirementText(aiSettings, trimmedRequirement, 'traceability-matrix-analysis');

    const parsed = await generateReviewedStructuredData({
      aiSettings,
      artifactLabel: 'requirement traceability matrix',
      featureName: 'traceability-matrix',
      systemPrompt: `You are a senior QA lead building a requirement traceability matrix (RTM).

Your job:
- Read the requirement and its structured breakdown.
- Map each requirement point to one RTM row.
- If testcases are provided, judge whether the point appears Covered, Partial, or Missing.
- Suggest the scenario and testcase titles that should cover each point.
- Call out true gaps and next steps.

STRICT RULES:
- Do not invent requirement points not supported by the requirement.
- Make coverage status practical and honest.
- Keep notes concise and useful for a QA reviewer.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.traceabilityPromptLines.map((line) => `- ${line}`).join('\n')}`,
      userParts: [
        {
          type: 'text',
          text: [
            `Requirement:`,
            trimmedRequirement,
            ``,
            formatRequirementInsights(requirementInsights),
            ``,
            `Existing testcases for coverage comparison:`,
            normalizedTestCases.length > 0 ? JSON.stringify(normalizedTestCases, null, 2) : 'No existing testcases provided.',
            ``,
            `Build an RTM with realistic coverage status.`,
          ].join('\n'),
        },
      ],
      output: {
        name: 'return_traceability_matrix',
        description: 'Return a structured requirement traceability matrix.',
        schema: traceabilityMatrixSchema as unknown as Record<string, unknown>,
      },
      reviewThreshold: generationProfile.reviewThreshold,
      reviewFocusLines: [
        'Check whether every row is traceable to a real requirement point.',
        'Check whether coverage status is honest and not over-optimistic.',
        'Check whether gaps and next steps would help a QA lead drive action immediately.',
      ],
      correctionReminder:
        'Make the RTM sharper, more traceable, and more honest about partial or missing coverage.',
    });

    setCachedRequest(cacheKey, parsed);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in traceability-matrix:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

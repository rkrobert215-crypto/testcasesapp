import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { analyzeRequirementText } from "../_shared/requirementAnalysis.ts";
import { getGenerationMode, getGenerationModeProfile } from "../_shared/generationMode.ts";
import { formatRequirementInsights } from "../_shared/qaPlanningContext.ts";
import { testPlanSchema } from "../_shared/qaPlanningSchemas.ts";
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
    const cacheKey = await computeRequestCacheKey('test-plan', aiSettings, { requirement: trimmedRequirement });
    const cached = getCachedRequest<unknown>(cacheKey);
    if (cached) {
      return new Response(
        JSON.stringify(cached),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const requirementInsights = await analyzeRequirementText(aiSettings, trimmedRequirement, 'test-plan-analysis');

    const parsed = await generateReviewedStructuredData({
      aiSettings,
      artifactLabel: 'test plan',
      featureName: 'test-plan',
      systemPrompt: `You are a senior QA lead with 15+ years of experience creating practical, project-ready test plans.

Create a test plan that a real QA team can use, not a generic textbook template.

The output must include:
- title
- objective
- in-scope items
- out-of-scope items
- test types
- environments
- assumptions
- dependencies
- key risks with mitigation
- entry criteria
- exit criteria
- deliverables
- milestones
- roles and responsibilities
- strategy notes

STRICT RULES:
- Base the plan only on the given requirement and its derived business context.
- Keep the scope realistic and requirement-driven.
- Do not invent unrelated modules or delivery processes.
- Make the test types and risks relevant to the feature.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.planningPromptLines.map((line) => `- ${line}`).join('\n')}`,
      userParts: [
        {
          type: 'text',
          text: [
            `Requirement:`,
            trimmedRequirement,
            ``,
            formatRequirementInsights(requirementInsights),
            ``,
            `Build a requirement-specific QA test plan.`,
          ].join('\n'),
        },
      ],
      output: {
        name: 'return_test_plan',
        description: 'Return a structured QA test plan for the requirement.',
        schema: testPlanSchema as unknown as Record<string, unknown>,
      },
      reviewThreshold: generationProfile.reviewThreshold,
      reviewFocusLines: [
        'Check whether the scope, risks, entry criteria, and exit criteria are requirement-specific rather than boilerplate.',
        'Check whether the plan is realistic for a working QA team and not a textbook template.',
        'Check whether the strategy notes, environments, and test types show strong senior-QA judgment.',
      ],
      correctionReminder:
        'Raise the test plan to a practical, review-ready senior-QA artifact with realistic scope, risks, and execution guidance.',
    });

    setCachedRequest(cacheKey, parsed);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in test-plan:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

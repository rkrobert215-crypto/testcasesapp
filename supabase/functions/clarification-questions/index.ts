import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { analyzeRequirementText } from "../_shared/requirementAnalysis.ts";
import { getGenerationMode, getGenerationModeProfile } from "../_shared/generationMode.ts";
import { formatRequirementInsights } from "../_shared/qaPlanningContext.ts";
import { clarificationQuestionsSchema } from "../_shared/qaPlanningSchemas.ts";
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
    const cacheKey = await computeRequestCacheKey('clarification-questions', aiSettings, { requirement: trimmedRequirement });
    const cached = getCachedRequest<unknown>(cacheKey);
    if (cached) {
      return new Response(
        JSON.stringify(cached),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const requirementInsights = await analyzeRequirementText(aiSettings, trimmedRequirement, 'clarification-questions-analysis');

    const parsed = await generateReviewedStructuredData({
      aiSettings,
      artifactLabel: 'clarification question set',
      featureName: 'clarification-questions',
      systemPrompt: `You are a senior QA analyst preparing clarification questions before test execution begins.

Your job:
- Identify ambiguity, missing rules, and assumptions in the requirement.
- Ask practical stakeholder-ready questions.
- Explain why each question matters.
- Highlight the risk if the point stays unanswered.
- Separate blocking questions from lower-priority clarifications.

STRICT RULES:
- Do not ask unnecessary filler questions.
- Focus on real ambiguity that can affect testing, coverage, or defect leakage.
- Keep assumptions and safe testing assumptions practical and requirement-driven.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.clarificationPromptLines.map((line) => `- ${line}`).join('\n')}`,
      userParts: [
        {
          type: 'text',
          text: [
            `Requirement:`,
            trimmedRequirement,
            ``,
            formatRequirementInsights(requirementInsights),
            ``,
            `Return the clarification questions and assumptions a senior QA should raise before testing.`,
          ].join('\n'),
        },
      ],
      output: {
        name: 'return_clarification_questions',
        description: 'Return structured clarification questions and assumptions.',
        schema: clarificationQuestionsSchema as unknown as Record<string, unknown>,
      },
      reviewThreshold: generationProfile.reviewThreshold,
      reviewFocusLines: [
        'Check whether the questions expose real ambiguity instead of filler.',
        'Check whether blocking level, risk, and ownership are practical for stakeholder follow-up.',
        'Check whether the assumptions are safe, realistic, and useful for QA planning.',
      ],
      correctionReminder:
        'Strengthen the question set so it surfaces the most important ambiguity, risk, and stakeholder decisions before testing starts.',
    });

    setCachedRequest(cacheKey, parsed);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in clarification-questions:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

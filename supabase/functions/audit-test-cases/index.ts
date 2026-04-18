import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { analyzeRequirementText } from "../_shared/requirementAnalysis.ts";
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
    const { requirement, imagesBase64, existingTestCases, focusMissingScenarios, aiSettings } = await req.json();

    const trimmedRequirement = String(requirement ?? '').trim();
    const images = Array.isArray(imagesBase64) ? imagesBase64 : [];
    const requestedCoverageGaps = Array.isArray(focusMissingScenarios)
      ? focusMissingScenarios.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    const generationMode = getGenerationMode(aiSettings);
    const generationProfile = getGenerationModeProfile(generationMode);
    const cacheKey = images.length === 0
      ? await computeRequestCacheKey('audit-test-cases', aiSettings, {
          requirement: trimmedRequirement,
          existingTestCases: existingTestCases ?? [],
          focusMissingScenarios: requestedCoverageGaps,
        })
      : null;
    if (cacheKey) {
      const cached = getCachedRequest<{ testCases: ReturnType<typeof normalizeGeneratedTestCases> }>(cacheKey);
      if (cached) {
        return new Response(JSON.stringify(cached), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const requirementInsights = trimmedRequirement
      ? await analyzeRequirementText(aiSettings, trimmedRequirement, 'audit-test-cases-analysis')
      : null;

    const systemPrompt = `You are a senior QA lead auditing an existing testcase suite.

Your job:
1. Read the requirement and the existing testcase set.
2. Identify missing requirement points, weak areas, and poor-quality testcase wording.
3. Generate NEW test cases only for the gaps and weak spots.
4. Return enterprise-ready testcases with requirement references, module, priority, test data, and post-condition.

STRICT RULES:
- Do not simply restate the uploaded cases.
- Focus on missing or weak coverage.
- Use professional testcase naming, preferably actor-based.
- Expected results must be concrete and observable.
- Do not invent features that are not in the requirement.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.auditPromptLines.map((line) => `- ${line}`).join('\n')}`;

    const analysisText = requirementInsights
      ? [
          `Requirement intelligence:`,
          `- Primary actor: ${requirementInsights.primaryActor}`,
          `- Primary action: ${requirementInsights.primaryAction}`,
          `- Recommended starter: ${requirementInsights.recommendedStarter}`,
          `- Modules: ${requirementInsights.businessModules.join(', ') || 'General'}`,
          `- Risk hotspots: ${requirementInsights.riskHotspots.join(' | ') || 'None'}`,
          `- Requirement points:`,
          ...requirementInsights.acceptanceCriteria.map(
            (point) => `${point.id} [${point.priority}] [${point.moduleHint}] ${point.criterion}`
          ),
        ].join('\n')
      : 'No structured requirement analysis available.';

    const userMessageContent: Array<{ type: 'text'; text: string } | { type: 'image'; dataUrl: string }> = [
      {
        type: "text",
        text: [
          `Generation style mode: ${generationProfile.label}`,
          ``,
          `Requirement:`,
          trimmedRequirement || 'No text requirement provided.',
          ``,
          analysisText,
          ``,
          `Existing test cases:`,
          JSON.stringify(existingTestCases ?? [], null, 2),
          ``,
          `Style guidance:`,
          ...generationProfile.auditPromptLines.map((line) => `- ${line}`),
          ``,
          ...(requestedCoverageGaps.length > 0
            ? [
                `Coverage gaps to generate full testcase rows for:`,
                ...requestedCoverageGaps.map((gap, index) => `${index + 1}. ${gap}`),
                ``,
                `Return only NEW testcase rows that cover these missing scenarios. Do not add unrelated extra cases.`,
              ]
            : []),
          ``,
          `Return only NEW or materially improved cases that cover missing or weak areas.`,
        ].join('\n'),
      },
    ];

    for (const img of images) {
      userMessageContent.push({ type: "image", dataUrl: img });
    }

    const parsed = await generateReviewedStructuredData<{ testCases: unknown[] }>({
      aiSettings,
      artifactLabel: 'gap-filling audited testcase suite',
      systemPrompt,
      userParts: userMessageContent,
      featureName: 'audit-test-cases',
      output: {
        name: 'return_audited_test_cases',
        description: 'Return newly generated test cases that fill the coverage gaps.',
        schema: testCaseCollectionSchema as unknown as Record<string, unknown>,
      },
      reviewThreshold: generationProfile.reviewThreshold,
      reviewFocusLines: [
        'Check whether the new cases truly fill gaps instead of repeating the uploaded suite.',
        'Check whether requirement references, module, priority, test data, and post-condition are meaningful.',
        'Check whether the testcase names, steps, and expected results read like strong senior-QA work.',
        'Check whether high-risk, negative, and edge gaps are covered rather than only happy-path improvements.',
        ...(requestedCoverageGaps.length > 0
          ? ['Check whether the returned cases directly address the requested missing coverage scenarios instead of drifting into unrelated additions.']
          : []),
      ],
      correctionReminder:
        'Return only materially useful new cases that close real coverage gaps and read like an enterprise-ready senior-QA enhancement set.',
    });

    const normalized = deduplicateGeneratedTestCases(normalizeGeneratedTestCases(parsed.testCases || []));
    const responseBody = { testCases: normalized };
    if (cacheKey) {
      setCachedRequest(cacheKey, responseBody);
    }

    return new Response(JSON.stringify(responseBody), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in audit-test-cases:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

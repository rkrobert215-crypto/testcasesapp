import { generateReviewedStructuredData } from './reviewedStructuredGeneration.ts';
import { getGenerationMode, getGenerationModeProfile, isStrictRequirementMode } from './generationMode.ts';
import { computeRequestCacheKey, getCachedRequest, setCachedRequest } from './requestCache.ts';

const REQUIREMENT_ANALYSIS_CACHE_VERSION = '2026-04-08-v4';

export type RequirementPointSourceType = 'Explicit AC' | 'Derived Requirement Point';
export type RequirementPointPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface RequirementAnalysisPoint {
  id: string;
  criterion: string;
  sourceType: RequirementPointSourceType;
  plainEnglishMeaning: string;
  moduleHint: string;
  priority: RequirementPointPriority;
  whatToTest: string[];
  howToTest: string[];
}

export interface RequirementAnalysisResult {
  functionalityExplanation: string;
  simpleSummary: string;
  primaryActor: string;
  primaryAction: string;
  recommendedStarter: string;
  businessModules: string[];
  mainFlow: string[];
  whatToTest: string[];
  howToTest: string[];
  acceptanceCriteria: RequirementAnalysisPoint[];
  importantNotes: string[];
  riskHotspots: string[];
}

export const requirementAnalysisSchema = {
  type: 'object',
  properties: {
    functionalityExplanation: { type: 'string' },
    simpleSummary: { type: 'string' },
    primaryActor: { type: 'string' },
    primaryAction: { type: 'string' },
    recommendedStarter: { type: 'string' },
    businessModules: {
      type: 'array',
      items: { type: 'string' },
    },
    mainFlow: {
      type: 'array',
      items: { type: 'string' },
    },
    whatToTest: {
      type: 'array',
      items: { type: 'string' },
    },
    howToTest: {
      type: 'array',
      items: { type: 'string' },
    },
    acceptanceCriteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          criterion: { type: 'string' },
          sourceType: { type: 'string', enum: ['Explicit AC', 'Derived Requirement Point'] },
          plainEnglishMeaning: { type: 'string' },
          moduleHint: { type: 'string' },
          priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
          whatToTest: {
            type: 'array',
            items: { type: 'string' },
          },
          howToTest: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['id', 'criterion', 'sourceType', 'plainEnglishMeaning', 'moduleHint', 'priority', 'whatToTest', 'howToTest'],
        additionalProperties: false,
      },
    },
    importantNotes: {
      type: 'array',
      items: { type: 'string' },
    },
    riskHotspots: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'functionalityExplanation',
    'simpleSummary',
    'primaryActor',
    'primaryAction',
    'recommendedStarter',
    'businessModules',
    'mainFlow',
    'whatToTest',
    'howToTest',
    'acceptanceCriteria',
    'importantNotes',
    'riskHotspots',
  ],
  additionalProperties: false,
} as const;

export const requirementAnalysisSystemPrompt = `You are a senior QA analyst and requirement breakdown expert.

MANDATORY READING METHOD:
1. Read the requirement from TOP to BOTTOM, line by line.
2. Read the requirement again from BOTTOM to TOP, line by line.
3. Read the requirement once more from TOP to BOTTOM to confirm nothing was missed.

YOUR JOB:
- Explain the feature/functionality in simple English.
- Write a short simple summary that even a non-technical person can understand.
- Identify the PRIMARY ACTOR and PRIMARY ACTION from the requirement.
- Infer the recommended testcase starter phrase, such as "Verify that the user" or "Verify that the admin".
- Identify the main business modules or areas involved.
- Identify whether the requirement clearly refers to a list page, details page, grid/table, popup/modal, or create/edit form when that context is present.
- Identify whether behavior depends on tenant settings, configuration toggles, feature flags, permissions, role differences, redirects, or login/MFA state when that context is present.
- Identify whether onboarding, account setup, customer/supplier/buyer/reseller actor differences, notifications/emails, exports/downloads, or API/network side effects are part of the requirement when that context is present.
- Identify whether accessibility, responsive/mobile behavior, cross-browser support, concurrency, performance/volume expectations, or deeper API/DB verification are part of the requirement when that context is present.
- Preserve exact labels, config keys, rule terms, and fixed behavior names from the requirement when they matter.
- Tell the tester WHAT to test.
- Tell the tester HOW to test it.
- Break the requirement into acceptance-criteria-style points.
- Highlight the highest-risk hotspots where bugs are most likely or most serious.

AC RULES:
- If explicit acceptance criteria are present, keep them in order and mark them as "Explicit AC".
- If there are no explicit AC bullets, derive requirement points carefully from the requirement text and mark them as "Derived Requirement Point".
- Do not invent features that are not present in the requirement.
- Do not invent admin/configuration screens, setup workflows, or modal behavior unless the requirement explicitly mentions them.
- Be concrete, practical, and tester-friendly.

ACTOR RULES:
- Use the actor explicitly stated in the requirement when available.
- If no actor is clearly stated, default to "user".
- The recommendedStarter must be an exact phrase such as "Verify that the user", "Verify that the admin", "Verify that the buyer", or "Verify that the tenant".

WRITING STYLE:
- Use simple, clear English.
- Avoid jargon where possible.
- Make each test suggestion specific and actionable.
- Focus on manual/browser-style testing guidance unless the requirement clearly points elsewhere.`;

export async function analyzeRequirementText(
  aiSettings: unknown,
  requirement: string,
  featureName: string
): Promise<RequirementAnalysisResult> {
  const generationMode = getGenerationMode(aiSettings);
  const profile = getGenerationModeProfile(generationMode);
  const strictRequirementMode = isStrictRequirementMode(aiSettings);
  const trimmedRequirement = String(requirement).trim();
  const cacheKey = await computeRequestCacheKey('shared-requirement-analysis', aiSettings, {
    version: REQUIREMENT_ANALYSIS_CACHE_VERSION,
    requirement: trimmedRequirement,
  });
  const cached = getCachedRequest<RequirementAnalysisResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await generateReviewedStructuredData<RequirementAnalysisResult>({
    aiSettings,
    featureName,
    artifactLabel: 'requirement analysis',
    systemPrompt: [
      requirementAnalysisSystemPrompt,
      '',
      `GENERATION STYLE MODE: ${profile.label}`,
      ...(strictRequirementMode
        ? [
            'STRICT EXACT REQUIREMENT MODE:',
            '- Stay tightly aligned to exact labels, config keys, rule terms, and fixed behavior names from the requirement.',
            '- Do not replace exact requirement wording with generic examples or invented substitute values.',
          ]
        : []),
      ...profile.analysisPromptLines.map((line) => `- ${line}`),
    ].join('\n'),
    userParts: [
      {
        type: 'text',
        text: [
          `Generation style mode: ${profile.label}`,
          '',
          `Requirement to analyze:`,
          trimmedRequirement,
        ].join('\n'),
      },
    ],
    output: {
      name: 'return_requirement_analysis',
      description: 'Return a structured requirement analysis with testing guidance and naming hints.',
      schema: requirementAnalysisSchema as unknown as Record<string, unknown>,
    },
    reviewThreshold: profile.reviewThreshold,
    reviewFocusLines: [
      'Check whether the explanation is simple but still precise.',
      'Check whether primary actor, primary action, and recommended testcase starter are requirement-driven.',
      'Check whether the acceptance-criteria breakdown is complete, practical, and useful for testcase design.',
      'Check whether module/page/list/detail/popup context was captured when the requirement clearly supports it.',
      'Check whether tenant-setting, permission, role, redirect, or MFA/login dependencies were captured when the requirement clearly supports them.',
      'Check whether onboarding, account setup, export/download, notification/email, API/network side effects, and buyer/customer/supplier/reseller actor differences were captured when the requirement clearly supports them.',
      'Check whether accessibility, responsive/mobile, cross-browser, concurrency, performance/volume, and deeper API/DB verification obligations were captured when the requirement clearly supports them.',
      ...(strictRequirementMode
        ? [
            'Check whether exact labels, config keys, and fixed logic terms were preserved instead of replaced by generic examples.',
          ]
        : []),
      'Check whether what-to-test and how-to-test guidance is concrete and senior-QA-worthy.',
    ],
    correctionReminder:
      strictRequirementMode
        ? 'Strengthen traceability, actor detection, risk focus, and practical testing guidance while staying tightly aligned to the exact requirement wording and fixed logic terms.'
        : 'Strengthen traceability, actor detection, risk focus, and practical testing guidance while keeping the explanation simple and requirement-driven.',
  });

  setCachedRequest(cacheKey, result);
  return result;
}

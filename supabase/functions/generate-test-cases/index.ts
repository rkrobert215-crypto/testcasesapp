import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { generateStructuredData } from "../_shared/aiClient.ts";
import {
  analyzeRequirementText,
  type RequirementAnalysisResult,
} from "../_shared/requirementAnalysis.ts";
import {
  deduplicateGeneratedTestCases,
  normalizeGeneratedTestCases,
  testCaseCollectionSchema,
  type GeneratedTestCase,
} from "../_shared/testCaseSchema.ts";
import {
  computeGenerateCacheKey,
  runGenerateTestCasePipeline,
} from "../_shared/generateTestCasePipeline.ts";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 50;
const PROMPT_VERSION = "qa-pro-v5";
const GENERATION_TIME_BUDGET_MS = 150_000;
const RETRY_STAGE_RESERVE_MS = 45_000;
const FINALIZATION_RESERVE_MS = 15_000;
const AI_CALL_TIMEOUT_MS = 45_000;
const REVIEW_CALL_TIMEOUT_MS = 25_000;
const cache = new Map<string, { data: unknown; timestamp: number }>();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

type InputType = 'requirement' | 'highlevel' | 'testcase' | 'scenario' | 'expected';
type GenerationMode = 'rob_style' | 'yuv_style' | 'swag_style' | 'professional_standard';
type UserPromptPart = { type: 'text'; text: string } | { type: 'image'; dataUrl: string };
type StageSender = (stage: string, data?: Record<string, unknown>) => void;

interface ReviewResult {
  approved: boolean;
  qualityScore: number;
  summary: string;
  coverageGaps: string[];
  duplicateConcerns: string[];
  weakExpectedResults: string[];
  namingIssues: string[];
  enterpriseFieldIssues: string[];
  improvementInstructions: string[];
}

type ProviderSuccess = { ok: true; testCases: GeneratedTestCase[] };
type ProviderFailure = { ok: false; status: number; errorText: string };
type ProviderResult = ProviderSuccess | ProviderFailure;
type GenerationModeProfile = {
  label: string;
  systemPromptLines: string[];
  reviewerLines: string[];
  reviewThreshold: number;
  correctionReminder: string;
};

const DEFAULT_GENERATION_MODE: GenerationMode = 'rob_style';

const INPUT_TYPE_PROMPTS: Record<InputType, string> = {
  requirement: `You are a senior QA engineer with 15+ years of manual testing experience.

Think like a REAL HUMAN TESTER who tests the feature step by step in the browser.

HOW A SENIOR QA THINKS:
- Follow the end-to-end workflow from start to finish.
- Cover validations, permissions, UI behavior, navigation, persistence, and impact on related features.
- Read every line of the requirement carefully and do not skip statuses, authorities, conditions, or messages.
- Prefer meaningful user-action test cases, not tiny micro-checks.

STRICT RULES:
- Do not invent roles or authorities that are not in the requirement.
- Do not generate API-level penetration/security attack test cases.
- The first test case must be the primary business action of the feature.
- The number of test cases must scale with requirement complexity.
- Every acceptance criteria point or derived requirement point must be covered.

EXPECTED RESULT STYLE:
- Write like a professional QA tester.
- Never use the words "system", "application", "should", or "successfully".
- Use direct language such as "User redirected to dashboard" or "Error message displayed: 'Invalid password'".`,

  highlevel: `You are a senior QA engineer generating HIGH LEVEL smoke and sanity test cases.

RULES:
- Cover the main functionality, core validations, and the most important negative flows.
- Keep the suite concise but still professional and traceable.
- Every test case must still map back to a requirement point.
- Use enterprise-ready fields and practical manual-testing language.`,

  testcase: `You are a senior QA engineer completing partially written test cases.

RULES:
- Keep the original test case intent exactly the same.
- Fill the remaining fields so the testcase reads like an enterprise QA artifact.
- Strengthen weak preconditions, test data, steps, and expected results without changing the business meaning.`,

  scenario: `You are a senior QA engineer generating a full testcase suite from a scenario description.

RULES:
- Think like a manual tester walking through the feature from start to finish.
- Include happy path, validation, permission, edge, and data-persistence checks.
- Keep the titles professional, business-focused, and traceable to scenario details.`,

  expected: `You are a senior QA engineer generating expected results.

RULES:
- Return complete testcase rows with especially strong expected results.
- Expected results must be direct, observable, and professional.
- Do not use vague wording such as "works properly" or "successfully".`,
};

const GENERATION_MODE_PROFILES: Record<GenerationMode, GenerationModeProfile> = {
  rob_style: {
    label: 'Rob',
    systemPromptLines: [
      'Keep the suite aligned with Rob-style manual-QA wording.',
      'Strongly prefer actor-based testcase titles such as "Verify that the user..." whenever that matches the requirement actor.',
      'Keep authority names exact and visible when permissions drive the scenario.',
      'Sound like a seasoned browser tester, not a robotic compliance tool.',
      'Keep enterprise fields present, but make them concise and practical rather than overly formal.',
    ],
    reviewerLines: [
      'Preserve Rob-style actor-based QA wording and manual-testing tone.',
      'Flag cases that sound robotic, too generic, or disconnected from realistic browser flows.',
      'Approve only if the suite feels like strong senior-QA work while still sounding natural.',
    ],
    reviewThreshold: 84,
    correctionReminder: 'Keep the suite in a Rob-style QA voice while fixing the missing coverage, naming, and quality gaps.',
  },
  yuv_style: {
    label: 'Yuv',
    systemPromptLines: [
      'Keep the suite aligned with Yuv-style QA thinking: broad, practical, module-aware, and coverage-rich.',
      'Cover module/page behavior, UI states, navigation, list behavior, sorting, filters, and downstream reflection when they are relevant.',
      'Keep testcase titles professional and actor-based, but optimize more for complete functional coverage than for title polish alone.',
      'Do not compress useful coverage just to make the output shorter; prefer better and complete test cases.',
    ],
    reviewerLines: [
      'Preserve Yuv-style breadth: module/page behavior, practical UI checks, and fuller scenario separation.',
      'Flag suites that miss list behavior, navigation, sorting, filtering, page/module context, or realistic negative paths.',
      'Approve only if the suite feels like a strong senior QA explored the feature end to end, not just the main AC bullets.',
    ],
    reviewThreshold: 86,
    correctionReminder: 'Raise the suite to a Yuv-style QA standard with broader module-aware coverage, stronger UI/list/navigation coverage, and fuller positive/negative/edge separation.',
  },
  swag_style: {
    label: 'SWAG',
    systemPromptLines: [
      'Use the SWAG benchmark style: broad web-app QA coverage across common UI patterns, business states, and user-visible behavior.',
      'Treat forms, inputs, dropdowns, radios, checkboxes, file uploads, drag-and-drop, grids, filters, sorting, pagination, exports, refresh behavior, and persistence as reusable QA coverage patterns when relevant.',
      'Cover permission, role, tenant-setting, feature-flag, state-transition, network/API reflection, and DB/data-persistence behavior when the requirement supports them.',
      'Keep testcase titles professional and actor-based, but prioritize complete benchmark-worthy coverage over minimal output.',
    ],
    reviewerLines: [
      'Review the suite against broad web-app QA benchmark expectations, not just explicit AC bullets.',
      'Flag missing UI pattern coverage such as sort/filter/search/list behavior, form validation, upload/download, state persistence, redirects, and side effects when the requirement supports them.',
      'Approve only if the suite feels benchmark-worthy for a modern web app and does not over-compress useful cases.',
    ],
    reviewThreshold: 88,
    correctionReminder: 'Raise the suite to SWAG benchmark quality with complete web-app QA coverage, explicit state/permission handling, and practical execution-ready detail.',
  },
  professional_standard: {
    label: 'Professional Standard',
    systemPromptLines: [
      'Optimize for enterprise-standard QA documentation and formal review readiness.',
      'Maintain strong traceability from requirement points to testcase rows.',
      'Make module, priority, test data, and post-condition fields meaningfully useful for project teams.',
      'Keep wording professional, concise, and audit-ready while still using actor-based titles when appropriate.',
      'Prefer risk-based, stakeholder-ready testcase design over generic filler coverage.',
    ],
    reviewerLines: [
      'Be strict about traceability, coverage completeness, and enterprise field quality.',
      'Flag weak prioritization, vague test data, or missing post-conditions.',
      'Approve only if the suite reads like a formally reviewable senior-QA deliverable.',
      'Reject suites that feel generic, repetitive, or weak on business risk and release impact.',
    ],
    reviewThreshold: 90,
    correctionReminder: 'Raise the suite to a formal professional QA standard with stronger traceability, cleaner prioritization, and more audit-ready wording.',
  },
};

const reviewSchema = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    qualityScore: { type: 'number' },
    summary: { type: 'string' },
    coverageGaps: { type: 'array', items: { type: 'string' } },
    duplicateConcerns: { type: 'array', items: { type: 'string' } },
    weakExpectedResults: { type: 'array', items: { type: 'string' } },
    namingIssues: { type: 'array', items: { type: 'string' } },
    enterpriseFieldIssues: { type: 'array', items: { type: 'string' } },
    improvementInstructions: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'approved',
    'qualityScore',
    'summary',
    'coverageGaps',
    'duplicateConcerns',
    'weakExpectedResults',
    'namingIssues',
    'enterpriseFieldIssues',
    'improvementInstructions',
  ],
  additionalProperties: false,
} as const;

const computeCacheKey = async (
  input: string,
  inputType: string,
  imageCount: number,
  aiSettings: unknown
): Promise<string> => {
  return await computeGenerateCacheKey(input, inputType as InputType, imageCount, aiSettings);
};

const getCached = (key: string) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
};

const setCache = (key: string, data: unknown) => {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, timestamp: Date.now() });
};

const getGenerationMode = (aiSettings: unknown): GenerationMode => {
  const rawSettings = aiSettings && typeof aiSettings === 'object' ? (aiSettings as Record<string, unknown>) : {};
  if (rawSettings.generationMode === 'professional_standard') return 'professional_standard';
  if (rawSettings.generationMode === 'swag_style') return 'swag_style';
  if (rawSettings.generationMode === 'yuv_style') return 'yuv_style';
  if (rawSettings.generationMode === 'rob_style' || rawSettings.generationMode === 'my_style') return 'rob_style';
  return DEFAULT_GENERATION_MODE;
};

const getGenerationModeProfile = (generationMode: GenerationMode) =>
  GENERATION_MODE_PROFILES[generationMode] || GENERATION_MODE_PROFILES[DEFAULT_GENERATION_MODE];

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: number | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s.`)), timeoutMs) as unknown as number;
      }),
    ]);
  } finally {
    if (typeof timer !== 'undefined') {
      clearTimeout(timer);
    }
  }
};

const hasTimeBudgetRemaining = (startedAt: number, reserveMs: number) =>
  Date.now() - startedAt < GENERATION_TIME_BUDGET_MS - reserveMs;

const buildFallbackReview = (
  validation: { valid: boolean; violations: string[] },
  generationMode: GenerationMode,
  summary: string
): ReviewResult => {
  const profile = getGenerationModeProfile(generationMode);

  return {
    approved: validation.valid,
    qualityScore: validation.valid ? profile.reviewThreshold : Math.max(profile.reviewThreshold - 12, 70),
    summary,
    coverageGaps: validation.valid ? [] : validation.violations,
    duplicateConcerns: [],
    weakExpectedResults: [],
    namingIssues: [],
    enterpriseFieldIssues: [],
    improvementInstructions: validation.valid ? [] : validation.violations,
  };
};

const buildSystemPrompt = (inputType: InputType, generationMode: GenerationMode): string => {
  const profile = getGenerationModeProfile(generationMode);
  return [
    INPUT_TYPE_PROMPTS[inputType] || INPUT_TYPE_PROMPTS.requirement,
    '',
    `GENERATION STYLE MODE: ${profile.label}`,
    ...profile.systemPromptLines.map((line) => `- ${line}`),
  ].join('\n');
};

const extractAuthorities = (text: string): string[] => {
  const upperKeywords = ['CAN_', 'HAS_', 'ALLOW_', 'MANAGE_', 'VIEW_', 'EDIT_', 'DELETE_', 'CREATE_', 'APPROVE_', 'REJECT_', 'READ_', 'WRITE_', 'ACCESS_'];
  const upperCaseMatches = text
    .split(/[\s,;:()[\]{}|"'`]+/)
    .map((token) => token.replace(/^[^A-Z_]+|[^A-Z_]+$/g, ''))
    .filter((token) => token.length > 3 && /^[A-Z_]+$/.test(token))
    .filter((token) => upperKeywords.some((keyword) => token.includes(keyword)));

  const camelRegex = /\b(can|has|allow|manage|view|edit|delete|create|approve|reject|access)[A-Z][a-zA-Z]{2,}\b/g;
  const camelMatches = [...text.matchAll(camelRegex)].map((match) => match[0]);

  return [...new Set([...upperCaseMatches, ...camelMatches])];
};

const detectPrimaryAction = (input: string): string | null => {
  const actionVerbs = [
    'export', 'import', 'cancel', 'create', 'delete', 'update', 'edit', 'approve', 'reject',
    'assign', 'submit', 'upload', 'download', 'archive', 'activate', 'deactivate', 'send',
    'generate', 'publish', 'transfer', 'merge', 'split', 'clone', 'duplicate', 'restore',
    'revoke', 'suspend', 'enable', 'disable', 'login', 'log in', 'sign in',
  ];
  const lower = input.toLowerCase();
  for (const verb of actionVerbs) {
    if (lower.includes(verb)) return verb.replace(/\s+/g, ' ');
  }
  return null;
};

const estimateMinimumTestCases = (
  inputType: InputType,
  input: string,
  insights: RequirementAnalysisResult | null
): number => {
  if (inputType === 'highlevel') {
    return Math.max(10, Math.min(20, (insights?.acceptanceCriteria.length ?? 0) * 2 || 10));
  }
  if (inputType === 'testcase') return 1;
  if (inputType === 'expected') return 1;

  const bulletLines = input.split('\n').filter((line) => /^\s*[-*•]\s|^\s*\d+[.)]\s/.test(line)).length;
  const paragraphCount = input.split(/\n\s*\n/).filter((paragraph) => paragraph.trim().length > 0).length;
  const acCount = insights?.acceptanceCriteria.length ?? 0;
  const normalizedBulletLines = Math.max(
    bulletLines,
    input.split('\n').filter((line) => /^\s*[-*•]\s|^\s*\d+[.)]\s/.test(line)).length
  );

  let baseline = 15;
  if (normalizedBulletLines >= 5 || input.length > 1000 || paragraphCount >= 3) baseline = 20;
  if (normalizedBulletLines >= 10 || input.length > 2000 || paragraphCount >= 6) baseline = 30;
  if (normalizedBulletLines >= 15 || input.length > 3000) baseline = 40;
  if (acCount > 0) baseline = Math.max(baseline, Math.min(70, acCount * 2));

  return baseline;
};

const validateGeneratedCases = (
  inputType: InputType,
  input: string,
  testCases: GeneratedTestCase[],
  insights: RequirementAnalysisResult | null
): { valid: boolean; violations: string[] } => {
  const violations: string[] = [];

  if (testCases.length === 0) {
    violations.push('No test cases were generated.');
    return { valid: false, violations };
  }

  const minimum = estimateMinimumTestCases(inputType, input, insights);
  if (testCases.length < minimum) {
    violations.push(`Generated only ${testCases.length} test cases, expected at least ${minimum} for this requirement size.`);
  }

  if (inputType !== 'testcase' && inputType !== 'expected') {
    const hasPositive = testCases.some((tc) => tc.type === 'Positive');
    const hasNegative = testCases.some((tc) => tc.type === 'Negative');
    if (!hasPositive || !hasNegative) {
      violations.push('Output must include both Positive and Negative test cases.');
    }
  }

  const missingEnterpriseFields = testCases.filter(
    (tc) =>
      !tc.requirementReference ||
      !tc.module ||
      !tc.priority ||
      !tc.testData ||
      !tc.postCondition
  );
  if (missingEnterpriseFields.length > 0) {
    violations.push('Some test cases are missing enterprise fields like requirementReference, module, priority, testData, or postCondition.');
  }

  const invalidTitles = testCases.filter((tc) => {
    const lower = tc.testCase.toLowerCase();
    return !(
      lower.startsWith('verify that') ||
      lower.startsWith('validate that') ||
      lower.startsWith('ensure that') ||
      lower.startsWith('verify if')
    );
  });
  if (invalidTitles.length > Math.ceil(testCases.length * 0.25)) {
    violations.push('Too many test case titles do not use professional QA starters like "Verify that", "Validate that", or "Ensure that".');
  }

  if (insights?.recommendedStarter) {
    const preferredStarter = insights.recommendedStarter.toLowerCase();
    const preferredCount = testCases.filter((tc) => tc.testCase.toLowerCase().startsWith(preferredStarter)).length;
    if (preferredCount === 0) {
      violations.push(`No test case starts with the preferred actor-based phrase "${insights.recommendedStarter}".`);
    }
  }

  if (inputType === 'requirement') {
    const primaryAction = insights?.primaryAction || detectPrimaryAction(input);
    const firstCase = testCases[0]?.testCase?.toLowerCase() || '';
    if (primaryAction && !firstCase.includes(primaryAction.toLowerCase())) {
      violations.push(`TC_001 does not reference the primary action "${primaryAction}" from the requirement.`);
    }
  }

  const authorities = extractAuthorities(input);
  if (authorities.length > 0) {
    const combinedText = JSON.stringify(testCases);
    const missingAuthorities = authorities.filter((authority) => !combinedText.includes(authority));
    if (missingAuthorities.length > 0) {
      violations.push(`Missing explicit authority coverage for: ${missingAuthorities.join(', ')}.`);
    }

    const foundAuthorities = extractAuthorities(combinedText);
    const unauthorizedAuthorities = foundAuthorities.filter((authority) => !authorities.includes(authority));
    if (unauthorizedAuthorities.length > 0) {
      violations.push(`Contains invented authorities not present in requirement: ${unauthorizedAuthorities.join(', ')}.`);
    }
  }

  if (insights?.acceptanceCriteria?.length) {
    const missingPointIds = insights.acceptanceCriteria
      .map((point) => point.id)
      .filter((pointId) => !testCases.some((tc) => tc.requirementReference.includes(pointId)));

    if (missingPointIds.length > 0) {
      violations.push(`Requirement references missing from testcase suite: ${missingPointIds.join(', ')}.`);
    }
  }

  return { valid: violations.length === 0, violations };
};

const buildInsightSummary = (insights: RequirementAnalysisResult | null): string => {
  if (!insights) return '';

  const acceptanceCriteriaLines = insights.acceptanceCriteria
    .map(
      (point) =>
        `${point.id} [${point.sourceType}] [${point.priority}] [${point.moduleHint}] ${point.criterion}\nMeaning: ${point.plainEnglishMeaning}\nWhat to test: ${point.whatToTest.join(' | ')}\nHow to test: ${point.howToTest.join(' | ')}`
    )
    .join('\n\n');

  return [
    `Requirement intelligence:`,
    `- Functionality explanation: ${insights.functionalityExplanation}`,
    `- Simple summary: ${insights.simpleSummary}`,
    `- Primary actor: ${insights.primaryActor}`,
    `- Primary action: ${insights.primaryAction}`,
    `- Recommended testcase starter: ${insights.recommendedStarter}`,
    `- Business modules: ${insights.businessModules.join(', ') || 'General'}`,
    `- Main flow: ${insights.mainFlow.join(' -> ')}`,
    `- Risk hotspots: ${insights.riskHotspots.join(' | ') || 'None identified'}`,
    `- Important notes: ${insights.importantNotes.join(' | ') || 'None'}`,
    '',
    `Acceptance criteria / derived requirement points:`,
    acceptanceCriteriaLines || 'No structured requirement points available.',
  ].join('\n');
};

const buildInstructionText = (
  input: string,
  images: string[],
  inputType: InputType,
  insights: RequirementAnalysisResult | null,
  generationMode: GenerationMode
): string => {
  const profile = getGenerationModeProfile(generationMode);
  const preferredStarter = insights?.recommendedStarter || 'Verify that the user';
  const lines = [
    `Generate enterprise-quality test cases in structured form.`,
    `Return the complete testcase suite with these exact fields for every row: id, requirementReference, module, priority, coverageArea, scenario, testCase, testData, preconditions, testSteps, expectedResult, postCondition, type.`,
    `Do not return markdown or commentary.`,
    ``,
    `GENERATION STYLE MODE: ${profile.label}`,
    ...profile.systemPromptLines.map((line) => `- ${line}`),
    ``,
    `MANDATORY OUTPUT QUALITY RULES:`,
    `- Read every line of the requirement and map each acceptance criteria point to one or more test cases.`,
    `- Include both Positive and Negative scenarios where appropriate.`,
    `- Do not invent roles, authorities, statuses, or features that are not in the requirement.`,
    `- Make the suite read like a senior QA deliverable, not generic AI output.`,
    `- Use practical business modules, priority, test data, and post-condition fields.`,
    `- requirementReference must point to AC IDs or derived requirement IDs such as AC-01 or REQ-03.`,
    `- For standard functional cases, prefer the recommended actor-based starter phrase from requirement analysis.`,
  ];

  if (generationMode === 'rob_style') {
    lines.push(
      `- Strongly prefer testcase titles that begin with "${preferredStarter}" or a closely matching actor-based phrase.`,
      `- Keep the writing human, practical, browser-focused, and close to a clean senior QA workbook style.`,
      `- Make permission and authority wording exact whenever the requirement depends on it.`,
      `- Keep expected results crisp, direct, and observable instead of padded.`,
    );
  } else if (generationMode === 'yuv_style') {
    lines.push(
      `- Keep the suite broad and execution-oriented with clear module, page, UI, and navigation coverage.`,
      `- Separate meaningful list, table, sort, filter, state, and downstream-visibility checks when they represent different user risks.`,
      `- Prefer stronger functional breadth over polished but narrow coverage.`,
    );
  } else if (generationMode === 'swag_style') {
    lines.push(
      `- Keep the suite benchmark-driven and broad across common modern web-app UI patterns and business states.`,
      `- Explicitly include reusable web-app QA patterns such as forms, inputs, dropdowns, radios, uploads, drag-and-drop, grids, filters, sorts, exports, refresh behavior, and persistence when relevant.`,
      `- Prefer benchmark-worthy completeness over narrow or over-compressed output.`,
    );
  } else {
    lines.push(
      `- Keep the suite formal, traceable, and ready for professional QA review boards or client sharing.`,
      `- Make module names, priority, test data, and post-condition fields especially strong and useful.`,
      `- Favor concise, enterprise-standard wording over casual phrasing.`,
    );
  }

  if (insights) {
    lines.push('', buildInsightSummary(insights));
  }

  if (input?.trim()) {
    lines.push('', `Requirement/Input:`, input.trim());
  }

  if (images.length > 0) {
    lines.push(
      '',
      `Attached visual context: ${images.length} screenshot(s) or mockup(s). Analyze visible UI elements, buttons, forms, messages, and flows so the testcase suite covers both text and UI.`
    );
  }

  if (inputType === 'testcase') {
    lines.push('', `Preserve the original testcase intent while upgrading the remaining fields.`);
  }

  return lines.join('\n');
};

const maybeAnalyzeRequirement = async (
  aiSettings: unknown,
  inputType: InputType,
  input: string
): Promise<RequirementAnalysisResult | null> => {
  if (!input.trim()) return null;
  if (inputType !== 'requirement' && inputType !== 'highlevel' && inputType !== 'scenario') {
    return null;
  }

  try {
    return await withTimeout(
      analyzeRequirementText(aiSettings, input, 'generate-test-cases-analysis'),
      REVIEW_CALL_TIMEOUT_MS,
      'Requirement analysis'
    );
  } catch (error) {
    console.warn('[generate-test-cases] requirement analysis skipped:', error);
    return null;
  }
};

const callAiProvider = async (
  aiSettings: unknown,
  systemPrompt: string,
  userContent: UserPromptPart[]
): Promise<ProviderResult> => {
  try {
    const parsed = await withTimeout(
      generateStructuredData<{ testCases: unknown[] }>({
        aiSettings,
        systemPrompt,
        userParts: userContent,
        featureName: 'generate-test-cases',
        output: {
          name: 'return_test_cases',
          description: 'Return the generated test cases as structured data.',
          schema: testCaseCollectionSchema as unknown as Record<string, unknown>,
        },
      }),
      AI_CALL_TIMEOUT_MS,
      'Testcase generation'
    );

    const normalized = deduplicateGeneratedTestCases(normalizeGeneratedTestCases(parsed.testCases || []));
    return { ok: true, testCases: normalized };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : 'Failed to generate test cases';
    const lower = errorText.toLowerCase();
    const status =
      lower.includes('rate limit') ? 429 :
      lower.includes('credit') || lower.includes('payment') ? 402 :
      500;

    return { ok: false, status, errorText };
  }
};

const reviewGeneratedCases = async (
  aiSettings: unknown,
  input: string,
  inputType: InputType,
  insights: RequirementAnalysisResult | null,
  generationMode: GenerationMode,
  testCases: GeneratedTestCase[]
): Promise<ReviewResult> => {
  const profile = getGenerationModeProfile(generationMode);
  return await withTimeout(generateStructuredData<ReviewResult>({
    aiSettings,
    featureName: 'generate-test-cases-review',
    systemPrompt: `You are a QA test lead with 15+ years of experience reviewing testcase suites created by other QA engineers.

Review the provided testcase suite as if you are approving it for real project use.

Generation style mode: ${profile.label}
Minimum approval score: ${profile.reviewThreshold}. If the suite is below that score, do not approve it.

STYLE EXPECTATIONS:
${profile.reviewerLines.map((line) => `- ${line}`).join('\n')}

CHECKLIST:
- Does it cover the full requirement and each acceptance-criteria point?
- Does it avoid duplication and generic filler cases?
- Do testcase titles sound professional and actor-based, especially using the recommended starter where appropriate?
- Are expected results concrete and observable?
- Are enterprise fields present and useful: requirementReference, module, priority, testData, postCondition?
- Does the suite feel like senior manual QA work?

Be strict. Approve only if the suite is genuinely strong.`,
    userParts: [
      {
        type: 'text',
        text: [
          `Generation style mode: ${profile.label}`,
          '',
          `Input type: ${inputType}`,
          '',
          buildInsightSummary(insights),
          '',
          `Requirement:`,
          input.trim() || 'No text input provided.',
          '',
          `Generated testcase suite to review:`,
          JSON.stringify(testCases, null, 2),
        ].join('\n'),
      },
    ],
    output: {
      name: 'return_test_case_review',
      description: 'Return a structured senior-QA review of the testcase suite.',
      schema: reviewSchema as unknown as Record<string, unknown>,
    },
  }), REVIEW_CALL_TIMEOUT_MS, 'Testcase review');
};

const buildCorrectionInstruction = (
  validation: { violations: string[] },
  review: ReviewResult,
  insights: RequirementAnalysisResult | null,
  generationMode: GenerationMode
): string => {
  const profile = getGenerationModeProfile(generationMode);
  const lines = [
    'Your previous output did not meet the mandatory QA quality bar. Regenerate the FULL testcase suite from scratch.',
    '',
    `Generation style mode: ${profile.label}`,
    '',
    'Validation issues:',
    ...(validation.violations.length > 0 ? validation.violations.map((item, index) => `${index + 1}. ${item}`) : ['1. None']),
    '',
    'Senior QA review findings:',
    `- Summary: ${review.summary}`,
    `- Coverage gaps: ${review.coverageGaps.join(' | ') || 'None listed'}`,
    `- Duplicate concerns: ${review.duplicateConcerns.join(' | ') || 'None listed'}`,
    `- Weak expected results: ${review.weakExpectedResults.join(' | ') || 'None listed'}`,
    `- Naming issues: ${review.namingIssues.join(' | ') || 'None listed'}`,
    `- Enterprise field issues: ${review.enterpriseFieldIssues.join(' | ') || 'None listed'}`,
    '',
    'Improvement instructions:',
    ...(review.improvementInstructions.length > 0
      ? review.improvementInstructions.map((item, index) => `${index + 1}. ${item}`)
      : ['1. Strengthen the suite so it reads like senior QA output.']),
    '',
    `Important reminder: Use actor-based testcase starters such as "${insights?.recommendedStarter || 'Verify that the user'}" whenever the case is a standard functional or permission scenario.`,
    profile.correctionReminder,
    'Re-read the requirement line by line and cover every condition explicitly.',
    'Return only the structured testcase payload.',
  ];

  return lines.join('\n');
};

const isReviewApproved = (
  validation: { valid: boolean; violations: string[] },
  review: ReviewResult,
  generationMode: GenerationMode
) => {
  const profile = getGenerationModeProfile(generationMode);
  return validation.valid && review.approved && review.qualityScore >= profile.reviewThreshold;
};

const scoreCandidate = (
  validation: { valid: boolean; violations: string[] },
  review: ReviewResult,
  testCases: GeneratedTestCase[]
) => {
  return (
    review.qualityScore +
    (validation.valid ? 20 : 0) +
    Math.min(testCases.length, 80) / 4 -
    validation.violations.length * 12 -
    review.coverageGaps.length * 5 -
    review.duplicateConcerns.length * 4 -
    review.weakExpectedResults.length * 3 -
    review.namingIssues.length * 3 -
    review.enterpriseFieldIssues.length * 3
  );
};

const runGenerationPipeline = async (
  aiSettings: unknown,
  input: string,
  inputType: InputType,
  images: string[],
  cacheKey: string | null,
  sendEvent?: StageSender
): Promise<{ testCases: GeneratedTestCase[]; cached?: boolean }> => {
  return await runGenerateTestCasePipeline({
    aiSettings,
    input,
    inputType,
    images,
    cacheKey,
    sendEvent,
  });
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { input, inputType, imagesBase64, imageBase64, stream, aiSettings } = await req.json();
    const normalizedInputType = (inputType || '') as InputType;
    const images: string[] = Array.isArray(imagesBase64) ? imagesBase64 : imageBase64 ? [imageBase64] : [];
    const safeInput = typeof input === 'string' ? input : '';

    if (!safeInput.trim() && images.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing input or image' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!normalizedInputType) {
      return new Response(
        JSON.stringify({ error: 'Missing inputType' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cacheKey = images.length === 0
      ? await computeCacheKey(safeInput, normalizedInputType, 0, aiSettings)
      : null;

    let sseController: ReadableStreamDefaultController | null = null;
    let sseStream: ReadableStream<Uint8Array> | null = null;

    if (stream) {
      sseStream = new ReadableStream<Uint8Array>({
        start(controller) {
          sseController = controller;
        },
      });
    }

    const sendEvent: StageSender = (stage, data) => {
      if (!sseController) return;
      const event = `data: ${JSON.stringify({ stage, ...data })}\n\n`;
      sseController.enqueue(new TextEncoder().encode(event));
    };

    const finishStream = (testCases: GeneratedTestCase[], extra?: Record<string, unknown>) => {
      sendEvent('complete', { testCases, ...extra });
      sseController?.close();
    };

    if (stream && sseStream) {
      const responsePromise = (async () => {
        try {
          const result = await runGenerationPipeline(aiSettings, safeInput, normalizedInputType, images, cacheKey, sendEvent);
          sendEvent('finalizing', { message: 'Finalizing output...' });
          finishStream(result.testCases, result.cached ? { cached: true } : undefined);
        } catch (error) {
          const message = typeof error === 'object' && error && 'errorText' in error
            ? String((error as ProviderFailure).errorText)
            : error instanceof Error
              ? error.message
              : 'Unknown error';
          sendEvent('error', { error: message });
          sseController?.close();
        }
      })();

      void responsePromise;

      return new Response(sseStream, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    const result = await runGenerationPipeline(aiSettings, safeInput, normalizedInputType, images, cacheKey);

    return new Response(
      JSON.stringify({
        testCases: result.testCases,
        ...(result.cached ? { cached: true } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    if (typeof error === 'object' && error && 'ok' in error && (error as ProviderFailure).ok === false) {
      const providerError = error as ProviderFailure;
      if (providerError.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (providerError.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: providerError.errorText || 'Failed to generate test cases' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.error('Error in generate-test-cases:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

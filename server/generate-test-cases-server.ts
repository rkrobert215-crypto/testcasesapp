import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateStructuredData } from '../supabase/functions/_shared/aiClient.ts';
import {
  analyzeRequirementText,
  type RequirementAnalysisResult,
} from '../supabase/functions/_shared/requirementAnalysis.ts';
import { computeRequestCacheKey, getCachedRequest, setCachedRequest } from '../supabase/functions/_shared/requestCache.ts';
import { generateReviewedStructuredData } from '../supabase/functions/_shared/reviewedStructuredGeneration.ts';
import {
  deduplicateGeneratedTestCases,
  normalizeGeneratedTestCases,
  testCaseCollectionSchema,
  type GeneratedTestCase,
} from '../supabase/functions/_shared/testCaseSchema.ts';
import {
  computeGenerateCacheKey,
  runGenerateTestCasePipeline,
} from '../supabase/functions/_shared/generateTestCasePipeline.ts';
import {
  getGenerationMode,
  getGenerationModeProfile,
  type GenerationMode,
} from '../supabase/functions/_shared/generationMode.ts';
import { formatRequirementInsights } from '../supabase/functions/_shared/qaPlanningContext.ts';
import {
  clarificationQuestionsSchema,
  scenarioMapSchema,
  testDataPlanSchema,
  testPlanSchema,
  traceabilityMatrixSchema,
} from '../supabase/functions/_shared/qaPlanningSchemas.ts';

const HOST = process.env.LOCAL_AI_SERVER_HOST || '127.0.0.1';
const PORT = Number(process.env.LOCAL_AI_SERVER_PORT || 8787);
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 50;
const PROMPT_VERSION = 'qa-pro-node-v1';
const GENERATION_TIME_BUDGET_MS = 20 * 60 * 1000;
const RETRY_STAGE_RESERVE_MS = 3 * 60 * 1000;
const FINALIZATION_RESERVE_MS = 60_000;
const FUNCTION_ROUTE_PREFIX = '/functions/v1';
const GENERATE_ROUTE_PATH = `${FUNCTION_ROUTE_PREFIX}/generate-test-cases`;
const LOCAL_FUNCTION_NAMES = new Set([
  'generate-test-cases',
  'requirement-analysis',
  'audit-test-cases',
  'smart-merge-testcases',
  'validate-coverage',
  'test-plan',
  'traceability-matrix',
  'test-data-plan',
  'scenario-map',
  'clarification-questions',
]);
const cache = new Map<string, { data: unknown; timestamp: number }>();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
};

type InputType = 'requirement' | 'highlevel' | 'testcase' | 'scenario' | 'expected';
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

hydrateLocalEnv();

function createLocalAiServer() {
  return createServer(async (req, res) => {
  setCorsHeaders(res);

  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const functionName = resolveLocalFunctionName(url.pathname);

  if (!functionName) {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const rawBody = await readRequestBody(req);
    const body = JSON.parse(rawBody || '{}') as Record<string, unknown>;
    if (functionName === 'generate-test-cases') {
      const { input, inputType, images, stream, aiSettings } = parseGenerationRequest(body);
      const cacheKey = images.length === 0
        ? await computeCacheKey(input, inputType, 0, aiSettings)
        : null;

      if (stream) {
        res.writeHead(200, {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const sendEvent: StageSender = (stage, data) => {
          res.write(`data: ${JSON.stringify({ stage, ...data })}\n\n`);
        };

        try {
          const result = await runGenerationPipeline(aiSettings, input, inputType, images, cacheKey, sendEvent);
          sendEvent('finalizing', { message: 'Finalizing output...' });
          sendEvent('complete', {
            testCases: result.testCases,
            ...(result.cached ? { cached: true } : {}),
          });
        } catch (error) {
          const providerError = toProviderFailure(error);
          sendEvent('error', {
            error: providerError?.errorText || (error instanceof Error ? error.message : 'Unknown error'),
          });
        } finally {
          res.end();
        }
        return;
      }

      const result = await runGenerationPipeline(aiSettings, input, inputType, images, cacheKey);
      sendJson(res, 200, {
        testCases: result.testCases,
        ...(result.cached ? { cached: true } : {}),
      });
      return;
    }

    const result = await handleLocalFunctionRoute(functionName, body);
    sendJson(res, 200, result);
  } catch (error) {
    const providerError = toProviderFailure(error);
    if (providerError) {
      sendJson(res, providerError.status, { error: providerError.errorText });
      return;
    }

    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
  });
}

if (isDirectServerEntry()) {
  const server = createLocalAiServer();
  server.listen(PORT, HOST, () => {
    console.log(`[local-ai-server] listening at http://${HOST}:${PORT}${FUNCTION_ROUTE_PREFIX}/<function-name>`);
  });
}

function isDirectServerEntry() {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
}

function hydrateLocalEnv() {
  const envFilePath = fileURLToPath(new URL('../supabase/functions/.env.local', import.meta.url));
  if (!existsSync(envFilePath)) {
    return;
  }

  const contents = readFileSync(envFilePath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

function setCorsHeaders(res: ServerResponse) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function resolveLocalFunctionName(pathname: string): string | null {
  const normalized =
    pathname.startsWith(`${FUNCTION_ROUTE_PREFIX}/`)
      ? pathname.slice(FUNCTION_ROUTE_PREFIX.length + 1)
      : pathname.startsWith('/')
        ? pathname.slice(1)
        : pathname;

  return LOCAL_FUNCTION_NAMES.has(normalized) ? normalized : null;
}

function readRequestBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

function parseGenerationRequest(body: Record<string, unknown>) {
  const input = typeof body.input === 'string' ? body.input : '';
  const inputType = normalizeInputType(body.inputType);
  const imagesBase64 = Array.isArray(body.imagesBase64)
    ? body.imagesBase64.filter((item): item is string => typeof item === 'string')
    : [];
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const images = imagesBase64.length > 0 ? imagesBase64 : imageBase64 ? [imageBase64] : [];

  if (!input.trim() && images.length === 0) {
    throw new Error('Missing input or image');
  }

  if (!inputType) {
    throw new Error('Missing inputType');
  }

  return {
    input,
    inputType,
    images,
    stream: body.stream === true,
    aiSettings: body.aiSettings,
  };
}

function normalizeInputType(value: unknown): InputType | null {
  return value === 'requirement' ||
    value === 'highlevel' ||
    value === 'testcase' ||
    value === 'scenario' ||
    value === 'expected'
    ? value
    : null;
}

export function isKnownAiFunction(functionName: string) {
  return LOCAL_FUNCTION_NAMES.has(functionName);
}

export async function handleHostedFunctionRequest(functionName: string, body: Record<string, unknown>) {
  if (!isKnownAiFunction(functionName)) {
    throw { ok: false, status: 404, errorText: 'Not found.' } satisfies ProviderFailure;
  }

  if (functionName === 'generate-test-cases') {
    const { input, inputType, images, aiSettings } = parseGenerationRequest(body);
    const cacheKey = images.length === 0
      ? await computeCacheKey(input, inputType, 0, aiSettings)
      : null;
    const result = await runGenerationPipeline(aiSettings, input, inputType, images, cacheKey);

    return {
      testCases: result.testCases,
      ...(result.cached ? { cached: true } : {}),
    };
  }

  return await handleLocalFunctionRoute(functionName, body);
}

async function computeCacheKey(
  input: string,
  inputType: string,
  imageCount: number,
  aiSettings: unknown
): Promise<string> {
  return await computeGenerateCacheKey(input, inputType as InputType, imageCount, aiSettings);
}

function getCached(key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      cache.delete(oldest);
    }
  }

  cache.set(key, { data, timestamp: Date.now() });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function hasTimeBudgetRemaining(startedAt: number, reserveMs: number) {
  return Date.now() - startedAt < GENERATION_TIME_BUDGET_MS - reserveMs;
}

function getReviewThreshold(generationMode: GenerationMode) {
  return getGenerationModeProfile(generationMode).reviewThreshold;
}

function buildFallbackReview(
  validation: { valid: boolean; violations: string[] },
  generationMode: GenerationMode,
  summary: string
): ReviewResult {
  const threshold = getReviewThreshold(generationMode);

  return {
    approved: validation.valid,
    qualityScore: validation.valid ? threshold : Math.max(threshold - 12, 70),
    summary,
    coverageGaps: validation.valid ? [] : validation.violations,
    duplicateConcerns: [],
    weakExpectedResults: [],
    namingIssues: [],
    enterpriseFieldIssues: [],
    improvementInstructions: validation.valid ? [] : validation.violations,
  };
}

function buildSystemPrompt(inputType: InputType, generationMode: GenerationMode) {
  const profile = getGenerationModeProfile(generationMode);
  return [
    INPUT_TYPE_PROMPTS[inputType] || INPUT_TYPE_PROMPTS.requirement,
    '',
    `GENERATION STYLE MODE: ${profile.label}`,
    ...profile.generatorPromptLines.map((line) => `- ${line}`),
    '- Think like a strong senior manual QA who separates meaningful validation, boundary, navigation, persistence, permission, and downstream-impact checks instead of collapsing them into a tiny suite.',
    '- Prefer fuller practical coverage for form-based and CRUD flows when the requirement supports it.',
    '- When a requirement is medium or large, favor a broad realistic suite over a compressed minimalist suite.',
  ].join('\n');
}

function isFormLikeRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'field',
    'form',
    'save',
    'cancel',
    'description',
    'name',
    'sku',
    'code',
    'active',
    'inactive',
    'button',
    'page',
    'list',
    'create',
    'new',
    'details',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  return hitCount >= 4 || (insights?.acceptanceCriteria.length ?? 0) >= 6;
}

function buildClassicCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isFormLikeRequirement(input, insights)) {
    return [];
  }

  return [
    'For this form-style / CRUD-style requirement, behave like a classic strong manual QA and cover the feature more broadly.',
    'Explicitly include separate meaningful cases for: navigation entry, page title/breadcrumbs, default values, create success, duplicate handling, save-button enable/disable rules, cancel behavior, read-only behavior after creation, active/inactive downstream visibility, and description/data reflection where relevant.',
    'Also include practical derived QA cases for field boundaries and usability where relevant: maximum length, over-maximum length, valid special characters, whitespace handling, tab order, toggle persistence before save, and repeated sequential creation.',
    'Do not drop these derived manual-testing cases merely because they are not written as explicit AC bullets when they are a natural tester-level extension of the requirement.',
    'Keep distinct scenario clusters separate instead of merging them into a few broad cases.',
    'For medium-complexity form requirements like this, target a broad senior-QA suite, usually around 30 to 35 test cases unless the requirement is truly tiny.',
  ];
}

function extractAuthorities(text: string): string[] {
  const upperKeywords = ['CAN_', 'HAS_', 'ALLOW_', 'MANAGE_', 'VIEW_', 'EDIT_', 'DELETE_', 'CREATE_', 'APPROVE_', 'REJECT_', 'READ_', 'WRITE_', 'ACCESS_'];
  const upperCaseMatches = text
    .split(/[\s,;:()[\]{}|"'`]+/)
    .map((token) => token.replace(/^[^A-Z_]+|[^A-Z_]+$/g, ''))
    .filter((token) => token.length > 3 && /^[A-Z_]+$/.test(token))
    .filter((token) => upperKeywords.some((keyword) => token.includes(keyword)));

  const camelRegex = /\b(can|has|allow|manage|view|edit|delete|create|approve|reject|access)[A-Z][a-zA-Z]{2,}\b/g;
  const camelMatches = [...text.matchAll(camelRegex)].map((match) => match[0]);

  return [...new Set([...upperCaseMatches, ...camelMatches])];
}

function detectPrimaryAction(input: string): string | null {
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
}

function estimateMinimumTestCases(
  inputType: InputType,
  input: string,
  insights: RequirementAnalysisResult | null
) {
  if (inputType === 'highlevel') {
    return Math.max(10, Math.min(20, (insights?.acceptanceCriteria.length ?? 0) * 2 || 10));
  }
  if (inputType === 'testcase' || inputType === 'expected') {
    return 1;
  }

  const bulletRegex = /^\s*[-*•]\s|^\s*\d+[.)]\s/;
  const bulletLines = input.split('\n').filter((line) => bulletRegex.test(line)).length;
  const paragraphCount = input.split(/\n\s*\n/).filter((paragraph) => paragraph.trim().length > 0).length;
  const acCount = insights?.acceptanceCriteria.length ?? 0;
  const formLike = isFormLikeRequirement(input, insights);
  const hasAuthorities = extractAuthorities(input).length > 0;

  let baseline = formLike ? 24 : 15;
  if (bulletLines >= 5 || input.length > 1000 || paragraphCount >= 3) baseline = 20;
  if (bulletLines >= 10 || input.length > 2000 || paragraphCount >= 6) baseline = 30;
  if (bulletLines >= 15 || input.length > 3000) baseline = 40;
  if (acCount > 0) baseline = Math.max(baseline, Math.min(70, acCount * 2));
  if (formLike) baseline = Math.max(baseline, 28);
  if (formLike && hasAuthorities) baseline = Math.max(baseline, 30);
  if (formLike && (input.length > 1200 || acCount >= 8)) baseline = Math.max(baseline, 32);

  return baseline;
}

function validateGeneratedCases(
  inputType: InputType,
  input: string,
  testCases: GeneratedTestCase[],
  insights: RequirementAnalysisResult | null
) {
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
    const hasPositive = testCases.some((testCase) => testCase.type === 'Positive');
    const hasNegative = testCases.some((testCase) => testCase.type === 'Negative');
    if (!hasPositive || !hasNegative) {
      violations.push('Output must include both Positive and Negative test cases.');
    }
  }

  const missingEnterpriseFields = testCases.filter(
    (testCase) =>
      !testCase.requirementReference ||
      !testCase.module ||
      !testCase.priority ||
      !testCase.testData ||
      !testCase.postCondition
  );
  if (missingEnterpriseFields.length > 0) {
    violations.push('Some test cases are missing enterprise fields like requirementReference, module, priority, testData, or postCondition.');
  }

  const invalidTitles = testCases.filter((testCase) => {
    const lower = testCase.testCase.toLowerCase();
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
    const preferredCount = testCases.filter((testCase) => testCase.testCase.toLowerCase().startsWith(preferredStarter)).length;
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
      .filter((pointId) => !testCases.some((testCase) => testCase.requirementReference.includes(pointId)));

    if (missingPointIds.length > 0) {
      violations.push(`Requirement references missing from testcase suite: ${missingPointIds.join(', ')}.`);
    }
  }

  return { valid: violations.length === 0, violations };
}

function buildInsightSummary(insights: RequirementAnalysisResult | null) {
  if (!insights) return '';

  const acceptanceCriteriaLines = insights.acceptanceCriteria
    .map(
      (point) =>
        `${point.id} [${point.sourceType}] [${point.priority}] [${point.moduleHint}] ${point.criterion}\nMeaning: ${point.plainEnglishMeaning}\nWhat to test: ${point.whatToTest.join(' | ')}\nHow to test: ${point.howToTest.join(' | ')}`
    )
    .join('\n\n');

  return [
    'Requirement intelligence:',
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
    'Acceptance criteria / derived requirement points:',
    acceptanceCriteriaLines || 'No structured requirement points available.',
  ].join('\n');
}

function buildInstructionText(
  input: string,
  images: string[],
  inputType: InputType,
  insights: RequirementAnalysisResult | null,
  generationMode: GenerationMode
) {
  const profile = getGenerationModeProfile(generationMode);
  const preferredStarter = insights?.recommendedStarter || 'Verify that the user';
  const formLike = isFormLikeRequirement(input, insights);
  const lines = [
    'Generate enterprise-quality test cases in structured form.',
    'Return the complete testcase suite with these exact fields for every row: id, requirementReference, module, priority, coverageArea, scenario, testCase, testData, preconditions, testSteps, expectedResult, postCondition, type.',
    'Do not return markdown or commentary.',
    '',
    `GENERATION STYLE MODE: ${profile.label}`,
    ...profile.generatorPromptLines.map((line) => `- ${line}`),
    '',
    'MANDATORY OUTPUT QUALITY RULES:',
    '- Read every line of the requirement and map each acceptance criteria point to one or more test cases.',
    '- Include both Positive and Negative scenarios where appropriate.',
    '- Do not invent roles, authorities, statuses, or features that are not in the requirement.',
    '- Make the suite read like a senior QA deliverable, not generic AI output.',
    '- Use practical business modules, priority, test data, and post-condition fields.',
    '- requirementReference must point to AC IDs or derived requirement IDs such as AC-01 or REQ-03.',
    '- For standard functional cases, prefer the recommended actor-based starter phrase from requirement analysis.',
    '- Do not compress distinct meaningful checks into one case when a senior QA would keep them separate.',
    '- Include practical derived coverage beyond explicit AC wording when it is a natural manual-testing extension of the requirement.',
    '- If a requirement supports additional realistic field-validation or UI-behavior coverage, include it instead of stopping at the minimum explicit AC count.',
  ];

  if (generationMode === 'rob_style') {
    lines.push(
      `- Strongly prefer testcase titles that begin with "${preferredStarter}" or a closely matching actor-based phrase.`,
      '- Keep the writing human, practical, browser-focused, and close to a clean senior QA workbook style.',
      '- Make permission and authority wording exact whenever the requirement depends on it.',
      '- Keep expected results crisp, direct, and observable instead of padded.',
    );
  } else if (generationMode === 'yuv_style') {
    lines.push(
      '- Keep the suite broad and execution-oriented with clear module, page, UI, and navigation coverage.',
      '- Separate meaningful list, table, sort, filter, state, and downstream-visibility checks when they represent different user risks.',
      '- Prefer stronger functional breadth over polished but narrow coverage.',
    );
  } else if (generationMode === 'swag_style') {
    lines.push(
      '- Keep the suite benchmark-driven and broad across common modern web-app UI patterns and business states.',
      '- Explicitly include reusable web-app QA patterns such as forms, inputs, dropdowns, radios, uploads, drag-and-drop, grids, filters, sorts, exports, refresh behavior, and persistence when relevant.',
      '- Prefer benchmark-worthy completeness over narrow or over-compressed output.',
    );
  } else {
    lines.push(
      '- Keep the suite formal, traceable, and ready for professional QA review boards or client sharing.',
      '- Make module names, priority, test data, and post-condition fields especially strong and useful.',
      '- Favor concise, enterprise-standard wording over casual phrasing.',
    );
  }

  if (formLike) {
    lines.push(
      '- This is a form-style / CRUD-style requirement, so expand the suite the way a strong senior QA would.',
      '- Include separate practical cases for field validation, boundary length, duplicate handling, default values, save-button behavior, cancel/navigation behavior, and downstream data visibility where relevant.',
      '- If text or identifier fields are present, include realistic checks for max length, over-limit input, special characters, and leading/trailing spaces when those are meaningful to the requirement.',
      '- Keep boundary and UI/navigation cases separate if they represent different real user risks.',
      '- Target a fuller suite, typically around 28 to 35 cases for a medium-complexity form requirement unless the requirement is genuinely tiny.',
    );
    lines.push(...buildClassicCoverageChecklist(input, insights).map((line) => `- ${line}`));
  }

  if (insights) {
    lines.push('', buildInsightSummary(insights));
  }

  if (input.trim()) {
    lines.push('', 'Requirement/Input:', input.trim());
  }

  if (images.length > 0) {
    lines.push(
      '',
      `Attached visual context: ${images.length} screenshot(s) or mockup(s). Analyze visible UI elements, buttons, forms, messages, and flows so the testcase suite covers both text and UI.`
    );
  }

  if (inputType === 'testcase') {
    lines.push('', 'Preserve the original testcase intent while upgrading the remaining fields.');
  }

  return lines.join('\n');
}

async function maybeAnalyzeRequirement(
  aiSettings: unknown,
  inputType: InputType,
  input: string
): Promise<RequirementAnalysisResult | null> {
  if (!input.trim()) return null;
  if (inputType !== 'requirement' && inputType !== 'highlevel' && inputType !== 'scenario') {
    return null;
  }

  try {
    return await analyzeRequirementText(aiSettings, input, 'generate-test-cases-analysis');
  } catch (error) {
    console.warn('[local-ai-server] requirement analysis skipped:', error);
    return null;
  }
}

async function callAiProvider(
  aiSettings: unknown,
  systemPrompt: string,
  userContent: UserPromptPart[]
): Promise<ProviderResult> {
  try {
    const parsed = await generateStructuredData<{ testCases: unknown[] }>({
      aiSettings,
      systemPrompt,
      userParts: userContent,
      featureName: 'generate-test-cases-node',
      output: {
        name: 'return_test_cases',
        description: 'Return the generated test cases as structured data.',
        schema: testCaseCollectionSchema as unknown as Record<string, unknown>,
      },
    });

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
}

async function reviewGeneratedCases(
  aiSettings: unknown,
  input: string,
  inputType: InputType,
  insights: RequirementAnalysisResult | null,
  generationMode: GenerationMode,
  testCases: GeneratedTestCase[]
): Promise<ReviewResult> {
  const profile = getGenerationModeProfile(generationMode);
  const threshold = getReviewThreshold(generationMode);
  return generateStructuredData<ReviewResult>({
    aiSettings,
    featureName: 'generate-test-cases-review-node',
    systemPrompt: `You are a QA test lead with 15+ years of experience reviewing testcase suites created by other QA engineers.

Review the provided testcase suite as if you are approving it for real project use.

Generation style mode: ${profile.label}
Minimum approval score: ${threshold}. If the suite is below that score, do not approve it.

STYLE EXPECTATIONS:
${profile.reviewerLines.map((line) => `- ${line}`).join('\n')}

CHECKLIST:
- Does it cover the full requirement and each acceptance-criteria point?
- Does it avoid duplication and generic filler cases?
- Do testcase titles sound professional and actor-based, especially using the recommended starter where appropriate?
- Are expected results concrete and observable?
- Are enterprise fields present and useful: requirementReference, module, priority, testData, postCondition?
- Does the suite feel like senior manual QA work?
- Do not reject strong derived boundary, validation, whitespace, special-character, navigation, title/breadcrumb, persistence, and repeated-action cases just because they are not written as explicit AC bullets.
- For form-like requirements, prefer a fuller senior-QA suite over an overly compressed one.
- For form-like requirements, penalize suites that miss classic manual-QA areas such as max length, over-limit input, special characters, whitespace handling, title/breadcrumbs, tab order, or sequential execution when the requirement clearly contains editable fields and navigation.

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
            'Requirement:',
            input.trim() || 'No text input provided.',
            '',
            'Generated testcase suite to review:',
            JSON.stringify(testCases, null, 2),
          ].join('\n'),
        },
      ],
    output: {
      name: 'return_test_case_review',
      description: 'Return a structured senior-QA review of the testcase suite.',
      schema: reviewSchema as unknown as Record<string, unknown>,
    },
  });
}

function buildCorrectionInstruction(
  validation: { violations: string[] },
  review: ReviewResult,
  insights: RequirementAnalysisResult | null,
  generationMode: GenerationMode
) {
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
}

function isReviewApproved(
  validation: { valid: boolean; violations: string[] },
  review: ReviewResult,
  generationMode: GenerationMode
) {
  const threshold = getReviewThreshold(generationMode);
  return validation.valid && review.approved && review.qualityScore >= threshold;
}

function scoreCandidate(
  validation: { valid: boolean; violations: string[] },
  review: ReviewResult,
  testCases: GeneratedTestCase[]
) {
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
}

async function runGenerationPipeline(
  aiSettings: unknown,
  input: string,
  inputType: InputType,
  images: string[],
  cacheKey: string | null,
  sendEvent?: StageSender
): Promise<{ testCases: GeneratedTestCase[]; cached?: boolean }> {
  return await runGenerateTestCasePipeline({
    aiSettings,
    input,
    inputType,
    images,
    cacheKey,
    sendEvent,
  });
}

async function handleLocalFunctionRoute(functionName: string, body: Record<string, unknown>) {
  switch (functionName) {
    case 'requirement-analysis':
      return await handleRequirementAnalysis(body);
    case 'audit-test-cases':
      return await handleAuditTestCases(body);
    case 'smart-merge-testcases':
      return await handleSmartMerge(body);
    case 'validate-coverage':
      return await handleValidateCoverage(body);
    case 'test-plan':
      return await handleTestPlan(body);
    case 'traceability-matrix':
      return await handleTraceabilityMatrix(body);
    case 'test-data-plan':
      return await handleTestDataPlan(body);
    case 'scenario-map':
      return await handleScenarioMap(body);
    case 'clarification-questions':
      return await handleClarificationQuestions(body);
    default:
      throw { ok: false, status: 404, errorText: 'Not found.' } satisfies ProviderFailure;
  }
}

async function handleRequirementAnalysis(body: Record<string, unknown>) {
  const requirement = String(body.requirement ?? '').trim();
  const aiSettings = body.aiSettings;

  if (!requirement) {
    throw { ok: false, status: 400, errorText: 'Missing requirement' } satisfies ProviderFailure;
  }

  return await analyzeRequirementText(aiSettings, requirement, 'requirement-analysis');
}

async function handleAuditTestCases(body: Record<string, unknown>) {
  const requirement = String(body.requirement ?? '').trim();
  const images = Array.isArray(body.imagesBase64)
    ? body.imagesBase64.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const existingTestCases = Array.isArray(body.existingTestCases) ? body.existingTestCases : [];
  const requestedCoverageGaps = Array.isArray(body.focusMissingScenarios)
    ? body.focusMissingScenarios.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const aiSettings = body.aiSettings;
  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = images.length === 0
    ? await computeRequestCacheKey('audit-test-cases', aiSettings, {
        requirement,
        existingTestCases,
        focusMissingScenarios: requestedCoverageGaps,
      })
    : null;

  if (cacheKey) {
    const cached = getCachedRequest<{ testCases: ReturnType<typeof normalizeGeneratedTestCases> }>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const requirementInsights = requirement
    ? await analyzeRequirementText(aiSettings, requirement, 'audit-test-cases-analysis')
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

  const userParts: UserPromptPart[] = [
    {
      type: 'text',
      text: [
        `Generation style mode: ${generationProfile.label}`,
        ``,
        `Requirement:`,
        requirement || 'No text requirement provided.',
        ``,
        analysisText,
        ``,
        `Existing test cases:`,
        JSON.stringify(existingTestCases, null, 2),
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
    ...images.map((dataUrl) => ({ type: 'image', dataUrl } satisfies UserPromptPart)),
  ];

  const parsed = await generateReviewedStructuredData<{ testCases: unknown[] }>({
    aiSettings,
    artifactLabel: 'gap-filling audited testcase suite',
    systemPrompt,
    userParts,
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

  return responseBody;
}

async function handleSmartMerge(body: Record<string, unknown>) {
  const files = Array.isArray(body.files) ? body.files as Record<string, string>[][] : null;
  const aiSettings = body.aiSettings;

  if (!files || files.length === 0) {
    throw { ok: false, status: 400, errorText: 'No files provided' } satisfies ProviderFailure;
  }

  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey('smart-merge-testcases', aiSettings, { files });
  const cached = getCachedRequest<{ testCases: ReturnType<typeof normalizeGeneratedTestCases> }>(cacheKey);
  if (cached) {
    return cached;
  }

  const allRows: Record<string, string>[] = [];
  files.forEach((fileRows) => {
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

  const responseBody = { testCases: normalized };
  setCachedRequest(cacheKey, responseBody);
  return responseBody;
}

async function handleValidateCoverage(body: Record<string, unknown>) {
  const input = typeof body.input === 'string' ? body.input : '';
  const inputType = typeof body.inputType === 'string' ? body.inputType : 'requirement';
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const images = Array.isArray(body.imagesBase64)
    ? body.imagesBase64.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : (imageBase64 ? [imageBase64] : []);
  const testCases = Array.isArray(body.testCases) ? body.testCases : [];
  const aiSettings = body.aiSettings;

  if (testCases.length === 0) {
    throw { ok: false, status: 400, errorText: 'No test cases to validate' } satisfies ProviderFailure;
  }

  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = images.length === 0
    ? await computeRequestCacheKey('validate-coverage', aiSettings, { input, inputType, testCases })
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
      return cached;
    }
  }

  const userParts: UserPromptPart[] = [];
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
  userParts.push({ type: 'text', text: validationPrompt });
  for (const image of images) {
    userParts.push({ type: 'image', dataUrl: image });
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
    userParts,
    output: {
      name: 'return_coverage_analysis',
      description: 'Return the structured coverage analysis result.',
      schema: {
        type: 'object',
        properties: {
          coverageScore: { type: 'number' },
          summary: { type: 'string' },
          coveredAreas: { type: 'array', items: { type: 'string' } },
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

  if (cacheKey) {
    setCachedRequest(cacheKey, parsed);
  }
  return parsed;
}

async function handleTestPlan(body: Record<string, unknown>) {
  const requirement = String(body.requirement ?? '').trim();
  const aiSettings = body.aiSettings;

  if (!requirement) {
    throw { ok: false, status: 400, errorText: 'Missing requirement' } satisfies ProviderFailure;
  }

  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey('test-plan', aiSettings, { requirement });
  const cached = getCachedRequest<unknown>(cacheKey);
  if (cached) {
    return cached;
  }

  const requirementInsights = await analyzeRequirementText(aiSettings, requirement, 'test-plan-analysis');
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
          requirement,
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
  return parsed;
}

async function handleTraceabilityMatrix(body: Record<string, unknown>) {
  const requirement = String(body.requirement ?? '').trim();
  const testCases = Array.isArray(body.testCases) ? body.testCases : [];
  const aiSettings = body.aiSettings;

  if (!requirement) {
    throw { ok: false, status: 400, errorText: 'Missing requirement' } satisfies ProviderFailure;
  }

  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey('traceability-matrix', aiSettings, { requirement, testCases });
  const cached = getCachedRequest<unknown>(cacheKey);
  if (cached) {
    return cached;
  }

  const requirementInsights = await analyzeRequirementText(aiSettings, requirement, 'traceability-matrix-analysis');
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
          requirement,
          ``,
          formatRequirementInsights(requirementInsights),
          ``,
          `Existing testcases for coverage comparison:`,
          testCases.length > 0 ? JSON.stringify(testCases, null, 2) : 'No existing testcases provided.',
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
  return parsed;
}

async function handleTestDataPlan(body: Record<string, unknown>) {
  const requirement = String(body.requirement ?? '').trim();
  const aiSettings = body.aiSettings;

  if (!requirement) {
    throw { ok: false, status: 400, errorText: 'Missing requirement' } satisfies ProviderFailure;
  }

  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey('test-data-plan', aiSettings, { requirement });
  const cached = getCachedRequest<unknown>(cacheKey);
  if (cached) {
    return cached;
  }

  const requirementInsights = await analyzeRequirementText(aiSettings, requirement, 'test-data-plan-analysis');
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
          requirement,
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
  return parsed;
}

async function handleScenarioMap(body: Record<string, unknown>) {
  const requirement = String(body.requirement ?? '').trim();
  const aiSettings = body.aiSettings;

  if (!requirement) {
    throw { ok: false, status: 400, errorText: 'Missing requirement' } satisfies ProviderFailure;
  }

  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey('scenario-map', aiSettings, { requirement });
  const cached = getCachedRequest<unknown>(cacheKey);
  if (cached) {
    return cached;
  }

  const requirementInsights = await analyzeRequirementText(aiSettings, requirement, 'scenario-map-analysis');
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
          requirement,
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
  return parsed;
}

async function handleClarificationQuestions(body: Record<string, unknown>) {
  const requirement = String(body.requirement ?? '').trim();
  const aiSettings = body.aiSettings;

  if (!requirement) {
    throw { ok: false, status: 400, errorText: 'Missing requirement' } satisfies ProviderFailure;
  }

  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey('clarification-questions', aiSettings, { requirement });
  const cached = getCachedRequest<unknown>(cacheKey);
  if (cached) {
    return cached;
  }

  const requirementInsights = await analyzeRequirementText(aiSettings, requirement, 'clarification-questions-analysis');
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
          requirement,
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
  return parsed;
}

export function toProviderFailure(error: unknown): ProviderFailure | null {
  if (typeof error === 'object' && error && 'ok' in error && (error as ProviderFailure).ok === false) {
    const providerError = error as ProviderFailure;
    if (providerError.status === 429) {
      return { ok: false, status: 429, errorText: 'Rate limit exceeded. Please try again in a moment.' };
    }
    if (providerError.status === 402) {
      return { ok: false, status: 402, errorText: 'AI credits exhausted. Please add credits to continue.' };
    }
    return providerError;
  }

  return null;
}

import { generateStructuredData } from './aiClient.ts';
import {
  analyzeRequirementText,
  type RequirementAnalysisResult,
} from './requirementAnalysis.ts';
import {
  deduplicateGeneratedTestCases,
  normalizeGeneratedTestCases,
  testCaseCollectionSchema,
  type GeneratedTestCase,
} from './testCaseSchema.ts';
import {
  computeRequestCacheKey,
  getCachedRequest,
  setCachedRequest,
} from './requestCache.ts';
import {
  getGenerationMode,
  getGenerationModeProfile,
  isStrictRequirementMode,
  type GenerationMode,
} from './generationMode.ts';

export type InputType = 'requirement' | 'highlevel' | 'testcase' | 'scenario' | 'expected';
export type UserPromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string };
export type StageSender = (stage: string, data?: Record<string, unknown>) => void;

export type ProviderSuccess = { ok: true; testCases: GeneratedTestCase[] };
export type ProviderFailure = { ok: false; status: number; errorText: string };
type ProviderResult = ProviderSuccess | ProviderFailure;

interface GeneratePipelineOptions {
  aiSettings: unknown;
  input: string;
  inputType: InputType;
  images: string[];
  cacheKey?: string | null;
  sendEvent?: StageSender;
}

interface GeneratePipelineResult {
  testCases: GeneratedTestCase[];
  cached?: boolean;
}

const GENERATE_CACHE_VERSION = 'generate-test-cases-2026-04-08-v8';

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

export function normalizeInputType(value: unknown): InputType | null {
  return value === 'requirement' ||
    value === 'highlevel' ||
    value === 'testcase' ||
    value === 'scenario' ||
    value === 'expected'
    ? value
    : null;
}

export async function computeGenerateCacheKey(
  input: string,
  inputType: InputType,
  imageCount: number,
  aiSettings: unknown
): Promise<string> {
  return await computeRequestCacheKey(`generate-test-cases::${GENERATE_CACHE_VERSION}`, aiSettings, {
    inputType,
    input: input.trim().toLowerCase(),
    imageCount,
  });
}

function buildSystemPrompt(
  inputType: InputType,
  generationMode: GenerationMode,
  strictRequirementMode: boolean
) {
  const profile = getGenerationModeProfile(generationMode);
  const lines = [
    INPUT_TYPE_PROMPTS[inputType] || INPUT_TYPE_PROMPTS.requirement,
    '',
    `GENERATION STYLE MODE: ${profile.label}`,
    ...profile.generatorPromptLines.map((line) => `- ${line}`),
    '- Think like a strong senior manual QA who separates meaningful validation, boundary, navigation, persistence, permission, and downstream-impact checks instead of collapsing them into a tiny suite.',
    '- Prefer fuller practical coverage for form-based and CRUD flows when the requirement supports it.',
    '- When list, table, grid, search, filter, sort, page, or details-view behavior is present, cover those user-visible behaviors explicitly instead of assuming they are implied.',
    '- When permissions or authorities are present, keep permission-pair coverage explicit and exact instead of hiding it inside broad generic rows.',
    '- When tenant settings, feature flags, enabled/disabled states, or policy toggles drive behavior, cover those state combinations explicitly.',
    '- When login, MFA, OTP, authentication, redirect, or enrollment behavior is present, cover redirect targets, visible messages, and role-specific flows explicitly.',
    '- When onboarding, account setup, customer/supplier/buyer/reseller actors, notifications, emails, exports, or API/network-driven side effects are present, keep those scenario clusters explicit instead of implied.',
    '- When a requirement is medium or large, favor a broad realistic suite over a compressed minimalist suite.',
  ];

  if (strictRequirementMode) {
    lines.push(
      '- STRICT EXACT REQUIREMENT MODE is enabled.',
      '- Stay tightly anchored to the stated requirement, acceptance criteria, labels, config keys, rule names, and fixed logic terms.',
      '- Do not invent derived UI/setup/configuration flows unless they are an immediate tester-level extension of a stated behavior.',
      '- When the requirement contains exact labels, config keys, or logic names, preserve them throughout the suite instead of replacing them with generic examples.'
    );
  }

  return lines.join('\n');
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

function isListLikeRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'list',
    'grid',
    'table',
    'search',
    'filter',
    'sort',
    'column',
    'row',
    'details page',
    'details view',
    'results',
    'pagination',
    'empty state',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}

function isConfigLikeRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'tenant',
    'setting',
    'settings',
    'enabled',
    'disabled',
    'toggle',
    'configuration',
    'config',
    'feature flag',
    'preview permission',
    'manage permission',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}

function isAuthLikeRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'login',
    'log in',
    'sign in',
    'password',
    'otp',
    'mfa',
    'authentication',
    'redirect',
    'enrollment',
    'snackbar',
    'invalid username',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}

function isSideEffectRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'export',
    'download',
    'import',
    'email',
    'notification',
    'toast',
    'snackbar',
    'api',
    'network',
    'sync',
    'lambda',
    'webhook',
    'audit log',
    'background job',
    'response',
    'request',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}

function isOnboardingLikeRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'onboarding',
    'setup',
    'account setting',
    'account settings',
    'profile',
    'configuration',
    'config',
    'preference',
    'tenant setting',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}

function hasMultiActorSignals(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = ['buyer', 'supplier', 'customer', 'reseller', 'vendor', 'admin', 'tenant', 'user'];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}

function isAccessibilityRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'accessibility',
    'keyboard',
    'focus',
    'tab key',
    'screen reader',
    'aria',
    'label',
    'accessible',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}

function isResponsiveRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'responsive',
    'mobile',
    'tablet',
    'desktop',
    'touch',
    'small screen',
    'viewport',
    'orientation',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}

function isBrowserCompatibilityRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'browser',
    'chrome',
    'edge',
    'firefox',
    'safari',
    'cross-browser',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}

function isConcurrencyRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'concurrent',
    'same record',
    'another user',
    'multi-user',
    'double click',
    'double submit',
    'stale',
    'conflict',
    'lock',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}

function isPerformanceRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'performance',
    'large data',
    'large volume',
    'slow',
    'loading',
    'spinner',
    'timeout',
    'heavy list',
    'bulk',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}

function isApiDbRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'api',
    'request payload',
    'response',
    'database',
    'db',
    'rollback',
    'retry',
    'persistence',
    'duplicate save',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
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

function buildListCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isListLikeRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has list, grid, table, or page-behavior signals. Cover it the way a strong senior QA would, not just the core happy path.',
    'Explicitly include meaningful cases for default sort, reverse sort, filter/search behavior, empty state, row selection or row-click navigation, and details-page reflection where relevant.',
    'If columns, statuses, badges, buttons, or actions are visible in the list view, cover their visibility, state behavior, and permission-driven access when relevant.',
    'Keep list behavior, navigation behavior, and downstream data-reflection behavior separate when they represent different real user risks.',
  ];
}

function buildConfigCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isConfigLikeRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has tenant-setting, configuration, feature-flag, or enabled/disabled behavior. Cover both visibility and behavior changes, not just one happy path.',
    'Explicitly include meaningful cases for enabled vs disabled settings, allowed vs unauthorized users, and the resulting visible or hidden UI/actions when those represent different outcomes.',
    'When a feature depends on both a setting and a permission, keep the combinations separate instead of merging them into one broad testcase.',
  ];
}

function buildAuthCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isAuthLikeRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has login, MFA, OTP, authentication, or redirect behavior. Cover valid and invalid entry paths, redirect behavior, setup/enrollment screens, and user-facing messages when they are relevant.',
    'Explicitly include meaningful cases for tenant mode or policy on/off, role-specific user behavior, correct redirect target, and visible explanatory messages or errors when those are part of the flow.',
    'Keep authentication state, message validation, and redirect validation separate when they represent different real risks.',
  ];
}

function buildSideEffectCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isSideEffectRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has export, import, email, notification, API/network, or background side-effect behavior.',
    'Keep trigger behavior, visible feedback, generated output, and reflected downstream state as separate checks when they represent different real risks.',
    'If export or download exists, cover action availability, generated output, and post-action reflection or visibility where relevant.',
    'If notification, email, toast, or snackbar behavior exists, cover the exact trigger condition, visible message or delivery outcome, and non-trigger behavior when relevant.',
    'If API/network or sync behavior exists, cover the user-visible or business-visible result of that side effect instead of assuming the backend outcome is automatically implied.',
  ];
}

function buildOnboardingCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isOnboardingLikeRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has onboarding, account setup, or settings/configuration behavior.',
    'Cover setup entry, field/state behavior, save/apply behavior, persisted state after refresh, and downstream reflection in the affected module when relevant.',
    'If the flow depends on tenant settings, account status, or configuration combinations, keep those combinations explicit instead of implied.',
  ];
}

function buildMultiActorCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!hasMultiActorSignals(input, insights)) {
    return [];
  }

  return [
    'This requirement has multiple actor or role signals such as buyer, supplier, customer, reseller, vendor, admin, tenant, or user.',
    'Keep actor-specific visibility, action behavior, redirect behavior, and reflected outcomes separate when different actors experience different results.',
    'Do not merge actor-specific scenarios into one generic testcase if the requirement suggests different risks or outcomes by role.',
  ];
}

function buildAccessibilityCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isAccessibilityRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has accessibility, keyboard, focus, label, or ARIA signals.',
    'Cover keyboard navigation, focus order/visibility, labels or accessible names, and accessible error or dialog behavior when relevant.',
    'Keep accessibility behavior separate from generic visual checks when the risk is different.',
  ];
}

function buildResponsiveCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isResponsiveRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has responsive, mobile, tablet, desktop, or touch-behavior signals.',
    'Cover desktop/tablet/mobile differences, overflow or truncation issues, touch behavior, and small-screen visibility/layout changes when relevant.',
    'Keep responsive or touch behavior separate from standard desktop-only checks when the risk is different.',
  ];
}

function buildBrowserCompatibilityChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isBrowserCompatibilityRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has browser-compatibility signals.',
    'Cover the intended browser set explicitly and keep browser-specific control, layout, upload/download, or date-input behavior separate when relevant.',
  ];
}

function buildConcurrencyCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isConcurrencyRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has concurrency, multi-user, stale-data, or duplicate-submit signals.',
    'Cover same-record updates by multiple users, stale data handling, conflict behavior, and duplicate click/submit protection when relevant.',
    'Keep conflict handling and duplicate-submit protection separate when they represent different real risks.',
  ];
}

function buildPerformanceCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isPerformanceRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has performance, heavy-data, loading-state, or slowness signals.',
    'Cover slow response handling, spinner/loading-state quality, large-data usability, and degraded-but-usable behavior when relevant.',
    'Keep performance/loading behavior separate from final data correctness when they represent different risks.',
  ];
}

function buildApiDbCoverageChecklist(input: string, insights: RequirementAnalysisResult | null) {
  if (!isApiDbRequirement(input, insights)) {
    return [];
  }

  return [
    'This requirement has API, DB, payload, response, retry, rollback, or persistence-verification signals.',
    'Cover request/response handling, persistence/reflected state, retry or failure handling, rollback or partial-save handling, and duplicate-save protection when relevant.',
    'Keep user-visible or business-visible effects explicit instead of assuming the backend result is automatically understood.',
  ];
}

function extractExactRequirementTerms(input: string): string[] {
  const camelCaseTerms = [...input.matchAll(/\b[a-z]+(?:[A-Z][a-zA-Z0-9]+)+\b/g)].map((match) => match[0]);
  const snakeCaseTerms = [...input.matchAll(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g)].map((match) => match[0]);
  const allCapsTerms = [...input.matchAll(/\b[A-Z]{2,}(?:_[A-Z0-9]+)*\b/g)].map((match) => match[0]);
  const quotedTerms = [...input.matchAll(/["']([A-Za-z0-9_\- ]{2,})["']/g)].map((match) => match[1].trim());
  const specificLabels = ['ALL', 'textRules', 'numericRules'].filter((term) => input.includes(term));

  return [
    ...new Set(
      [...camelCaseTerms, ...snakeCaseTerms, ...allCapsTerms, ...quotedTerms, ...specificLabels]
        .filter((term) => term.length >= 3)
        .filter((term) => term.toLowerCase() !== 'story')
    ),
  ].slice(0, 20);
}

function isConfigDrivenFilterRequirement(input: string, insights: RequirementAnalysisResult | null) {
  const lower = input.toLowerCase();
  const signals = [
    'filter',
    'filters',
    'pill',
    'pills',
    'all filter',
    'orderlistgroups',
    'orderlistgroupstoinclude',
    'fulfillmentstatustoinclude',
    'textrules',
    'numericrules',
    'or behavior',
    'duplicate results',
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(' ') || '';
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 4 || criteriaHitCount >= 3;
}

function buildRequirementFidelityChecklist(input: string, strictRequirementMode: boolean) {
  const exactTerms = extractExactRequirementTerms(input);
  if (exactTerms.length === 0) {
    return [];
  }

  const checklist = [
    `The requirement contains exact labels, config keys, or technical terms: ${exactTerms.join(', ')}.`,
    'Keep exact requirement terms visible where they matter instead of replacing them with generic examples or made-up business values.',
    'If the requirement defines named labels, config keys, rules, flags, or fixed filter values, create cases around those exact behaviors instead of drifting into a generic feature interpretation.',
  ];

  if (strictRequirementMode) {
    checklist.push(
      'Strict exact requirement mode is enabled, so preserve most or all of those exact terms when they represent real user-visible or rule-driven behavior.',
      'Do not replace exact requirement values with placeholder examples, generic labels, or renamed business terms.'
    );
  }

  return checklist;
}

function buildConfigDrivenFilterChecklist(
  input: string,
  insights: RequirementAnalysisResult | null,
  strictRequirementMode: boolean
) {
  if (!isConfigDrivenFilterRequirement(input, insights)) {
    return [];
  }

  const checklist = [
    'This is a config-driven list/filter behavior requirement. Keep the testcase suite centered on the target list page behavior, not on an invented configuration-management UI.',
    'Create direct cases for exact filter rendering behavior such as clickable pills, ALL visibility rules, default selected state, configured order, single-select behavior, multi-select OR behavior, and ALL clearing other filters when those are stated.',
    'Create direct cases for exact rule-evaluation behavior such as OR across rules, AND within a rule, missing attributes evaluating false, invalid config entries being ignored, coexistence with existing status filters, and duplicate results not appearing when those are stated.',
    'Do not invent admin/configuration screens, add/remove filter workflows, unsaved-changes modals, hierarchical grouping, expand-collapse sections, or generic sample grouping values unless the requirement explicitly mentions them.',
    'When the requirement names exact config keys, logic terms, or fixed labels, preserve them in coverage instead of replacing them with placeholder values like Region or Product Category.',
  ];

  if (strictRequirementMode) {
    checklist.push(
      'Strict exact requirement mode is enabled, so keep testcase wording tightly aligned to the stated filter names, config keys, rule terms, and acceptance-criteria logic.'
    );
  }

  return checklist;
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

function buildAuthorityCoverageChecklist(text: string): string[] {
  const authorities = extractAuthorities(text);
  if (authorities.length === 0) {
    return [];
  }

  return [
    `The requirement explicitly references authorities or permissions: ${authorities.join(', ')}.`,
    'Include separate meaningful permission cases for with-authority, without-authority, wrong-authority, action visibility, and action execution whenever those represent different real user outcomes.',
    'Keep permission names exact. Do not paraphrase, invent, or generalize them away.',
  ];
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
  const normalizedInput = input.replaceAll('•', '-');
  const bulletLines = normalizedInput.split('\n').filter((line) => bulletRegex.test(line)).length;
  const paragraphCount = input.split(/\n\s*\n/).filter((paragraph) => paragraph.trim().length > 0).length;
  const acCount = insights?.acceptanceCriteria.length ?? 0;
  const formLike = isFormLikeRequirement(input, insights);
  const hasAuthorities = extractAuthorities(input).length > 0;
  const listLike = isListLikeRequirement(input, insights);
  const onboardingLike = isOnboardingLikeRequirement(input, insights);
  const sideEffectLike = isSideEffectRequirement(input, insights);
  const multiActorLike = hasMultiActorSignals(input, insights);
  const accessibilityLike = isAccessibilityRequirement(input, insights);
  const responsiveLike = isResponsiveRequirement(input, insights);
  const browserLike = isBrowserCompatibilityRequirement(input, insights);
  const concurrencyLike = isConcurrencyRequirement(input, insights);
  const performanceLike = isPerformanceRequirement(input, insights);
  const apiDbLike = isApiDbRequirement(input, insights);

  let baseline = formLike ? 24 : 15;
  if (bulletLines >= 5 || input.length > 1000 || paragraphCount >= 3) baseline = 20;
  if (bulletLines >= 10 || input.length > 2000 || paragraphCount >= 6) baseline = 30;
  if (bulletLines >= 15 || input.length > 3000) baseline = 40;
  if (acCount > 0) baseline = Math.max(baseline, Math.min(70, acCount * 2));
  if (formLike) baseline = Math.max(baseline, 28);
  if (formLike && hasAuthorities) baseline = Math.max(baseline, 30);
  if (formLike && (input.length > 1200 || acCount >= 8)) baseline = Math.max(baseline, 32);
  if (listLike) baseline = Math.max(baseline, 24);
  if (onboardingLike) baseline = Math.max(baseline, 22);
  if (sideEffectLike) baseline = Math.max(baseline, 22);
  if (multiActorLike) baseline = Math.max(baseline, 22);
  if (accessibilityLike) baseline = Math.max(baseline, 18);
  if (responsiveLike) baseline = Math.max(baseline, 18);
  if (browserLike) baseline = Math.max(baseline, 16);
  if (concurrencyLike) baseline = Math.max(baseline, 18);
  if (performanceLike) baseline = Math.max(baseline, 18);
  if (apiDbLike) baseline = Math.max(baseline, 18);

  return baseline;
}

function validateGeneratedCases(
  inputType: InputType,
  input: string,
  testCases: GeneratedTestCase[],
  insights: RequirementAnalysisResult | null,
  strictRequirementMode: boolean
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

  const combinedText = JSON.stringify(testCases);
  const exactTerms = extractExactRequirementTerms(input);
  if (exactTerms.length >= 3) {
    const preservedTermCount = exactTerms.filter((term) => combinedText.includes(term)).length;
    const minimumPreservedTerms = strictRequirementMode
      ? Math.min(exactTerms.length, Math.max(3, Math.ceil(exactTerms.length * 0.6)))
      : Math.min(3, exactTerms.length);
    if (preservedTermCount < minimumPreservedTerms) {
      violations.push('Generated suite dropped too many exact requirement terms/labels and appears to be drifting into generic coverage.');
    }
  }

  if (isConfigDrivenFilterRequirement(input, insights)) {
    const lowerCombined = combinedText.toLowerCase();
    const inventedUiSignals = [
      'configuration interface',
      'configuration modal',
      'unsaved changes',
      'add a new grouping filter',
      'remove an existing grouping filter',
      'hierarchical groups',
      'expand or collapse grouped sections',
    ];
    const foundInventedSignals = inventedUiSignals.filter((signal) => lowerCombined.includes(signal));
    if (foundInventedSignals.length > 0) {
      violations.push(`Suite invented configuration-management behavior not stated in the requirement: ${foundInventedSignals.join(', ')}.`);
    }

    if (strictRequirementMode) {
      const placeholderTerms = ['region', 'sales rep', 'product category'];
      const inventedPlaceholders = placeholderTerms.filter(
        (term) => lowerCombined.includes(term) && !input.toLowerCase().includes(term)
      );
      if (inventedPlaceholders.length > 0) {
        violations.push(
          `Suite replaced exact config-driven filter behavior with generic placeholder values: ${inventedPlaceholders.join(', ')}.`
        );
      }
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
  generationMode: GenerationMode,
  strictRequirementMode: boolean
) {
  const profile = getGenerationModeProfile(generationMode);
  const preferredStarter = insights?.recommendedStarter || 'Verify that the user';
  const formLike = isFormLikeRequirement(input, insights);
  const listLike = isListLikeRequirement(input, insights);
  const listCoverageChecklist = buildListCoverageChecklist(input, insights);
  const authorityCoverageChecklist = buildAuthorityCoverageChecklist(input);
  const configCoverageChecklist = buildConfigCoverageChecklist(input, insights);
  const authCoverageChecklist = buildAuthCoverageChecklist(input, insights);
  const sideEffectCoverageChecklist = buildSideEffectCoverageChecklist(input, insights);
  const onboardingCoverageChecklist = buildOnboardingCoverageChecklist(input, insights);
  const multiActorCoverageChecklist = buildMultiActorCoverageChecklist(input, insights);
  const requirementFidelityChecklist = buildRequirementFidelityChecklist(input, strictRequirementMode);
  const configDrivenFilterChecklist = buildConfigDrivenFilterChecklist(input, insights, strictRequirementMode);
  const accessibilityCoverageChecklist = buildAccessibilityCoverageChecklist(input, insights);
  const responsiveCoverageChecklist = buildResponsiveCoverageChecklist(input, insights);
  const browserCoverageChecklist = buildBrowserCompatibilityChecklist(input, insights);
  const concurrencyCoverageChecklist = buildConcurrencyCoverageChecklist(input, insights);
  const performanceCoverageChecklist = buildPerformanceCoverageChecklist(input, insights);
  const apiDbCoverageChecklist = buildApiDbCoverageChecklist(input, insights);
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
    '- Use clean module, page, modal, popup, list, or details-view names instead of vague generic labels whenever the requirement supports a clearer name.',
    '- Use practical business modules, priority, test data, and post-condition fields.',
    '- requirementReference must point to AC IDs or derived requirement IDs such as AC-01 or REQ-03.',
    '- For standard functional cases, prefer the recommended actor-based starter phrase from requirement analysis.',
    '- Do not compress distinct meaningful checks into one case when a senior QA would keep them separate.',
    '- Include practical derived coverage beyond explicit AC wording when it is a natural manual-testing extension of the requirement.',
    '- If a requirement supports additional realistic field-validation or UI-behavior coverage, include it instead of stopping at the minimum explicit AC count.',
    '- Expected results should usually be short, direct, and observable. Prefer clean execution-ready outcomes over long padded paragraphs.',
    '- When settings, permissions, roles, or statuses combine to change behavior, keep those combinations explicit if they create different real outcomes.',
    '- When exports, notifications, emails, downloads, API/network-driven updates, or downstream reflection are part of the requirement, make those side effects explicit.',
    '- When onboarding, account setup, or multi-actor behavior is present, keep role-specific and persisted-state coverage explicit.',
    '- When accessibility, responsive/mobile, concurrency, performance, or browser support is part of the requirement, keep those obligations explicit instead of implied.',
    '- When API or DB verification is part of the requirement, keep request/response, persistence, retry/failure, and rollback behavior explicit when relevant.',
    '- When a requirement contains exact labels, config keys, rule terms, or fixed values, preserve those exact terms in the suite instead of replacing them with generic examples.',
    '- Do not invent a separate admin/configuration screen, modal, setup workflow, or settings editor unless the requirement explicitly describes one.',
  ];

  if (strictRequirementMode) {
    lines.push(
      '- STRICT EXACT REQUIREMENT MODE is enabled for this run.',
      '- Stay tightly anchored to the stated requirement and acceptance-criteria wording.',
      '- Prefer exact behavior fidelity over broad inferred expansion when those two goals conflict.',
      '- Do not rename exact labels, config keys, rule terms, or fixed filter values into generic business examples.'
    );
  }

  if (generationMode === 'rob_style') {
    lines.push(
      `- Strongly prefer testcase titles that begin with "${preferredStarter}" or a closely matching actor-based phrase.`,
      '- Keep the writing human, practical, browser-focused, and close to a clean senior QA workbook style.',
      '- Make permission and authority wording exact whenever the requirement depends on it.',
      '- Keep expected results crisp, direct, and observable instead of padded.',
      '- Keep notification, email, export, and reflected-data outcomes practical and clearly visible in the testcase wording when they matter.',
    );
  } else if (generationMode === 'yuv_style') {
    lines.push(
      '- Keep the suite broad and execution-oriented with clear module, page, UI, and navigation coverage.',
      '- Separate meaningful list, table, sort, filter, state, and downstream-visibility checks when they represent different user risks.',
      '- Expand onboarding, settings, notification, export, and actor-specific flows the way a strong functional QA would.',
      '- Prefer stronger functional breadth over polished but narrow coverage.',
    );
  } else if (generationMode === 'swag_style') {
    lines.push(
      '- Keep the suite benchmark-driven and broad across common modern web-app UI patterns and business states.',
      '- Explicitly include reusable web-app QA patterns such as forms, inputs, dropdowns, radios, uploads, drag-and-drop, grids, filters, sorts, exports, refresh behavior, and persistence when relevant.',
      '- Treat onboarding, account setup, notifications, emails, export/network reflection, and multi-actor roles as first-class benchmark patterns when relevant.',
      '- Treat accessibility, responsive/mobile behavior, concurrency, performance/loading, deeper API/DB verification, and browser compatibility as first-class benchmark patterns when relevant.',
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

  if (listLike) {
    lines.push(
      '- This requirement also has list/grid/table/page behavior, so include those scenarios explicitly instead of assuming they are covered by general functional cases.',
    );
    lines.push(...listCoverageChecklist.map((line) => `- ${line}`));
  }

  if (authorityCoverageChecklist.length > 0) {
    lines.push(...authorityCoverageChecklist.map((line) => `- ${line}`));
  }

  if (configCoverageChecklist.length > 0) {
    lines.push(...configCoverageChecklist.map((line) => `- ${line}`));
  }

  if (authCoverageChecklist.length > 0) {
    lines.push(...authCoverageChecklist.map((line) => `- ${line}`));
  }

  if (sideEffectCoverageChecklist.length > 0) {
    lines.push(...sideEffectCoverageChecklist.map((line) => `- ${line}`));
  }

  if (onboardingCoverageChecklist.length > 0) {
    lines.push(...onboardingCoverageChecklist.map((line) => `- ${line}`));
  }

  if (multiActorCoverageChecklist.length > 0) {
    lines.push(...multiActorCoverageChecklist.map((line) => `- ${line}`));
  }

  if (requirementFidelityChecklist.length > 0) {
    lines.push(...requirementFidelityChecklist.map((line) => `- ${line}`));
  }

  if (configDrivenFilterChecklist.length > 0) {
    lines.push(...configDrivenFilterChecklist.map((line) => `- ${line}`));
  }

  if (accessibilityCoverageChecklist.length > 0) {
    lines.push(...accessibilityCoverageChecklist.map((line) => `- ${line}`));
  }

  if (responsiveCoverageChecklist.length > 0) {
    lines.push(...responsiveCoverageChecklist.map((line) => `- ${line}`));
  }

  if (browserCoverageChecklist.length > 0) {
    lines.push(...browserCoverageChecklist.map((line) => `- ${line}`));
  }

  if (concurrencyCoverageChecklist.length > 0) {
    lines.push(...concurrencyCoverageChecklist.map((line) => `- ${line}`));
  }

  if (performanceCoverageChecklist.length > 0) {
    lines.push(...performanceCoverageChecklist.map((line) => `- ${line}`));
  }

  if (apiDbCoverageChecklist.length > 0) {
    lines.push(...apiDbCoverageChecklist.map((line) => `- ${line}`));
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
    console.warn('[generate-test-cases] requirement analysis skipped:', error);
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
      featureName: 'generate-test-cases',
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

export async function runGenerateTestCasePipeline({
  aiSettings,
  input,
  inputType,
  images,
  cacheKey,
  sendEvent,
}: GeneratePipelineOptions): Promise<GeneratePipelineResult> {
  const resolvedCacheKey =
    cacheKey === undefined
      ? (images.length === 0 ? await computeGenerateCacheKey(input, inputType, 0, aiSettings) : null)
      : cacheKey;

  if (resolvedCacheKey) {
    const cached = getCachedRequest<GeneratedTestCase[]>(resolvedCacheKey);
    if (cached) {
      sendEvent?.('finalizing', { message: 'Loading cached results...' });
      return { testCases: cached, cached: true };
    }
  }

  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const strictRequirementMode = isStrictRequirementMode(aiSettings);

  sendEvent?.('reading', { message: 'Reading requirement...' });
  const requirementInsights = await maybeAnalyzeRequirement(aiSettings, inputType, input || '');

  sendEvent?.('analyzing', {
    message: requirementInsights
      ? `Analyzing requirement deeply for actor, ACs, and risk areas in ${generationProfile.label} mode...`
      : `Analyzing input and planning testcase coverage in ${generationProfile.label} mode...`,
  });

  const systemPrompt = buildSystemPrompt(inputType, generationMode, strictRequirementMode);
  const classicCoverageChecklist = buildClassicCoverageChecklist(input, requirementInsights);
  const listCoverageChecklist = buildListCoverageChecklist(input, requirementInsights);
  const authorityCoverageChecklist = buildAuthorityCoverageChecklist(input);
  const configCoverageChecklist = buildConfigCoverageChecklist(input, requirementInsights);
  const authCoverageChecklist = buildAuthCoverageChecklist(input, requirementInsights);
  const sideEffectCoverageChecklist = buildSideEffectCoverageChecklist(input, requirementInsights);
  const onboardingCoverageChecklist = buildOnboardingCoverageChecklist(input, requirementInsights);
  const multiActorCoverageChecklist = buildMultiActorCoverageChecklist(input, requirementInsights);
  const requirementFidelityChecklist = buildRequirementFidelityChecklist(input, strictRequirementMode);
  const configDrivenFilterChecklist = buildConfigDrivenFilterChecklist(input, requirementInsights, strictRequirementMode);
  const accessibilityCoverageChecklist = buildAccessibilityCoverageChecklist(input, requirementInsights);
  const responsiveCoverageChecklist = buildResponsiveCoverageChecklist(input, requirementInsights);
  const browserCoverageChecklist = buildBrowserCompatibilityChecklist(input, requirementInsights);
  const concurrencyCoverageChecklist = buildConcurrencyCoverageChecklist(input, requirementInsights);
  const performanceCoverageChecklist = buildPerformanceCoverageChecklist(input, requirementInsights);
  const apiDbCoverageChecklist = buildApiDbCoverageChecklist(input, requirementInsights);
  const userContent: UserPromptPart[] = [
    {
      type: 'text',
      text: [
        buildInstructionText(input || '', images, inputType, requirementInsights, generationMode, strictRequirementMode),
        classicCoverageChecklist.length > 0
          ? ['', 'Classic senior-QA coverage checklist:', ...classicCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        listCoverageChecklist.length > 0
          ? ['', 'List / grid / page-behavior coverage checklist:', ...listCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        authorityCoverageChecklist.length > 0
          ? ['', 'Permission / authority coverage checklist:', ...authorityCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        configCoverageChecklist.length > 0
          ? ['', 'Tenant / configuration / feature-flag coverage checklist:', ...configCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        authCoverageChecklist.length > 0
          ? ['', 'Authentication / MFA / redirect coverage checklist:', ...authCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        sideEffectCoverageChecklist.length > 0
          ? ['', 'Export / notification / side-effect coverage checklist:', ...sideEffectCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        onboardingCoverageChecklist.length > 0
          ? ['', 'Onboarding / account setup / settings coverage checklist:', ...onboardingCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        multiActorCoverageChecklist.length > 0
          ? ['', 'Multi-actor / role coverage checklist:', ...multiActorCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        requirementFidelityChecklist.length > 0
          ? ['', 'Requirement fidelity checklist:', ...requirementFidelityChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        configDrivenFilterChecklist.length > 0
          ? ['', 'Config-driven filter behavior checklist:', ...configDrivenFilterChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        accessibilityCoverageChecklist.length > 0
          ? ['', 'Accessibility / keyboard / ARIA coverage checklist:', ...accessibilityCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        responsiveCoverageChecklist.length > 0
          ? ['', 'Responsive / mobile / touch coverage checklist:', ...responsiveCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        browserCoverageChecklist.length > 0
          ? ['', 'Cross-browser compatibility coverage checklist:', ...browserCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        concurrencyCoverageChecklist.length > 0
          ? ['', 'Concurrency / multi-user coverage checklist:', ...concurrencyCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        performanceCoverageChecklist.length > 0
          ? ['', 'Performance / large-data coverage checklist:', ...performanceCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
        apiDbCoverageChecklist.length > 0
          ? ['', 'API / DB verification coverage checklist:', ...apiDbCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join('\n')
          : '',
      ].filter(Boolean).join('\n'),
    },
  ];

  for (const image of images) {
    userContent.push({ type: 'image', dataUrl: image });
  }

  sendEvent?.('generating', { message: 'Generating test cases...' });
  const attemptOne = await callAiProvider(aiSettings, systemPrompt, userContent);
  if (!attemptOne.ok) {
    throw attemptOne;
  }

  sendEvent?.('validating', { message: 'Running QA rule checks...' });
  const firstValidation = validateGeneratedCases(
    inputType,
    input || '',
    attemptOne.testCases,
    requirementInsights,
    strictRequirementMode
  );

  if (firstValidation.valid) {
    if (resolvedCacheKey) {
      setCachedRequest(resolvedCacheKey, attemptOne.testCases);
    }
    return { testCases: attemptOne.testCases };
  }

  sendEvent?.('retrying', { message: 'Improving coverage and rewriting weak cases...' });
  const correctionInstruction = [
    'The previous testcase suite is too weak or too compressed. Regenerate the FULL suite from scratch.',
    '',
    'Problems found:',
    ...firstValidation.violations.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Do not compress distinct meaningful checks into broad umbrella cases.',
    'Expand the suite with classic senior manual-QA coverage where relevant: boundaries, duplicate handling, whitespace, special characters, navigation, breadcrumbs/title, tab order, default values, downstream visibility, side effects, and repeated execution.',
    'Keep the suite broad and practical, closer to a classic strong QA export.',
    'Return only the structured testcase payload.',
  ].join('\n');
  const retryContent: UserPromptPart[] = [...userContent, { type: 'text', text: correctionInstruction }];
  const attemptTwo = await callAiProvider(aiSettings, systemPrompt, retryContent);

  if (!attemptTwo.ok) {
    return { testCases: attemptOne.testCases };
  }

  sendEvent?.('validating', { message: 'Re-checking revised testcase suite...' });
  const secondValidation = validateGeneratedCases(
    inputType,
    input || '',
    attemptTwo.testCases,
    requirementInsights,
    strictRequirementMode
  );
  const bestResult =
    secondValidation.valid || attemptTwo.testCases.length >= attemptOne.testCases.length
      ? attemptTwo.testCases
      : attemptOne.testCases;

  if (resolvedCacheKey) {
    setCachedRequest(resolvedCacheKey, bestResult);
  }

  return { testCases: bestResult };
}

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { handleHostedFunctionRequest } from '../server-dist/generate-test-cases-server.js';
import { removeUnsupportedStrictTestCases } from '../supabase/functions/_shared/generateTestCasePipeline.ts';

const fixtures = {
  poe: {
    label: 'POE event-driven persistence workflow',
    requirement: `As an engineer, I need to automatically create a POE requirement row in sales_order_documents when an order ships to a freight-forward address, so the buyer is prompted to upload proof-of-export documentation.

Scope
Hook into processOrderUpserts in order-insight-consumer/order-insight.ts (phonex-saas-lambda-fn). After the order status transitions to SHIPPED/INVOICED:

Trigger condition:
- Shipping address is a freight-forward address, not buyer.is_freight_forwarder.
- Applies to all order types with no STOCKLIST restriction.
- Feature flag poeEnabled must be active for the tenant.

For each qualifying order with no existing POE row, insert a sales_order_documents row with the sales_order_id, buyer_id, document_type POE, document_status PENDING, system user, and the transition time as created_date. Use ON DUPLICATE KEY UPDATE sales_order_id = sales_order_id for idempotency.

Freight-forward address detection must use the existing wsc-saas-connector or buyer/address domain logic.

Acceptance Criteria
- POE row created on ship to a freight-forward address for any order type.
- No POE row created for non-freight-forward shipping addresses.
- Re-processing the same order does not create duplicates.
- Behavior is gated behind the tenant poeEnabled feature flag.
- created_date is the SHIPPED/INVOICED transition time, not order creation time.
- Customers with customerOrigin ItochuJapan in buyer.additional_fields are exempt.`,
    gates: [
      ['all order types', /all order types|every (?:supported )?order type|no (?:stocklist|order type) restriction/i],
      ['non-freight-forward exclusion', /non[- ]freight[- ]forward|not (?:a )?freight[- ]forward/i],
      ['feature flag enabled and disabled', /poeEnabled[\s\S]{0,260}(?:disabled|inactive|false|not enabled)/i],
      ['sequential replay idempotency', /replay|reprocess|processed (?:again|multiple times)|same (?:shipped )?event/i],
      ['concurrent duplicate idempotency', /concurrent|simultaneous|parallel duplicate/i],
      ['existing POE status preservation', /(?:UPLOADED|APPROVED)[\s\S]{0,260}(?:preserv|not reset|remain)/i],
      ['created date preservation', /(?:original|existing)[\s\S]{0,220}created[_ ]date[\s\S]{0,220}(?:preserv|unchanged|not updated)/i],
      ['database uniqueness enforcement', /unique (?:constraint|index|key)|ON DUPLICATE KEY/i],
      ['tenant isolation', /cross[- ]tenant|multi[- ]tenant|correct tenant|other tenant/i],
      ['missing shipping address handling', /(?:null|missing|absent)[\s\S]{0,220}shipping address/i],
      ['malformed buyer data handling', /(?:null|missing|malformed|invalid)[\s\S]{0,260}additional_fields/i],
      ['ItochuJapan exemption', /ItochuJapan/i],
      ['existing document non-interference', /existing (?:document|non[- ]POE)[\s\S]{0,260}(?:unchanged|not modif|preserv)/i],
      ['non-qualifying upsert regression', /non[- ]qualifying[\s\S]{0,260}(?:processOrderUpserts|upsert|processing)[\s\S]{0,180}(?:continue|unchanged|not affected)/i],
      ['POE insert failure isolation', /POE insert (?:failure|fails)[\s\S]{0,260}(?:does not|without)[\s\S]{0,160}(?:break|stop|fail).*processOrderUpserts/i],
      ['retry or DLQ handling', /retry|DLQ|dead[- ]letter/i],
      ['large batch behavior', /large batch|batch performance|high[- ]volume/i],
      ['buyer upload lifecycle', /PENDING[\s\S]{0,260}UPLOADED|upload[\s\S]{0,260}UPLOADED/i],
    ],
  },
  filter: {
    label: 'Sales Order config-driven grouping filters',
    requirement: `Story
Provide configurable grouping-based filters on the Sales Order list page to allow users to view orders by logical groupings.

Scope
Enhance the PXW Sales Order list page to support config-driven grouping filters with existing status filters.

Configuration
- existing fulfillmentStatusToInclude
- new orderListGroupsToInclude
- new orderListGroups

Acceptance Criteria
1. Filters appear as clickable pills on top of the list.
2. If filters exist, ALL appears first and is selected by default.
3. If no filters are configured, no filter pills appear and all orders are displayed.
4. Order is ALL, orderListGroupsToInclude, then fulfillmentStatusToInclude.
5. Selecting a non-ALL filter deselects ALL. Multiple non-ALL filters are allowed and combine with OR.
6. Selecting ALL clears all other filters and displays all orders.
7. Any group rule matching includes the order using OR across rules.
8. textRules and numericRules use AND within a rule; textRules support whitelist and blacklist.
9. Reuse the existing TypeScript FilteringRule logic used by currency and location rules.
10. Ignore an orderListGroupsToInclude entry that has no definition in orderListGroups.
11. A missing rule attribute on an order evaluates false.
12. Orders may belong to multiple groups but appear only once.
13. Selected status and group filters combine with OR.
14. No new permissions are required.
15. Existing fulfillment-status filters and Sales Order list behavior must not regress.`,
    gates: [
      ['clickable filter pills', /clickable pill|filter pill/i],
      ['ALL first and default', /\bALL\b[\s\S]{0,260}(?:first|default)|(?:first|default)[\s\S]{0,260}\bALL\b/i],
      ['no-filter empty state', /no (?:configured )?filters[\s\S]{0,260}(?:no (?:filter )?pills|all orders)/i],
      ['configured filter order', /orderListGroupsToInclude[\s\S]{0,260}fulfillmentStatusToInclude/i],
      ['single-selection behavior', /(?:non[- ]ALL|group|status) filter[\s\S]{0,260}(?:deselect|clear).*ALL/i],
      ['multi-selection OR behavior', /multiple[\s\S]{0,260}\bOR\b|\bOR\b[\s\S]{0,260}selected filters/i],
      ['ALL clears selections', /select(?:ing)? ALL[\s\S]{0,260}(?:clear|deselect).*filter/i],
      ['OR across group rules', /\bOR\b[\s\S]{0,220}(?:across|between) rules|rules[\s\S]{0,220}\bOR\b/i],
      ['AND within rule', /\bAND\b[\s\S]{0,260}(?:textRules|numericRules)|(?:textRules|numericRules)[\s\S]{0,260}\bAND\b/i],
      ['whitelist and blacklist', /whitelist[\s\S]{0,220}blacklist|blacklist[\s\S]{0,220}whitelist/i],
      ['undefined group ignored', /(?:missing|undefined|not defined)[\s\S]{0,300}(?:ignored|no pill|not rendered)/i],
      ['missing attribute false', /(?:missing|absent|does not exist)[\s\S]{0,240}(?:attribute|field|property)[\s\S]{0,180}false|false[\s\S]{0,240}(?:attribute|field|property)/i],
      ['duplicate result prevention', /multiple groups[\s\S]{0,260}(?:only once|no duplicate)|(?:only once|no duplicate)[\s\S]{0,260}multiple groups/i],
      ['no new permission', /no new permission/i],
      ['existing filter regression', /existing[\s\S]{0,220}(?:fulfillment|status)[\s\S]{0,220}(?:regression|unchanged|continue)/i],
    ],
  },
};

const requiredFields = [
  'id',
  'requirementReference',
  'module',
  'priority',
  'coverageArea',
  'scenario',
  'testCase',
  'testData',
  'preconditions',
  'testSteps',
  'expectedResult',
  'postCondition',
  'type',
];

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'errorText' in error) return String(error.errorText);
  return String(error);
}

function isRetryableProviderError(error) {
  const message = errorMessage(error).toLowerCase();
  return !(
    message.includes('limit: 0') ||
    message.includes('requires more credits') ||
    message.includes('api key') ||
    message.includes('unauthorized') ||
    message.includes('invalid key')
  );
}

function providerRetryAfterMs(error) {
  const match = errorMessage(error).match(/(?:please\s+)?retry\s+(?:after|in)\s+([0-9]+(?:\.[0-9]+)?)\s*(?:s|sec|secs|second|seconds)\b/i);
  return match ? Math.min(Math.ceil(Number(match[1]) * 1000) + 750, 120_000) : null;
}

async function invokeWithRetry(functionName, body, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await handleHostedFunctionRequest(functionName, body);
    } catch (error) {
      if (attempt === maxRetries || !isRetryableProviderError(error)) throw error;
      const delayMs = providerRetryAfterMs(error) ?? Math.min(1000 * (2 ** attempt), 10000);
      console.log(
        `[quality-smoke] ${functionName} transient failure; retry ${attempt + 1}/${maxRetries} in ${delayMs / 1000}s: ${errorMessage(error)}`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`${functionName} exceeded the retry limit.`);
}

function readArgument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function writeCheckpoint(fixtureName, payload) {
  writeFileSync(
    `tmp_quality_smoke_${fixtureName}.json`,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), ...payload }, null, 2)}\n`,
    'utf8'
  );
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function testCaseKey(testCase) {
  return [testCase.testCase, testCase.scenario, testCase.expectedResult].map(normalize).join('::');
}

function mergePreservingExisting(existing, additions) {
  const seen = new Set(existing.map(testCaseKey));
  let nextNumber = existing.reduce((maximum, testCase) => {
    const match = String(testCase.id || '').match(/(\d+)/);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0) + 1;

  const unique = [];
  for (const addition of additions) {
    const key = testCaseKey(addition);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...addition, id: `TC_${String(nextNumber++).padStart(3, '0')}` });
  }

  return [...existing, ...unique];
}

function isTestableInstruction(value) {
  return !/^\s*(?:clarification|process)\s*:/i.test(value);
}

function actionableCoverageRequests(coverage) {
  return [
    ...coverage.missingScenarios
      .map((item) => ({ kind: 'scenario', value: item.scenario }))
      .filter((item) => isTestableInstruction(item.value)),
    ...coverage.recommendations
      .map((value) => ({ kind: 'recommendation', value }))
      .filter((item) => isTestableInstruction(item.value)),
  ];
}

function createAiSettings(provider) {
  return {
    provider,
    generationMode: 'rob_style',
    strictRequirementMode: true,
    geminiModel: readArgument('gemini-model', process.env.QUALITY_SMOKE_GEMINI_MODEL || 'gemini-2.5-flash'),
    openrouterModel: readArgument('openrouter-model', process.env.QUALITY_SMOKE_OPENROUTER_MODEL || 'openrouter/auto'),
  };
}

async function validate(requirement, testCases, aiSettings) {
  return await invokeWithRetry('validate-coverage', {
    input: requirement,
    inputType: 'requirement',
    testCases,
    aiSettings,
  });
}

async function runFixture(fixtureName, fixture, aiSettings) {
  const checkpointPath = `tmp_quality_smoke_${fixtureName}.json`;
  const resume = readArgument('resume', 'false') === 'true' && existsSync(checkpointPath);
  const workingCheckpointName = resume ? `${fixtureName}_resume` : fixtureName;
  let suite;

  if (resume) {
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    suite = removeUnsupportedStrictTestCases(
      fixture.requirement,
      Array.isArray(checkpoint.suite) ? checkpoint.suite : [],
      true
    );
    console.log(`[quality-smoke] ${fixture.label}: resumed ${suite.length} strict-filtered cases from checkpoint.`);
  } else {
    console.log(`[quality-smoke] ${fixture.label}: generating initial strict Rob suite...`);
    const generatedResponse = await invokeWithRetry('generate-test-cases', {
      input: fixture.requirement,
      inputType: 'requirement',
      imagesBase64: [],
      aiSettings,
    });
    suite = Array.isArray(generatedResponse?.testCases) ? generatedResponse.testCases : [];
  }
  const initialCount = suite.length;
  writeCheckpoint(workingCheckpointName, { status: 'initial-generated', initialCount, suite });
  let coverage = await validate(fixture.requirement, suite, aiSettings);
  const initialCoverageScore = coverage.coverageScore;
  const initialMissing = coverage.missingScenarios.length;
  const initialRecommendations = coverage.recommendations.length;
  let passes = 0;
  writeCheckpoint(workingCheckpointName, { status: 'initial-validated', initialCount, coverage, suite });

  while (passes < 3 && actionableCoverageRequests(coverage).length > 0) {
    console.log(
      `[quality-smoke] ${fixture.label}: pass ${passes + 1}, repairing ` +
      `${coverage.missingScenarios.length} gaps and ${coverage.recommendations.length} recommendations...`
    );
    const previousLength = suite.length;
    const requests = actionableCoverageRequests(coverage);
    for (let index = 0; index < requests.length; index += 6) {
      const batch = requests.slice(index, index + 6);
      const auditResponse = await invokeWithRetry('audit-test-cases', {
        requirement: fixture.requirement,
        existingTestCases: suite,
        focusMissingScenarios: batch.filter((item) => item.kind === 'scenario').map((item) => item.value),
        focusRecommendations: batch.filter((item) => item.kind === 'recommendation').map((item) => item.value),
        imagesBase64: [],
        aiSettings,
      });
      const additions = Array.isArray(auditResponse?.testCases) ? auditResponse.testCases : [];
      suite = mergePreservingExisting(suite, additions);
    }
    passes += 1;

    if (suite.length === previousLength) break;
    coverage = await validate(fixture.requirement, suite, aiSettings);
    writeCheckpoint(workingCheckpointName, {
      status: 'quality-pass-complete',
      initialCount,
      passes,
      coverage,
      suite,
    });
  }

  const combinedSuite = JSON.stringify(suite);
  const completeCases = suite.filter((testCase) =>
    requiredFields.every((field) => typeof testCase[field] === 'string' && testCase[field].trim())
  );
  const uniqueIds = new Set(suite.map((testCase) => normalize(testCase.id)));
  const uniqueTitles = new Set(suite.map((testCase) => normalize(testCase.testCase)));
  const robTitles = suite.filter((testCase) => /^verify that\b/i.test(testCase.testCase));
  const traceability = fixture.gates.map(([name, pattern]) => ({ name, covered: pattern.test(combinedSuite) }));
  const missingTraceability = traceability.filter((gate) => !gate.covered).map((gate) => gate.name);

  const report = {
    fixture: fixtureName,
    provider: aiSettings.provider,
    initialCount,
    finalCount: suite.length,
    addedByQualityGate: suite.length - initialCount,
    passes,
    initialCoverage: {
      score: initialCoverageScore,
      missing: initialMissing,
      recommendations: initialRecommendations,
    },
    finalCoverage: {
      score: coverage.coverageScore,
      missing: coverage.missingScenarios.map((item) => item.scenario),
      recommendations: coverage.recommendations,
    },
    professionalRows: `${completeCases.length}/${suite.length}`,
    robStyleRows: `${robTitles.length}/${suite.length}`,
    positive: suite.filter((testCase) => testCase.type === 'Positive').length,
    negative: suite.filter((testCase) => testCase.type === 'Negative').length,
    missingTraceability,
  };

  console.log(JSON.stringify(report, null, 2));
  writeCheckpoint(workingCheckpointName, { status: 'asserting', report, coverage, suite });

  assert.ok(suite.length > 0, `${fixture.label} returned no testcases.`);
  assert.equal(completeCases.length, suite.length, `${fixture.label} has incomplete professional rows.`);
  assert.equal(uniqueIds.size, suite.length, `${fixture.label} has duplicate testcase IDs.`);
  assert.equal(uniqueTitles.size, suite.length, `${fixture.label} has duplicate testcase titles.`);
  assert.ok(robTitles.length / suite.length >= 0.75, `${fixture.label} does not consistently follow Rob-style wording.`);
  assert.ok(report.positive > 0 && report.negative > 0, `${fixture.label} lacks positive or negative coverage.`);
  assert.deepEqual(missingTraceability, [], `${fixture.label} is missing traceability: ${missingTraceability.join(', ')}`);
  assert.equal(
    actionableCoverageRequests(coverage).filter((request) => request.kind === 'scenario').length,
    0,
    `${fixture.label} still has executable coverage gaps.`
  );

  console.log(`[quality-smoke] PASS: ${fixture.label}`);
  writeCheckpoint(workingCheckpointName, { status: 'passed', report, coverage, suite });
  if (resume) {
    writeCheckpoint(fixtureName, { status: 'passed', report, coverage, suite });
  }
}

const provider = readArgument('provider', process.env.QUALITY_SMOKE_PROVIDER || 'gemini');
if (!['gemini', 'openrouter', 'groq', 'openai', 'claude', 'claude_cli'].includes(provider)) {
  throw new Error(`Unsupported --provider value: ${provider}`);
}

const requestedFixtures = readArgument('fixture', 'poe,filter')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const aiSettings = createAiSettings(provider);

for (const fixtureName of requestedFixtures) {
  const fixture = fixtures[fixtureName];
  if (!fixture) throw new Error(`Unknown fixture: ${fixtureName}. Use poe, filter, or poe,filter.`);
  try {
    await runFixture(fixtureName, fixture, aiSettings);
  } catch (error) {
    writeCheckpoint(`${fixtureName}_error`, {
      status: 'failed',
      provider,
      error: errorMessage(error),
    });
    throw error;
  }
}

console.log('[quality-smoke] All requested end-to-end quality gates passed.');

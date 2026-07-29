import assert from 'node:assert/strict';
import { handleHostedFunctionRequest } from '../server-dist/generate-test-cases-server.js';

const requirement = `Story
Provide configurable grouping-based filters on the Sales Order list page to allow users to view orders by logical groupings.

Scope
Enhance PXW Sales Order list page to support config-driven grouping filters with existing status-based filters.

Configuration
- Existing fulfillmentStatusToInclude
- New orderListGroupsToInclude
- New orderListGroups

Acceptance Criteria
1. Filters render as clickable pills on top of the list.
2. If at least one configured filter exists, ALL is first and selected by default.
3. If no filters are configured, no pills appear and all orders are displayed.
4. Filter order is ALL, orderListGroupsToInclude, then fulfillmentStatusToInclude.
5. Selecting a non-ALL filter deselects ALL. Multiple non-ALL filters are allowed and combine with OR.
6. Selecting ALL clears other filters and displays all orders.
7. A group has a name and rules. Any rule matching includes the order (OR across rules).
8. Within one rule, textRules and numericRules combine with AND. textRules support whitelist and blacklist.
9. Reuse the existing TypeScript FilteringRule behavior used by currency and location rules.
10. If orderListGroupsToInclude names a group missing from orderListGroups, ignore that entry.
11. If a rule attribute is missing on the order, that rule evaluates false.
12. An order may belong to multiple groups but must appear only once.
13. Selected status and group filters combine with OR.
14. No new permissions are required; behavior applies to users with Sales Order list access.
15. Existing fulfillment-status filtering and existing Sales Order list behavior must not regress.`;

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

const traceabilityGates = [
  ['group include configuration', /orderListGroupsToInclude/i],
  ['existing status configuration', /fulfillmentStatusToInclude/i],
  ['group definitions', /\borderListGroups\b/i],
  ['no configured filters behavior', /no (?:filters|filter pills)|without (?:configured )?filters/i],
  ['ALL first/default/clear behavior', /\bALL\b[\s\S]{0,240}(?:first|default|clear)|(?:first|default|clear)[\s\S]{0,240}\bALL\b/i],
  ['multiple-selection OR behavior', /multiple[\s\S]{0,220}\bOR\b|\bOR\b[\s\S]{0,220}selected filters/i],
  ['OR across rules', /\bOR\b[\s\S]{0,220}(?:across|between) rules|rules[\s\S]{0,220}\bOR\b/i],
  ['AND within text/numeric rule', /\bAND\b[\s\S]{0,260}(?:textRules|numericRules)|(?:textRules|numericRules)[\s\S]{0,260}\bAND\b/i],
  ['missing group definition ignored', /(?:missing|undefined|not defined|no matching (?:definition|entry)|orphaned)[\s\S]{0,320}(?:ignored|ignore|does not see|not rendered|no pill)/i],
  ['missing order attribute evaluates false', /(?:attribute|property|field)[\s\S]{0,260}(?:missing|does not exist)[\s\S]{0,260}false|false[\s\S]{0,260}(?:attribute|property|field)/i],
  ['multi-group result deduplication', /(?:multiple (?:selected )?(?:groups|group filters)|two different selected groups|two group pills|more than one group)[\s\S]{0,320}(?:duplicate|only once|exactly once|single instance)|(?:duplicate|only once|exactly once|single instance)[\s\S]{0,320}(?:multiple (?:selected )?(?:groups|group filters)|two different selected groups|two group pills|more than one group)/i],
  ['permission and existing-behavior regression', /no new permission|existing[\s\S]{0,260}(?:status|fulfillment|behavior|regression)/i],
];

console.log('[manual-smoke] Generating the full strict Rob suite through Claude Subscription...');
const response = await handleHostedFunctionRequest('generate-test-cases', {
  input: requirement,
  inputType: 'requirement',
  aiSettings: {
    provider: 'claude_cli',
    claudeCliModel: process.env.CLAUDE_SMOKE_MODEL || 'sonnet',
    generationMode: 'rob_style',
    strictRequirementMode: true,
  },
});
const testCases = Array.isArray(response?.testCases) ? response.testCases : [];
const combinedSuite = JSON.stringify(testCases);
const uniqueIds = new Set(testCases.map((testCase) => testCase.id.toLowerCase()));
const uniqueTitles = new Set(
  testCases.map((testCase) => testCase.testCase.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
);
const completeCases = testCases.filter((testCase) =>
  requiredFields.every((field) => typeof testCase[field] === 'string' && testCase[field].trim())
);
const robTitles = testCases.filter((testCase) => /^verify that\b/i.test(testCase.testCase));
const traceability = traceabilityGates.map(([name, pattern]) => ({
  name,
  covered: pattern.test(combinedSuite),
}));

const report = {
  generated: testCases.length,
  completeProfessionalRows: completeCases.length,
  uniqueIds: uniqueIds.size,
  uniqueTitles: uniqueTitles.size,
  robStyleTitles: robTitles.length,
  robStyleRatio: testCases.length ? Number((robTitles.length / testCases.length).toFixed(2)) : 0,
  positive: testCases.filter((testCase) => testCase.type === 'Positive').length,
  negative: testCases.filter((testCase) => testCase.type === 'Negative').length,
  priorities: Object.fromEntries(
    ['Critical', 'High', 'Medium', 'Low'].map((priority) => [
      priority,
      testCases.filter((testCase) => testCase.priority === priority).length,
    ])
  ),
  traceability,
  titles: testCases.map((testCase) => `${testCase.id}: ${testCase.testCase}`),
};

console.log(JSON.stringify(report, null, 2));

assert.ok(testCases.length >= 20, `Expected at least 20 cases for this complex requirement, received ${testCases.length}.`);
assert.equal(completeCases.length, testCases.length, 'Every generated row must contain all professional fields.');
assert.equal(uniqueIds.size, testCases.length, 'Test case IDs must be unique.');
assert.equal(uniqueTitles.size, testCases.length, 'Test case titles must be unique.');
assert.ok(report.robStyleRatio >= 0.75, 'At least 75% of strict Rob titles must start with "Verify that".');
assert.ok(report.positive > 0 && report.negative > 0, 'The suite must include positive and negative coverage.');
assert.doesNotMatch(
  combinedSuite,
  /sort the Sales Order|sorting|pagination|list columns|existing search|search functionality/i,
  'Strict mode must not invent list capabilities that are absent from the requirement.'
);

const missingGates = traceability.filter((gate) => !gate.covered).map((gate) => gate.name);
assert.deepEqual(missingGates, [], `Missing traceability gates: ${missingGates.join(', ')}`);

console.log('[manual-smoke] PASS: generation and all deterministic senior-QA gates passed.');

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMissingTechnicalScenarios,
  buildTechnicalWorkflowCoverageChecklist,
  buildTechnicalWorkflowRecommendations,
  detectTechnicalWorkflowSignals,
  findMissingTechnicalWorkflowCoverage,
} from '../supabase/functions/_shared/technicalWorkflowCoverage.ts';
import { removeUnsupportedStrictTestCases } from '../supabase/functions/_shared/generateTestCasePipeline.ts';

const POE_REQUIREMENT = `
Hook into processOrderUpserts after an order transitions to SHIPPED/INVOICED.
For every order type, when the shipping address is a freight-forward address and
the poeEnabled tenant feature flag is active, INSERT INTO sales_order_documents
with document_status PENDING and created_date NOW(). Use ON DUPLICATE KEY UPDATE
so re-processing is idempotent. Read customerOrigin from buyer.additional_fields,
with an ItochuJapan exemption. The buyer is then prompted to upload proof of export.
`;

test('technical workflow detection turns the complete POE risk family into mandatory coverage', () => {
  const signals = detectTechnicalWorkflowSignals(POE_REQUIREMENT);
  const checklist = buildTechnicalWorkflowCoverageChecklist(POE_REQUIREMENT).join('\n').toLowerCase();

  assert.equal(signals.detected, true);
  assert.equal(signals.eventDriven, true);
  assert.equal(signals.persistence, true);
  assert.equal(signals.idempotency, true);
  assert.equal(signals.tenantScoped, true);
  assert.equal(signals.structuredInput, true);
  assert.equal(signals.batchProcessing, true);
  assert.equal(signals.downstreamLifecycle, true);

  for (const expectedRisk of [
    'every remaining supported type',
    'sequential replay',
    'concurrent/parallel duplicate',
    'advanced status',
    'original creation timestamp',
    'uniqueness constraint or index',
    'mixed-tenant batch',
    'crossed or mismatched',
    'null or missing',
    'malformed structured data',
    'casing/whitespace',
    'unrelated existing rows',
    'normal processing continues',
    'failure isolation',
    'dead-letter policy',
    'large-batch processing',
    'persisted status advances',
  ]) {
    assert.match(checklist, new RegExp(expectedRisk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('technical coverage audit identifies every important gap in a weak POE suite', () => {
  const weakSuite = `
    Verify that a POE row is created for a STOCKLIST order.
    Verify that a POE row is created for one non-STOCKLIST order.
    Verify that no row is created for a normal address.
    Verify that the poeEnabled feature flag gates creation.
  `;

  const gaps = findMissingTechnicalWorkflowCoverage(POE_REQUIREMENT, weakSuite);

  assert.deepEqual(gaps, [
    'complete trigger/type/status matrix',
    'sequential replay/reprocessing idempotency',
    'concurrent duplicate-event idempotency',
    'existing advanced status preservation',
    'original creation timestamp preservation',
    'database uniqueness enforcement for duplicate prevention',
    'mixed-tenant feature-flag isolation',
    'cross-tenant identifier safety',
    'NULL or missing source-data handling',
    'malformed structured-data handling',
    'non-interference with existing related records',
    'non-qualifying main-flow regression protection',
    'side-effect failure isolation from the main flow',
    'repeated-failure retry/dead-letter behavior',
    'large-batch correctness and performance',
    'downstream action and persisted status lifecycle',
  ]);
  const enforcedScenarios = buildMissingTechnicalScenarios(POE_REQUIREMENT, weakSuite);
  assert.equal(enforcedScenarios.length, gaps.length);
  assert.match(enforcedScenarios[0].scenario, /every stated event\/status trigger/i);
  assert.ok(enforcedScenarios.every((scenario) => scenario.priority && scenario.type));
});

test('unspecified exemption normalization is retained as a clarification, not an executable gap', () => {
  const recommendations = buildTechnicalWorkflowRecommendations(POE_REQUIREMENT, 'No normalization coverage exists.');

  assert.equal(recommendations.length, 1);
  assert.match(recommendations[0], /^Clarification:/);
  assert.doesNotMatch(findMissingTechnicalWorkflowCoverage(POE_REQUIREMENT, '').join('\n'), /casing/i);
});

test('technical coverage audit accepts a suite containing all strengthened POE checks', () => {
  const strongSuite = `
    Verify every remaining supported order type across the SHIPPED/INVOICED trigger matrix.
    Verify replay of the same event remains idempotent.
    Verify concurrent duplicate events create exactly one row.
    Verify an UPLOADED or APPROVED status is not reset and remains unchanged.
    Verify the original created_date is preserved and is not overwritten.
    Verify the unique constraint supports ON DUPLICATE KEY prevention.
    Verify a mixed-tenant batch creates POE only for the eligible tenant.
    Verify no cross-tenant buyer/order mismatch is persisted.
    Verify a NULL or missing shipping address is handled safely.
    Verify malformed additional_fields JSON is handled safely.
    Verify ItochuJapan casing and whitespace behavior.
    Verify the POE insert does not modify existing document rows.
    Verify normal order upsert processing continues for non-qualifying orders.
    Verify POE insert failure does not block the main process.
    Verify repeated failures follow the retry policy and DLQ behavior.
    Verify large batch correctness and the performance baseline.
    Verify after the buyer uploads, document status advances from PENDING to UPLOADED.
  `;

  assert.deepEqual(findMissingTechnicalWorkflowCoverage(POE_REQUIREMENT, strongSuite), []);
});

test('strict mode keeps direct concurrency and database idempotency cases', () => {
  const concurrentCase = {
    id: 'TC_001',
    requirementReference: 'AC-03',
    module: 'Order Insight Consumer',
    priority: 'Critical',
    coverageArea: 'Concurrency / Idempotency',
    scenario: 'Concurrent duplicate SHIPPED events',
    testCase: 'Verify that concurrent duplicate SHIPPED events create exactly one POE row',
    testData: 'Two parallel events for the same sales_order_id',
    preconditions: 'A unique constraint supports ON DUPLICATE KEY handling.',
    testSteps: '1. Publish two SHIPPED events concurrently.\n2. Query the document table.',
    expectedResult: 'Exactly one POE row exists and no existing status is reset.',
    postCondition: 'One POE row remains.',
    type: 'Negative' as const,
  };

  const filtered = removeUnsupportedStrictTestCases(POE_REQUIREMENT, [concurrentCase], true);
  assert.equal(filtered.length, 1);
});

test('ordinary list duplicate-removal wording does not trigger backend workflow coverage', () => {
  const listRequirement = `
    Show tenant-configured Sales Order list filter pills. Multiple selected filters use OR logic.
    Orders matching more than one selected filter must not appear as duplicate results in the list.
  `;

  assert.equal(detectTechnicalWorkflowSignals(listRequirement).detected, false);
  assert.deepEqual(buildTechnicalWorkflowCoverageChecklist(listRequirement), []);
  assert.deepEqual(buildMissingTechnicalScenarios(listRequirement, ''), []);
});

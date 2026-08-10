import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoverageResult } from '../src/hooks/useCoverageValidator.ts';
import {
  buildCoverageImprovementBatches,
  countCoverageImprovementRequests,
  isTestableCoverageInstruction,
  selectCoverageImprovements,
} from '../src/lib/coverageQualityGate.ts';

const coverage: CoverageResult = {
  coverageScore: 72,
  summary: 'Additional technical coverage is required.',
  coveredAreas: ['Happy path'],
  missingScenarios: [
    { scenario: 'Concurrent duplicate events', priority: 'High', type: 'Negative' },
    { scenario: 'Mixed-tenant isolation', priority: 'High', type: 'Negative' },
  ],
  recommendations: [
    'Verify retry and DLQ behavior after repeated insert failures.',
    'Verify large-batch processing against the configured performance baseline.',
  ],
};

test('automatic quality gate selects every gap and recommendation by default', () => {
  const selection = selectCoverageImprovements(coverage);

  assert.deepEqual(selection.missingScenarios, coverage.missingScenarios);
  assert.deepEqual(selection.recommendations, coverage.recommendations);
  assert.deepEqual(selection.focusMissingScenarios, [
    'Concurrent duplicate events',
    'Mixed-tenant isolation',
  ]);
  assert.deepEqual(selection.focusRecommendations, coverage.recommendations);
  assert.equal(countCoverageImprovementRequests(coverage), 4);
});

test('manual recommendation conversion does not accidentally include unselected gaps', () => {
  const selection = selectCoverageImprovements(coverage, {
    scenarioIndexes: [],
    recommendationIndexes: [1],
  });

  assert.deepEqual(selection.missingScenarios, []);
  assert.deepEqual(selection.recommendations, [coverage.recommendations[1]]);
});

test('automatic repair excludes non-testable notes and duplicate recommendations', () => {
  const result: CoverageResult = {
    ...coverage,
    missingScenarios: [
      ...coverage.missingScenarios,
      { scenario: 'Clarification: Confirm the timeout behavior.', priority: 'Medium', type: 'Negative' },
    ],
    recommendations: [
      'Add a test for concurrent duplicate events.',
      'Clarification: Confirm the timeout behavior.',
      'Process: Record the test evidence in Jira.',
      'Verify retry and DLQ behavior after repeated insert failures.',
    ],
  };

  const selection = selectCoverageImprovements(result);

  assert.deepEqual(selection.focusMissingScenarios, [
    'Concurrent duplicate events',
    'Mixed-tenant isolation',
  ]);
  assert.deepEqual(selection.focusRecommendations, [
    'Verify retry and DLQ behavior after repeated insert failures.',
  ]);
  assert.equal(countCoverageImprovementRequests(result), 3);
  assert.equal(isTestableCoverageInstruction('Clarification: Confirm behavior.'), false);
  assert.equal(isTestableCoverageInstruction('Verify configured behavior.'), true);
});

test('related but distinct replay and concurrency risks are never deduplicated', () => {
  const result: CoverageResult = {
    ...coverage,
    missingScenarios: [{
      scenario: 'Verify a sequential replay of the same event does not create a duplicate row.',
      priority: 'High',
      type: 'Negative',
    }],
    recommendations: [
      'Verify concurrent duplicate events do not create duplicate rows.',
    ],
  };

  const selection = selectCoverageImprovements(result);

  assert.equal(selection.missingScenarios.length, 1);
  assert.equal(selection.recommendations.length, 1);
  assert.equal(countCoverageImprovementRequests(result), 2);
});

test('a human-review note cannot suppress a later executable recommendation', () => {
  const result: CoverageResult = {
    ...coverage,
    missingScenarios: [],
    recommendations: [
      'Clarification: Verify retry behavior after insert failures.',
      'Verify retry behavior after insert failures.',
      '   ',
    ],
  };

  const selection = selectCoverageImprovements(result);

  assert.deepEqual(selection.recommendations, ['Verify retry behavior after insert failures.']);
  assert.equal(countCoverageImprovementRequests(result), 1);
});

test('coverage improvements are split into bounded batches without dropping requests', () => {
  const result: CoverageResult = {
    ...coverage,
    missingScenarios: Array.from({ length: 8 }, (_, index) => ({
      scenario: `Distinct missing behavior ${index + 1}`,
      priority: 'High' as const,
      type: 'Negative' as const,
    })),
    recommendations: ['Verify a separate retry policy behavior.'],
  };

  const batches = buildCoverageImprovementBatches(result, {}, 4);

  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map((batch) =>
    batch.focusMissingScenarios.length + batch.focusRecommendations.length
  ), [4, 4, 1]);
  assert.equal(
    batches.flatMap((batch) => [...batch.focusMissingScenarios, ...batch.focusRecommendations]).length,
    9
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoverageResult } from '../src/hooks/useCoverageValidator.ts';
import {
  countCoverageImprovementRequests,
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

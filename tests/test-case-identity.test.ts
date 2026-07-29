import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeTestCasesPreservingExisting } from '../src/lib/mergeTestCases.ts';
import {
  deduplicateGeneratedTestCases,
  type GeneratedTestCase,
} from '../supabase/functions/_shared/testCaseSchema.ts';
import { removeUnsupportedStrictTestCases } from '../supabase/functions/_shared/generateTestCasePipeline.ts';

function testCase(id: string, title: string): GeneratedTestCase {
  return {
    id,
    requirementReference: 'AC-01',
    module: 'Sales Order List',
    priority: 'High',
    coverageArea: 'Filters',
    scenario: title,
    testCase: title,
    testData: 'Configured tenant',
    preconditions: 'User can access the Sales Order list.',
    testSteps: '1. Open the list.',
    expectedResult: 'The stated behavior is observed.',
    postCondition: 'List remains available.',
    type: 'Positive',
  };
}

test('deduplication resequences generated testcase IDs without gaps', () => {
  const result = deduplicateGeneratedTestCases([
    testCase('TC_001', 'Verify that ALL is first'),
    testCase('TC_002', 'Verify that ALL is first'),
    testCase('TC_003', 'Verify that multiple filters use OR'),
  ]);

  assert.deepEqual(result.map((item) => item.id), ['TC_001', 'TC_002']);
});

test('merging additions preserves baseline rows and allocates collision-free IDs', () => {
  const baseline = [
    testCase('TC_001', 'Verify that the baseline remains'),
    testCase('TC_004', 'Verify that another baseline remains'),
  ];
  const additions = [
    testCase('TC_001', 'Verify that a missing gap is covered'),
    testCase('TC_002', 'Verify that another missing gap is covered'),
  ];
  const merged = mergeTestCasesPreservingExisting(baseline, additions);

  assert.deepEqual(merged.slice(0, 2), baseline);
  assert.deepEqual(merged.map((item) => item.id), ['TC_001', 'TC_004', 'TC_005', 'TC_006']);
});

test('strict filtering removes unstated list capabilities without dropping requirement cases', () => {
  const result = removeUnsupportedStrictTestCases(
    'Sales Order list grouping filters with no regression to existing behavior',
    [
      testCase('TC_001', 'Verify that multiple selected filters use OR'),
      testCase('TC_002', 'Verify that pagination works after filtering'),
      testCase('TC_003', 'Verify that existing search functionality works after filtering'),
    ],
    true
  );

  assert.deepEqual(result.map((item) => item.testCase), [
    'Verify that multiple selected filters use OR',
  ]);
  assert.deepEqual(result.map((item) => item.id), ['TC_001']);
});

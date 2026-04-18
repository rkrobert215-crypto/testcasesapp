import { TestCase } from '@/types/testCase';

function normalizeType(value: string): TestCase['type'] {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('neg') || normalized.includes('invalid') || normalized.includes('error')) {
    return 'Negative';
  }

  return 'Positive';
}

function normalizePriority(value: string): TestCase['priority'] | undefined {
  if (value === 'Critical' || value === 'High' || value === 'Medium' || value === 'Low') {
    return value;
  }

  return undefined;
}

export function parsedRowsToTestCases(rows: Record<string, string>[]): TestCase[] {
  return rows
    .filter((row) => Object.values(row).some((value) => value.trim().length > 0))
    .map((row, index) => ({
      id: row.id || `TC_IMPORTED_${String(index + 1).padStart(3, '0')}`,
      requirementReference: row.requirementReference || '',
      module: row.module || '',
      priority: normalizePriority(row.priority || ''),
      coverageArea: row.coverageArea || row.module || 'Imported Coverage',
      scenario: row.scenario || row.testCase || `Imported scenario ${index + 1}`,
      testCase: row.testCase || row.scenario || `Imported test case ${index + 1}`,
      testData: row.testData || '',
      preconditions: row.preconditions || 'Application is available and user has required access.',
      testSteps: row.testSteps || 'Execute the imported testcase steps.',
      expectedResult: row.expectedResult || 'The expected system behavior occurs.',
      postCondition: row.postCondition || '',
      type: normalizeType(row.type || ''),
    }));
}

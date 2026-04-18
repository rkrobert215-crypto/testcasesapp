import { TestCase } from '@/types/testCase';

function normalizeValue(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildTestCaseKey(testCase: TestCase) {
  return [
    normalizeValue(testCase.testCase || ''),
    normalizeValue(testCase.scenario || ''),
    normalizeValue(testCase.expectedResult || ''),
  ].join('::');
}

export function getUniqueAdditionalTestCases(existing: TestCase[], additions: TestCase[]) {
  const seen = new Set(existing.map(buildTestCaseKey));
  const uniqueAdditions: TestCase[] = [];

  for (const addition of additions) {
    const key = buildTestCaseKey(addition);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueAdditions.push(addition);
  }

  return uniqueAdditions;
}

export function mergeTestCasesPreservingExisting(existing: TestCase[], additions: TestCase[]) {
  return [...existing, ...getUniqueAdditionalTestCases(existing, additions)];
}

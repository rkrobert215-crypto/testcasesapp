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
  let nextNumber = existing.reduce((maximum, testCase) => {
    const match = testCase.id?.match(/(\d+)/);
    const value = match ? Number(match[1]) : 0;
    return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
  }, 0) + 1;
  const uniqueAdditions = getUniqueAdditionalTestCases(existing, additions).map((testCase) => ({
    ...testCase,
    id: `TC_${String(nextNumber++).padStart(3, '0')}`,
  }));

  return [...existing, ...uniqueAdditions];
}

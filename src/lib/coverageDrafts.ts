import { MissingScenario } from '@/hooks/useCoverageValidator';
import { TestCase } from '@/types/testCase';

function nextTestCaseNumber(existing: TestCase[]) {
  const maxExisting = existing.reduce((max, testCase) => {
    const match = testCase.id?.match(/(\d+)/);
    if (!match) return max;
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);

  return maxExisting + 1;
}

function toDraftTitle(scenario: string) {
  const trimmed = scenario.trim();
  if (!trimmed) {
    return 'Verify that the coverage gap scenario is handled correctly';
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('verify that') ||
    lower.startsWith('validate that') ||
    lower.startsWith('ensure that') ||
    lower.startsWith('verify if')
  ) {
    return trimmed;
  }

  const normalized = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return `Verify that ${normalized}`;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function buildCoverageDraftTestCases(
  missingScenarios: MissingScenario[],
  existingTestCases: TestCase[]
) {
  const existingKeys = new Set(
    existingTestCases.flatMap((testCase) => [
      normalizeKey(testCase.testCase || ''),
      normalizeKey(testCase.scenario || ''),
    ])
  );

  let nextNumber = nextTestCaseNumber(existingTestCases);

  return missingScenarios.flatMap((missingScenario) => {
    const title = toDraftTitle(missingScenario.scenario);
    const scenarioKey = normalizeKey(missingScenario.scenario);
    const titleKey = normalizeKey(title);

    if (existingKeys.has(scenarioKey) || existingKeys.has(titleKey)) {
      return [];
    }

    existingKeys.add(scenarioKey);
    existingKeys.add(titleKey);

    const draft: TestCase = {
      id: `TC_${String(nextNumber++).padStart(3, '0')}`,
      requirementReference: 'Coverage Gap Draft',
      module: 'Coverage Gap',
      priority: missingScenario.priority,
      coverageArea: 'Gap Coverage',
      scenario: missingScenario.scenario,
      testCase: title,
      testData: 'Review and define exact test data from the requirement before execution.',
      preconditions: 'Relevant navigation path, permissions, and prerequisite data are available.',
      testSteps: [
        '1. Prepare the required setup and test data for this missing scenario.',
        `2. Execute the scenario: ${missingScenario.scenario}.`,
        '3. Observe the UI, validation messages, saved data, and downstream behavior.',
      ].join('\n'),
      expectedResult: 'Draft coverage-gap testcase added from validation results. Review and refine the expected result against the requirement before execution.',
      postCondition: 'No unintended data corruption or state change is observed after executing the scenario.',
      type: missingScenario.type,
    };

    return [draft];
  });
}

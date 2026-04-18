export type TestCasePriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type TestCaseType = 'Positive' | 'Negative';

export interface GeneratedTestCase {
  id: string;
  requirementReference: string;
  module: string;
  priority: TestCasePriority;
  coverageArea: string;
  scenario: string;
  testCase: string;
  testData: string;
  preconditions: string;
  testSteps: string;
  expectedResult: string;
  postCondition: string;
  type: TestCaseType;
}

export const TEST_CASE_PRIORITY_VALUES: TestCasePriority[] = ['Critical', 'High', 'Medium', 'Low'];
export const TEST_CASE_TYPE_VALUES: TestCaseType[] = ['Positive', 'Negative'];

export const testCaseItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Test case ID like TC_001' },
    requirementReference: {
      type: 'string',
      description: 'Requirement line, acceptance criteria ID, or derived point ID like AC-01 or REQ-03.',
    },
    module: {
      type: 'string',
      description: 'Clean functional module, page, list view, details view, popup, or feature area name, for example Login, Checkout, Vendor List, Purchase Order Details, or Create Charge Popup.',
    },
    priority: {
      type: 'string',
      enum: TEST_CASE_PRIORITY_VALUES,
      description: 'Business/testing priority: Critical, High, Medium, or Low.',
    },
    coverageArea: {
      type: 'string',
      description: 'Specific functional area or scenario cluster being covered.',
    },
    scenario: { type: 'string', description: 'Brief scenario description' },
    testCase: {
      type: 'string',
      description: 'Professional test case title, typically starting with Verify that the <actor>...',
    },
    testData: {
      type: 'string',
      description: 'Concrete data setup or values to use while executing the test.',
    },
    preconditions: { type: 'string', description: 'Preconditions for the test' },
    testSteps: { type: 'string', description: 'Numbered execution steps' },
    expectedResult: {
      type: 'string',
      description: 'Expected outcome in professional QA style. Prefer short, direct, observable results over long padded paragraphs.',
    },
    postCondition: {
      type: 'string',
      description: 'State of the system or data after test completion. Use Not Applicable where needed.',
    },
    type: { type: 'string', enum: TEST_CASE_TYPE_VALUES },
  },
  required: [
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
  ],
  additionalProperties: false,
} as const;

export const testCaseCollectionSchema = {
  type: 'object',
  properties: {
    testCases: {
      type: 'array',
      items: testCaseItemSchema,
    },
  },
  required: ['testCases'],
  additionalProperties: false,
} as const;

export function normalizeGeneratedTestCases(rawCases: unknown[]): GeneratedTestCase[] {
  return rawCases
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item, index) => ({
      id: normalizeString(item.id, `TC_${String(index + 1).padStart(3, '0')}`),
      requirementReference: normalizeString(item.requirementReference, `REQ-${String(index + 1).padStart(2, '0')}`),
      module: normalizeString(item.module, 'General'),
      priority: normalizePriority(item.priority),
      coverageArea: normalizeString(item.coverageArea),
      scenario: normalizeString(item.scenario),
      testCase: normalizeString(item.testCase),
      testData: normalizeString(item.testData, 'Relevant valid and invalid data as per requirement'),
      preconditions: normalizeString(item.preconditions),
      testSteps: normalizeString(item.testSteps),
      expectedResult: normalizeString(item.expectedResult),
      postCondition: normalizeString(item.postCondition, 'Not Applicable'),
      type: item.type === 'Negative' ? 'Negative' : 'Positive',
    }))
    .filter(
      (tc) =>
        tc.requirementReference &&
        tc.module &&
        tc.coverageArea &&
        tc.scenario &&
        tc.testCase &&
        tc.testData &&
        tc.preconditions &&
        tc.testSteps &&
        tc.expectedResult &&
        tc.postCondition
    );
}

export function deduplicateGeneratedTestCases(testCases: GeneratedTestCase[]): GeneratedTestCase[] {
  const seen = new Map<string, number>();

  return testCases.filter((testCase) => {
    const normalizedTitle = normalizeTitleForComparison(testCase.testCase);
    if (!normalizedTitle) return false;
    if (seen.has(normalizedTitle)) return false;

    for (const [existingTitle] of seen) {
      const words1 = new Set(normalizedTitle.split(' '));
      const words2 = new Set(existingTitle.split(' '));
      const intersection = [...words1].filter((word) => words2.has(word)).length;
      const union = new Set([...words1, ...words2]).size;
      if (union > 0 && intersection / union > 0.9) return false;
    }

    seen.set(normalizedTitle, 1);
    return true;
  });
}

function normalizeString(value: unknown, fallback = ''): string {
  return String(value ?? fallback).trim();
}

function normalizePriority(value: unknown): TestCasePriority {
  return value === 'Critical' || value === 'High' || value === 'Medium' || value === 'Low'
    ? value
    : 'Medium';
}

function normalizeTitleForComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

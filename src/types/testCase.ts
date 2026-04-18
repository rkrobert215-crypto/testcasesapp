export interface TestCase {
  id: string;
  requirementReference?: string;
  module?: string;
  priority?: 'Critical' | 'High' | 'Medium' | 'Low';
  coverageArea: string;
  scenario: string;
  testCase: string;
  testData?: string;
  preconditions: string;
  testSteps: string;
  expectedResult: string;
  postCondition?: string;
  type: 'Positive' | 'Negative';
}

export type InputType = 'requirement' | 'highlevel' | 'testcase' | 'scenario' | 'expected';

export interface InputTypeOption {
  value: InputType;
  label: string;
  icon: string | React.ReactNode;
  description: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  inputType: InputType;
  inputSummary: string;
  inputText?: string;
  imagesBase64?: string[];
  testCases: TestCase[];
}

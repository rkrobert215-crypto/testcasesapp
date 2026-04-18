export type SpreadsheetModule = typeof import('xlsx');
export type SpreadsheetSheet = import('xlsx').WorkSheet;

let spreadsheetModulePromise: Promise<SpreadsheetModule> | null = null;

export function loadSpreadsheetModule() {
  if (!spreadsheetModulePromise) {
    spreadsheetModulePromise = import('xlsx');
  }

  return spreadsheetModulePromise;
}

export const COLUMN_MAP: Record<string, string> = {
  'tc id': 'id', 'tc_id': 'id', 'test case id': 'id', 'testcaseid': 'id', 'id': 'id',
  'requirement reference': 'requirementReference', 'requirementreference': 'requirementReference', 'requirement ref': 'requirementReference', 'req reference': 'requirementReference', 'ac reference': 'requirementReference', 'requirement id': 'requirementReference',
  'module': 'module', 'feature': 'module', 'feature area': 'module', 'functional area': 'module',
  'priority': 'priority', 'severity': 'priority', 'business priority': 'priority',
  'coverage area': 'coverageArea', 'coveragearea': 'coverageArea', 'coverage': 'coverageArea', 'area': 'coverageArea',
  'scenario': 'scenario', 'test scenario': 'scenario', 'testscenario': 'scenario',
  'test case': 'testCase', 'testcase': 'testCase', 'test case name': 'testCase', 'test case description': 'testCase', 'description': 'testCase', 'test description': 'testCase',
  'test data': 'testData', 'testdata': 'testData', 'data': 'testData', 'input data': 'testData',
  'preconditions': 'preconditions', 'precondition': 'preconditions', 'pre-conditions': 'preconditions', 'pre conditions': 'preconditions',
  'test steps': 'testSteps', 'teststeps': 'testSteps', 'steps': 'testSteps', 'steps to execute': 'testSteps', 'test step': 'testSteps',
  'expected result': 'expectedResult', 'expectedresult': 'expectedResult', 'expected': 'expectedResult', 'expected results': 'expectedResult', 'expected outcome': 'expectedResult',
  'post condition': 'postCondition', 'postcondition': 'postCondition', 'post-condition': 'postCondition', 'after state': 'postCondition',
  'type': 'type', 'test type': 'type', 'testtype': 'type', 'category': 'type',
};

export function normalizeHeader(header: string): string {
  const cleaned = header.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
  return COLUMN_MAP[cleaned] || cleaned;
}

export function parseSheet(sheet: SpreadsheetSheet, spreadsheet: SpreadsheetModule): Record<string, string>[] {
  const rawRows = spreadsheet.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
  if (rawRows.length === 0) return [];
  const originalHeaders = Object.keys(rawRows[0]);
  const headerMap: Record<string, string> = {};
  originalHeaders.forEach(h => { headerMap[h] = normalizeHeader(h); });
  return rawRows.map(row => {
    const mapped: Record<string, string> = {};
    for (const [orig, norm] of Object.entries(headerMap)) {
      mapped[norm] = String(row[orig] ?? '').trim();
    }
    return mapped;
  }).filter(row => Object.values(row).some(v => v.length > 0));
}

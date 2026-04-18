export interface TestPlanRisk {
  risk: string;
  impact: 'High' | 'Medium' | 'Low';
  mitigation: string;
}

export interface TestPlanRoleResponsibility {
  role: string;
  responsibility: string;
}

export interface TestPlanResult {
  title: string;
  objective: string;
  scopeIn: string[];
  scopeOut: string[];
  testTypes: string[];
  environments: string[];
  assumptions: string[];
  dependencies: string[];
  risks: TestPlanRisk[];
  entryCriteria: string[];
  exitCriteria: string[];
  deliverables: string[];
  milestones: string[];
  rolesAndResponsibilities: TestPlanRoleResponsibility[];
  strategyNotes: string[];
}

export interface TraceabilityMatrixRow {
  id: string;
  requirementReference: string;
  requirementPoint: string;
  module: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  suggestedScenario: string;
  suggestedTestCases: string[];
  coverageStatus: 'Covered' | 'Partial' | 'Missing';
  notes: string;
}

export interface TraceabilityMatrixResult {
  summary: string;
  gaps: string[];
  recommendedNextSteps: string[];
  rows: TraceabilityMatrixRow[];
}

export interface TestDataDataset {
  id: string;
  scenario: string;
  dataCategory: string;
  objective: string;
  sampleData: string[];
  negativeOrEdgeData: string[];
  whyNeeded: string;
  preconditions: string[];
}

export interface TestDataPlanResult {
  summary: string;
  dataCategories: string[];
  environmentNotes: string[];
  privacyNotes: string[];
  datasets: TestDataDataset[];
}

export interface ScenarioMapResult {
  featureGoal: string;
  primaryFlow: string[];
  alternateFlows: string[];
  negativeFlows: string[];
  edgeCases: string[];
  regressionFocus: string[];
  highRiskIntersections: string[];
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  whyItMatters: string;
  riskIfUnanswered: 'High' | 'Medium' | 'Low';
  suggestedOwner: string;
  blockingLevel: 'Blocking' | 'Important' | 'Nice to Have';
}

export interface ClarificationQuestionsResult {
  summary: string;
  assumptions: string[];
  decisionsToConfirm: string[];
  safeTestingAssumptions: string[];
  questions: ClarificationQuestion[];
}

export interface AcceptanceCriteriaAnalysis {
  id: string;
  criterion: string;
  sourceType: 'Explicit AC' | 'Derived Requirement Point';
  plainEnglishMeaning: string;
  moduleHint?: string;
  priority?: 'Critical' | 'High' | 'Medium' | 'Low';
  whatToTest: string[];
  howToTest: string[];
}

export interface RequirementAnalysisResult {
  functionalityExplanation: string;
  simpleSummary: string;
  primaryActor?: string;
  primaryAction?: string;
  recommendedStarter?: string;
  businessModules?: string[];
  mainFlow: string[];
  whatToTest: string[];
  howToTest: string[];
  acceptanceCriteria: AcceptanceCriteriaAnalysis[];
  importantNotes: string[];
  riskHotspots?: string[];
}

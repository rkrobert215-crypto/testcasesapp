export const testPlanSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    objective: { type: 'string' },
    scopeIn: { type: 'array', items: { type: 'string' } },
    scopeOut: { type: 'array', items: { type: 'string' } },
    testTypes: { type: 'array', items: { type: 'string' } },
    environments: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    dependencies: { type: 'array', items: { type: 'string' } },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          risk: { type: 'string' },
          impact: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          mitigation: { type: 'string' },
        },
        required: ['risk', 'impact', 'mitigation'],
        additionalProperties: false,
      },
    },
    entryCriteria: { type: 'array', items: { type: 'string' } },
    exitCriteria: { type: 'array', items: { type: 'string' } },
    deliverables: { type: 'array', items: { type: 'string' } },
    milestones: { type: 'array', items: { type: 'string' } },
    rolesAndResponsibilities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          responsibility: { type: 'string' },
        },
        required: ['role', 'responsibility'],
        additionalProperties: false,
      },
    },
    strategyNotes: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'title',
    'objective',
    'scopeIn',
    'scopeOut',
    'testTypes',
    'environments',
    'assumptions',
    'dependencies',
    'risks',
    'entryCriteria',
    'exitCriteria',
    'deliverables',
    'milestones',
    'rolesAndResponsibilities',
    'strategyNotes',
  ],
  additionalProperties: false,
} as const;

export const traceabilityMatrixSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
    recommendedNextSteps: { type: 'array', items: { type: 'string' } },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          requirementReference: { type: 'string' },
          requirementPoint: { type: 'string' },
          module: { type: 'string' },
          priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
          suggestedScenario: { type: 'string' },
          suggestedTestCases: { type: 'array', items: { type: 'string' } },
          coverageStatus: { type: 'string', enum: ['Covered', 'Partial', 'Missing'] },
          notes: { type: 'string' },
        },
        required: [
          'id',
          'requirementReference',
          'requirementPoint',
          'module',
          'priority',
          'suggestedScenario',
          'suggestedTestCases',
          'coverageStatus',
          'notes',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'gaps', 'recommendedNextSteps', 'rows'],
  additionalProperties: false,
} as const;

export const testDataPlanSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    dataCategories: { type: 'array', items: { type: 'string' } },
    environmentNotes: { type: 'array', items: { type: 'string' } },
    privacyNotes: { type: 'array', items: { type: 'string' } },
    datasets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          scenario: { type: 'string' },
          dataCategory: { type: 'string' },
          objective: { type: 'string' },
          sampleData: { type: 'array', items: { type: 'string' } },
          negativeOrEdgeData: { type: 'array', items: { type: 'string' } },
          whyNeeded: { type: 'string' },
          preconditions: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'id',
          'scenario',
          'dataCategory',
          'objective',
          'sampleData',
          'negativeOrEdgeData',
          'whyNeeded',
          'preconditions',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'dataCategories', 'environmentNotes', 'privacyNotes', 'datasets'],
  additionalProperties: false,
} as const;

export const scenarioMapSchema = {
  type: 'object',
  properties: {
    featureGoal: { type: 'string' },
    primaryFlow: { type: 'array', items: { type: 'string' } },
    alternateFlows: { type: 'array', items: { type: 'string' } },
    negativeFlows: { type: 'array', items: { type: 'string' } },
    edgeCases: { type: 'array', items: { type: 'string' } },
    regressionFocus: { type: 'array', items: { type: 'string' } },
    highRiskIntersections: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'featureGoal',
    'primaryFlow',
    'alternateFlows',
    'negativeFlows',
    'edgeCases',
    'regressionFocus',
    'highRiskIntersections',
  ],
  additionalProperties: false,
} as const;

export const clarificationQuestionsSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    decisionsToConfirm: { type: 'array', items: { type: 'string' } },
    safeTestingAssumptions: { type: 'array', items: { type: 'string' } },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          whyItMatters: { type: 'string' },
          riskIfUnanswered: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          suggestedOwner: { type: 'string' },
          blockingLevel: { type: 'string', enum: ['Blocking', 'Important', 'Nice to Have'] },
        },
        required: ['id', 'question', 'whyItMatters', 'riskIfUnanswered', 'suggestedOwner', 'blockingLevel'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'assumptions', 'decisionsToConfirm', 'safeTestingAssumptions', 'questions'],
  additionalProperties: false,
} as const;

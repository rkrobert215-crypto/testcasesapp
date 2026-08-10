interface TechnicalWorkflowSignals {
  detected: boolean;
  eventDriven: boolean;
  persistence: boolean;
  idempotency: boolean;
  tenantScoped: boolean;
  structuredInput: boolean;
  batchProcessing: boolean;
  downstreamLifecycle: boolean;
}

interface CoverageExpectation {
  label: string;
  evidenceTerms: string[];
}

export interface TechnicalMissingScenario {
  scenario: string;
  priority: 'High' | 'Medium' | 'Low';
  type: 'Positive' | 'Negative';
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function detectTechnicalWorkflowSignals(input: string): TechnicalWorkflowSignals {
  const text = input.toLowerCase();
  const eventDriven = includesAny(text, [
    'consumer',
    'lambda',
    'webhook',
    'background job',
    'upsert',
    'status transition',
    'transitions to',
    'transitioned to',
  ]);
  const persistence = includesAny(text, [
    'insert into',
    'on duplicate key',
    'database',
    'persisted',
    'persistence',
    'document_status',
    'created_date',
    'createddate',
    'sales_order_id',
    'buyer_id',
  ]);
  const idempotency = includesAny(text, [
    'idempotent',
    'on duplicate key',
    're-process',
    'reprocess',
    're-processing',
    'reprocessing',
    'replay',
    'unique constraint',
    'unique index',
  ]);
  const tenantScoped = includesAny(text, [
    'tenant',
    'account configuration',
    'feature flag',
    'featurepoeenabled',
    'poeenabled',
  ]);
  const structuredInput = includesAny(text, [
    'additional fields',
    'additional_fields',
    'json',
    'shipping address',
    'address field',
    'origin',
    'exemption',
  ]);
  const batchProcessing = includesAny(text, [
    'batch',
    'consumer',
    'lambda',
    'upserts',
    'multiple orders',
    'multiple records',
  ]);
  const downstreamLifecycle = includesAny(text, [
    'upload',
    'prompted to',
    'document status',
    'document_status',
    'notification',
    'downstream',
  ]);
  const groupCount = [
    eventDriven,
    persistence,
    idempotency,
    tenantScoped,
    structuredInput,
    batchProcessing,
    downstreamLifecycle,
  ].filter(Boolean).length;

  return {
    detected: (eventDriven && persistence) || idempotency || groupCount >= 3,
    eventDriven,
    persistence,
    idempotency,
    tenantScoped,
    structuredInput,
    batchProcessing,
    downstreamLifecycle,
  };
}

export function buildTechnicalWorkflowCoverageChecklist(input: string): string[] {
  const signals = detectTechnicalWorkflowSignals(input);
  if (!signals.detected) {
    return [];
  }

  const lines = [
    'This is an event-driven, integration, or data-persistence workflow. Treat backend-observable business effects as first-class QA coverage rather than testing only the happy-path row creation.',
    'Build a trigger matrix across every stated status, event path, supported entity/order type, qualifying condition, and non-qualifying condition. If the requirement says all types, verify every remaining supported type instead of using only one generic non-default example.',
    'Verify exact persisted identifiers, statuses, timestamps, ownership, and casing named by the requirement, plus the downstream business-visible result.',
  ];

  if (signals.idempotency) {
    lines.push(
      'Idempotency is a complete risk family: cover sequential replay of the same event, chained qualifying transitions, concurrent/parallel duplicate delivery, and an exact one-record outcome.',
      'When a record already exists, verify reprocessing does not reset an advanced status or overwrite the original creation timestamp.',
      'Verify the database uniqueness constraint or index actually supports the stated duplicate-prevention statement such as ON DUPLICATE KEY; application wording alone is not proof of idempotency.'
    );
  }

  if (signals.tenantScoped) {
    lines.push(
      'For tenant/customer-scoped flags, cover enabled, disabled, and missing configuration independently, including a mixed-tenant batch where only the eligible tenant receives the side effect.',
      'Verify persisted tenant/customer, owner, buyer, and entity identifiers cannot be crossed or mismatched when multiple tenants are processed together.'
    );
  }

  if (signals.structuredInput) {
    lines.push(
      'Cover NULL or missing source records/fields and malformed structured data without an unhandled processing failure.',
      'For exemptions or exact string flags stored in structured data, cover absent/NULL, another value, and documented casing/whitespace behavior. If normalization is unspecified, make the expected behavior an explicit clarification rather than inventing it.'
    );
  }

  if (signals.persistence) {
    lines.push(
      'Verify the new row or side effect is added without modifying, deleting, duplicating, or resetting unrelated existing rows or columns.',
      'Verify normal processing continues unchanged for records that do not qualify for the new side effect.'
    );
  }

  if (signals.eventDriven) {
    lines.push(
      'Cover side-effect insert/update failure isolation so the main consumer/upsert flow follows the stated or configured transaction behavior.',
      'Cover repeated failure using the configured retry and dead-letter policy. Do not invent retry counts or queue names when they are unspecified.'
    );
  }

  if (signals.batchProcessing) {
    lines.push(
      'Cover mixed qualifying/non-qualifying and large-batch processing for correctness, duplicate prevention, tenant isolation, and completion within the configured timeout or performance baseline.'
    );
  }

  if (signals.downstreamLifecycle) {
    lines.push(
      'Follow the downstream lifecycle after the requirement row or status is created: verify the user prompt/action appears, the follow-up action is possible, and the persisted status advances without creating another requirement row when those outcomes are supported.'
    );
  }

  return lines;
}

function buildTechnicalCoverageExpectations(input: string): CoverageExpectation[] {
  const signals = detectTechnicalWorkflowSignals(input);
  if (!signals.detected) {
    return [];
  }

  const expectations: CoverageExpectation[] = [
    {
      label: 'complete trigger/type/status matrix',
      evidenceTerms: ['every remaining', 'every supported', 'all order type', 'all supported type', 'trigger matrix'],
    },
  ];

  if (signals.idempotency) {
    expectations.push(
      {
        label: 'sequential replay/reprocessing idempotency',
        evidenceTerms: ['replay', 're-process', 'reprocess', 're-processing', 'same event'],
      },
      {
        label: 'concurrent duplicate-event idempotency',
        evidenceTerms: ['concurrent', 'parallel', 'simultaneous', 'race condition'],
      },
      {
        label: 'existing advanced status preservation',
        evidenceTerms: ['not reset', 'remain unchanged', 'status preserved', 'preserve existing status', 'uploaded or approved'],
      },
      {
        label: 'original creation timestamp preservation',
        evidenceTerms: ['original created', 'created_date preserved', 'createddate preserved', 'timestamp preserved', 'not overwritten'],
      },
      {
        label: 'database uniqueness enforcement for duplicate prevention',
        evidenceTerms: ['unique constraint', 'unique index', 'on duplicate key'],
      }
    );
  }

  if (signals.tenantScoped) {
    expectations.push(
      {
        label: 'mixed-tenant feature-flag isolation',
        evidenceTerms: ['mixed-tenant', 'mixed tenant', 'two tenants', 'only for the tenant', 'eligible tenant'],
      },
      {
        label: 'cross-tenant identifier safety',
        evidenceTerms: ['cross-tenant', 'cross tenant', 'tenant mismatch', 'buyer/order mismatch', 'identifier mismatch'],
      }
    );
  }

  if (signals.structuredInput) {
    expectations.push(
      {
        label: 'NULL or missing source-data handling',
        evidenceTerms: ['null or missing', 'missing shipping address', 'null shipping address', 'absent shipping address'],
      },
      {
        label: 'malformed structured-data handling',
        evidenceTerms: ['malformed json', 'malformed additional', 'invalid json', 'malformed data'],
      },
    );
  }

  if (signals.persistence) {
    expectations.push(
      {
        label: 'non-interference with existing related records',
        evidenceTerms: ['existing document rows', 'unrelated existing', 'without modifying existing', 'does not modify existing'],
      },
      {
        label: 'non-qualifying main-flow regression protection',
        evidenceTerms: ['normal order upsert', 'main process', 'non-qualifying orders', 'normal processing continue'],
      }
    );
  }

  if (signals.eventDriven) {
    expectations.push(
      {
        label: 'side-effect failure isolation from the main flow',
        evidenceTerms: ['insert fails', 'insert failure', 'main process', 'main flow', 'does not block'],
      },
      {
        label: 'repeated-failure retry/dead-letter behavior',
        evidenceTerms: ['dead letter', 'dead-letter', 'dlq', 'retry policy', 'retried'],
      }
    );
  }

  if (signals.batchProcessing) {
    expectations.push({
      label: 'large-batch correctness and performance',
      evidenceTerms: ['large batch', 'high volume', 'configured timeout', 'processing latency', 'performance baseline'],
    });
  }

  if (signals.downstreamLifecycle) {
    expectations.push({
      label: 'downstream action and persisted status lifecycle',
      evidenceTerms: ['status transition', 'status advances', 'pending to uploaded', 'document_status transition', 'after the buyer uploads'],
    });
  }

  return expectations;
}

export function findMissingTechnicalWorkflowCoverage(input: string, suiteText: string): string[] {
  const normalizedSuite = suiteText.toLowerCase();
  return buildTechnicalCoverageExpectations(input)
    .filter((expectation) => !includesAny(normalizedSuite, expectation.evidenceTerms))
    .map((expectation) => expectation.label);
}

const TECHNICAL_GAP_SCENARIOS: Record<string, TechnicalMissingScenario> = {
  'complete trigger/type/status matrix': {
    scenario: 'Verify the complete matrix of every stated event/status trigger and every supported entity or order type, including each remaining supported type, for qualifying and non-qualifying outcomes.',
    priority: 'High',
    type: 'Positive',
  },
  'sequential replay/reprocessing idempotency': {
    scenario: 'Verify sequential replay or reprocessing of the same qualifying event produces exactly one persisted side effect.',
    priority: 'High',
    type: 'Negative',
  },
  'concurrent duplicate-event idempotency': {
    scenario: 'Verify concurrent duplicate delivery of the same qualifying event produces exactly one persisted side effect without a race-condition duplicate.',
    priority: 'High',
    type: 'Negative',
  },
  'existing advanced status preservation': {
    scenario: 'Verify reprocessing does not reset or downgrade an existing record that has already advanced beyond its initial status.',
    priority: 'High',
    type: 'Negative',
  },
  'original creation timestamp preservation': {
    scenario: 'Verify replay or reprocessing preserves the original creation timestamp instead of overwriting it.',
    priority: 'High',
    type: 'Negative',
  },
  'database uniqueness enforcement for duplicate prevention': {
    scenario: 'Verify the persisted uniqueness constraint or index enforces the stated duplicate-prevention behavior under repeated and concurrent processing.',
    priority: 'High',
    type: 'Negative',
  },
  'mixed-tenant feature-flag isolation': {
    scenario: 'Verify a mixed-tenant batch applies the feature side effect only to records belonging to an eligible tenant with the required configuration enabled.',
    priority: 'High',
    type: 'Negative',
  },
  'cross-tenant identifier safety': {
    scenario: 'Verify tenant, owner, buyer, and entity identifiers cannot be crossed or mismatched when records from multiple tenants are processed together.',
    priority: 'High',
    type: 'Negative',
  },
  'NULL or missing source-data handling': {
    scenario: 'Verify NULL or missing source records and required source fields do not create an invalid side effect or cause an unhandled processing failure.',
    priority: 'High',
    type: 'Negative',
  },
  'malformed structured-data handling': {
    scenario: 'Verify malformed structured source data is handled safely without creating an invalid side effect or breaking the main processing flow.',
    priority: 'High',
    type: 'Negative',
  },
  'non-interference with existing related records': {
    scenario: 'Verify the new persisted side effect does not modify, delete, duplicate, or reset unrelated existing records or columns.',
    priority: 'High',
    type: 'Negative',
  },
  'non-qualifying main-flow regression protection': {
    scenario: 'Verify normal main-flow processing continues unchanged for records that do not qualify for the new side effect.',
    priority: 'High',
    type: 'Positive',
  },
  'side-effect failure isolation from the main flow': {
    scenario: 'Verify a side-effect insert or update failure follows the required transaction behavior without silently corrupting or unintentionally blocking the main flow.',
    priority: 'High',
    type: 'Negative',
  },
  'repeated-failure retry/dead-letter behavior': {
    scenario: 'Verify repeated side-effect failures follow the configured retry and dead-letter policy without inventing unspecified retry counts or queue names.',
    priority: 'High',
    type: 'Negative',
  },
  'large-batch correctness and performance': {
    scenario: 'Verify a large mixed batch preserves correctness, duplicate prevention, tenant isolation, and completion within the configured timeout or performance baseline.',
    priority: 'Medium',
    type: 'Positive',
  },
  'downstream action and persisted status lifecycle': {
    scenario: 'Verify the downstream user action is available and advances the persisted lifecycle status without creating a duplicate requirement record.',
    priority: 'High',
    type: 'Positive',
  },
};

export function buildMissingTechnicalScenarios(
  input: string,
  suiteText: string
): TechnicalMissingScenario[] {
  return findMissingTechnicalWorkflowCoverage(input, suiteText)
    .map((label) => TECHNICAL_GAP_SCENARIOS[label])
    .filter((scenario): scenario is TechnicalMissingScenario => Boolean(scenario));
}

export function buildTechnicalWorkflowRecommendations(input: string, suiteText: string) {
  const signals = detectTechnicalWorkflowSignals(input);
  const normalizedInput = input.toLowerCase();
  const normalizedSuite = suiteText.toLowerCase();
  const hasExactExemption = signals.structuredInput && includesAny(normalizedInput, [
    'exemption',
    'customerorigin',
    'customer origin',
  ]);
  const hasNormalizationEvidence = includesAny(normalizedSuite, [
    'casing',
    'case-sensitive',
    'case insensitive',
    'case-insensitive',
    'whitespace',
  ]);

  return hasExactExemption && !hasNormalizationEvidence
    ? ['Clarification: Confirm whether exact exemption/origin values are case-sensitive and whitespace-sensitive or normalized before comparison.']
    : [];
}

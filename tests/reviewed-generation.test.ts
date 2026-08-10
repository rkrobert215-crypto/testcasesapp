import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureClaudeCliStructuredGenerator,
  type ClaudeCliGenerationOptions,
} from '../supabase/functions/_shared/aiClient.ts';
import { generateReviewedStructuredData } from '../supabase/functions/_shared/reviewedStructuredGeneration.ts';
import { handleHostedFunctionRequest } from '../server/generate-test-cases-server.ts';

test('Claude subscription performs the principal-QA gate in one deadline-safe invocation', async () => {
  const calls: ClaudeCliGenerationOptions[] = [];
  configureClaudeCliStructuredGenerator(async <T>(options: ClaudeCliGenerationOptions) => {
    calls.push(options);
    return { value: 'approved' } as T;
  });

  try {
    const result = await generateReviewedStructuredData<{ value: string }>({
      aiSettings: {
        provider: 'claude_cli',
        claudeCliModel: 'sonnet',
        generationMode: 'rob_style',
        strictRequirementMode: true,
      },
      featureName: 'quality-test',
      artifactLabel: 'test artifact',
      systemPrompt: 'Create the artifact.',
      userParts: [{ type: 'text', text: 'Exact requirement' }],
      output: {
        name: 'return_artifact',
        description: 'Return the artifact.',
        schema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
      reviewThreshold: 91,
      reviewFocusLines: ['Check every acceptance criterion.'],
    });

    assert.deepEqual(result, { value: 'approved' });
    assert.equal(calls.length, 1);
    assert.match(calls[0].systemPrompt, /MANDATORY INTERNAL PRINCIPAL-QA QUALITY GATE/);
    assert.match(calls[0].systemPrompt, /91\/100/);
    assert.match(calls[0].systemPrompt, /Check every acceptance criterion/);
    assert.match(calls[0].systemPrompt, /Strict exact requirement mode is enabled/);
  } finally {
    configureClaudeCliStructuredGenerator(null);
  }
});

test('coverage recommendations are converted through the professional testcase pipeline', async () => {
  const calls: ClaudeCliGenerationOptions[] = [];
  configureClaudeCliStructuredGenerator(async <T>(options: ClaudeCliGenerationOptions) => {
    calls.push(options);
    return {
      testCases: [
        {
          id: 'TC_001',
          requirementReference: 'AC-02',
          module: 'Authentication',
          priority: 'High',
          coverageArea: 'Session Security',
          scenario: 'Session expires after inactivity',
          testCase: 'Verify that the user session expires after 30 minutes of inactivity',
          testData: 'Authenticated user; 30 minutes of inactivity',
          preconditions: 'The user is signed in and the inactivity timeout is configured.',
          testSteps: '1. Sign in.\n2. Leave the session inactive for 30 minutes.\n3. Attempt a protected action.',
          expectedResult: 'The session expires and the user must authenticate again before the action is performed.',
          postCondition: 'No authenticated session remains active.',
          type: 'Negative',
        },
      ],
    } as T;
  });

  try {
    const result = await handleHostedFunctionRequest('audit-test-cases', {
      requirement: 'AC-02: The authenticated session expires after 30 minutes of inactivity.',
      existingTestCases: [],
      focusMissingScenarios: ['Verify inactivity timeout enforcement.'],
      focusRecommendations: ['Add explicit session-expiry and protected-action coverage.'],
      aiSettings: {
        provider: 'claude_cli',
        claudeCliModel: 'sonnet',
        generationMode: 'rob_style',
        strictRequirementMode: true,
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(result.testCases.length, 1);
    const promptText = calls[0].userParts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    assert.match(promptText, /Coverage gaps to generate full testcase rows for/);
    assert.match(promptText, /Coverage recommendations to convert into professional testcase rows when testable/);
    assert.match(promptText, /Add explicit session-expiry and protected-action coverage/);
    assert.match(calls[0].systemPrompt, /Never turn process-only, documentation-only, or clarification advice into fabricated product behavior/);
  } finally {
    configureClaudeCliStructuredGenerator(null);
  }
});

test('coverage validation independently injects technical gaps missed by the AI verdict', async () => {
  configureClaudeCliStructuredGenerator(async <T>() => ({
    coverageScore: 100,
    summary: 'The generated suite fully covers the requirement.',
    coveredAreas: ['POE row creation'],
    missingScenarios: [],
    recommendations: [],
  } as T));

  try {
    const result = await handleHostedFunctionRequest('validate-coverage', {
      input: `
        After processOrderUpserts transitions an order to SHIPPED, INSERT INTO sales_order_documents.
        The tenant feature flag must be enabled, re-processing must be idempotent through
        ON DUPLICATE KEY, buyer.additional_fields contains an origin exemption, and the buyer
        is prompted to upload the document.
      `,
      inputType: 'requirement',
      testCases: [
        {
          id: 'TC_001',
          testCase: 'Verify that a document row is created after an eligible order ships',
          testSteps: '1. Ship an eligible order.\n2. Query the document table.',
          expectedResult: 'One pending document row exists.',
        },
      ],
      aiSettings: {
        provider: 'claude_cli',
        claudeCliModel: 'sonnet',
        generationMode: 'rob_style',
        strictRequirementMode: true,
      },
    }) as {
      coverageScore: number;
      summary: string;
      missingScenarios: Array<{ scenario: string }>;
    };

    assert.ok(result.coverageScore < 100);
    assert.ok(result.missingScenarios.length >= 10);
    assert.match(result.summary, /Independent rule checks added/);
    assert.ok(result.missingScenarios.some((gap) => /concurrent duplicate/i.test(gap.scenario)));
    assert.ok(result.missingScenarios.some((gap) => /mixed-tenant/i.test(gap.scenario)));
  } finally {
    configureClaudeCliStructuredGenerator(null);
  }
});

test('coverage validation independently catches explicit gaps for a non-technical requirement', async () => {
  configureClaudeCliStructuredGenerator(async <T>() => ({
    coverageScore: 100,
    summary: 'The suite is complete.',
    coveredAreas: ['Filter rendering'],
    missingScenarios: [],
    recommendations: [],
  } as T));

  try {
    const result = await handleHostedFunctionRequest('validate-coverage', {
      input: `
        Acceptance Criteria
        - ALL appears first when configured filters exist.
        - Selecting multiple filters combines results with OR behavior.
        - Selecting ALL clears all other selected filters.
        - Orders matching multiple filters appear only once with no duplicates.
      `,
      inputType: 'requirement',
      testCases: [{ testCase: 'Verify that ALL appears first when configured filters exist' }],
      aiSettings: {
        provider: 'claude_cli',
        claudeCliModel: 'sonnet',
        generationMode: 'rob_style',
        strictRequirementMode: true,
      },
    }) as {
      coverageScore: number;
      missingScenarios: Array<{ scenario: string }>;
    };

    assert.ok(result.coverageScore < 100);
    assert.ok(result.missingScenarios.some((gap) => /OR behavior/i.test(gap.scenario)));
    assert.ok(result.missingScenarios.some((gap) => /clears all other/i.test(gap.scenario)));
    assert.ok(result.missingScenarios.some((gap) => /no duplicates/i.test(gap.scenario)));
  } finally {
    configureClaudeCliStructuredGenerator(null);
  }
});

test('coverage validation preserves related but distinct replay and concurrency findings', async () => {
  configureClaudeCliStructuredGenerator(async <T>() => ({
    coverageScore: 65,
    summary: 'Replay and concurrency coverage remain incomplete.',
    coveredAreas: ['Happy path'],
    missingScenarios: [{
      scenario: 'Verify a sequential replay of the same event does not create a duplicate row.',
      priority: 'High',
      type: 'Negative',
    }],
    recommendations: ['Verify concurrent duplicate events do not create duplicate rows.'],
  } as T));

  try {
    const result = await handleHostedFunctionRequest('validate-coverage', {
      input: 'Review the event-processing coverage.',
      inputType: 'scenario',
      testCases: [{ testCase: 'Verify the initial event is processed.' }],
      aiSettings: {
        provider: 'claude_cli',
        claudeCliModel: 'sonnet',
        generationMode: 'rob_style',
        strictRequirementMode: true,
      },
    }) as {
      missingScenarios: Array<{ scenario: string }>;
      recommendations: string[];
    };

    assert.equal(result.missingScenarios.length, 1);
    assert.equal(result.recommendations.length, 1);
  } finally {
    configureClaudeCliStructuredGenerator(null);
  }
});

test('coverage validation preserves clarification notes beside similar executable gaps', async () => {
  configureClaudeCliStructuredGenerator(async <T>() => ({
    coverageScore: 70,
    summary: 'Retry behavior needs review.',
    coveredAreas: [],
    missingScenarios: [{
      scenario: 'Verify retry behavior after insert failures.',
      priority: 'High',
      type: 'Negative',
    }],
    recommendations: ['Clarification: Verify retry behavior after insert failures.'],
  } as T));

  try {
    const result = await handleHostedFunctionRequest('validate-coverage', {
      input: 'Review retry behavior.',
      inputType: 'scenario',
      testCases: [{ testCase: 'Verify the initial insert succeeds.' }],
      aiSettings: {
        provider: 'claude_cli',
        claudeCliModel: 'sonnet',
        generationMode: 'rob_style',
        strictRequirementMode: true,
      },
    }) as {
      missingScenarios: Array<{ scenario: string }>;
      recommendations: string[];
    };

    assert.equal(result.missingScenarios.length, 1);
    assert.deepEqual(result.recommendations, ['Clarification: Verify retry behavior after insert failures.']);
  } finally {
    configureClaudeCliStructuredGenerator(null);
  }
});

test('offline quality loop detects an exact requirement gap, generates it, and passes revalidation', async () => {
  const requirement = `
    Acceptance Criteria
    - Registration allows the user to submit an email and password.
    - Password must contain at least 8 characters.
    - Successful registration sends a verification email.
    - A duplicate email is rejected.
  `;
  const createCase = (
    index: number,
    testCase: string,
    expectedResult: string,
    type: 'Positive' | 'Negative'
  ) => ({
    id: `TC_${String(index).padStart(3, '0')}`,
    requirementReference: `AC-${String(Math.min(index, 4)).padStart(2, '0')}`,
    module: 'Registration',
    priority: type === 'Negative' ? 'High' : 'Medium',
    coverageArea: 'Registration validation',
    scenario: testCase.replace(/^Verify that /i, ''),
    testCase,
    testData: type === 'Negative' ? 'Invalid registration data' : 'Valid registration data',
    preconditions: 'The registration page is available.',
    testSteps: '1. Enter the specified registration data.\n2. Submit the registration form.\n3. Observe the result.',
    expectedResult,
    postCondition: type === 'Negative' ? 'No account is created.' : 'The registration result is recorded.',
    type,
  });
  const initialSuite = [
    createCase(1, 'Verify that successful registration sends a verification email', 'A verification email is sent after registration succeeds.', 'Positive'),
    createCase(2, 'Verify that the user can submit a valid email and password', 'The registration request is accepted.', 'Positive'),
    createCase(3, 'Verify that a duplicate email is rejected during registration', 'The duplicate email is rejected and no account is created.', 'Negative'),
    createCase(4, 'Verify that an empty email is rejected during registration', 'Email validation prevents registration.', 'Negative'),
    createCase(5, 'Verify that an empty password is rejected during registration', 'Password validation prevents registration.', 'Negative'),
    createCase(6, 'Verify that a valid email is retained when password validation fails', 'The email remains available for correction.', 'Positive'),
    createCase(7, 'Verify that registration can be retried after invalid data is corrected', 'The corrected registration request is accepted.', 'Positive'),
    createCase(8, 'Verify that failed duplicate registration does not send a verification email', 'No verification email is sent for the rejected duplicate.', 'Negative'),
  ];
  const boundaryCase = createCase(
    9,
    'Verify that the user can register with a password containing exactly 8 characters',
    'The password satisfies the 8-character minimum and registration is accepted.',
    'Positive'
  );

  configureClaudeCliStructuredGenerator(async <T>(options: ClaudeCliGenerationOptions) => {
    if (options.featureName === 'generate-test-cases') {
      return { testCases: initialSuite } as T;
    }
    if (options.featureName === 'audit-test-cases') {
      return { testCases: [boundaryCase] } as T;
    }
    if (options.featureName === 'validate-coverage') {
      return {
        coverageScore: 100,
        summary: 'The AI review found no additional gaps.',
        coveredAreas: ['Registration'],
        missingScenarios: [],
        recommendations: [],
      } as T;
    }
    throw new Error(`Unexpected feature in offline quality loop: ${options.featureName}`);
  });

  const aiSettings = {
    provider: 'claude_cli',
    claudeCliModel: 'sonnet',
    generationMode: 'rob_style',
    strictRequirementMode: true,
  };

  try {
    const generated = await handleHostedFunctionRequest('generate-test-cases', {
      input: requirement,
      inputType: 'requirement',
      imagesBase64: [],
      aiSettings,
    }) as { testCases: typeof initialSuite };
    const firstCoverage = await handleHostedFunctionRequest('validate-coverage', {
      input: requirement,
      inputType: 'requirement',
      testCases: generated.testCases,
      aiSettings,
    }) as { missingScenarios: Array<{ scenario: string }>; recommendations: string[] };

    assert.equal(generated.testCases.length, initialSuite.length);
    assert.ok(firstCoverage.missingScenarios.some((gap) => /8 characters/i.test(gap.scenario)));

    const additions = await handleHostedFunctionRequest('audit-test-cases', {
      requirement,
      existingTestCases: generated.testCases,
      focusMissingScenarios: firstCoverage.missingScenarios.map((gap) => gap.scenario),
      focusRecommendations: firstCoverage.recommendations,
      aiSettings,
    }) as { testCases: typeof initialSuite };
    const mergedSuite = [...generated.testCases, ...additions.testCases];
    const finalCoverage = await handleHostedFunctionRequest('validate-coverage', {
      input: requirement,
      inputType: 'requirement',
      testCases: mergedSuite,
      aiSettings,
    }) as { missingScenarios: Array<{ scenario: string }> };

    assert.equal(additions.testCases.length, 1);
    assert.deepEqual(finalCoverage.missingScenarios, []);
  } finally {
    configureClaudeCliStructuredGenerator(null);
  }
});

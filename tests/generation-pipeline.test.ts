import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureClaudeCliStructuredGenerator,
  type ClaudeCliGenerationOptions,
} from '../supabase/functions/_shared/aiClient.ts';
import {
  findStrictRequirementContradictions,
  removeUnsupportedStrictTestCases,
  runGenerateTestCasePipeline,
  validateGeneratedCases,
} from '../supabase/functions/_shared/generateTestCasePipeline.ts';

function professionalCase(index: number) {
  const negative = index === 5;
  return {
    id: `TC_${String(index + 1).padStart(3, '0')}`,
    requirementReference: index < 3 ? 'REQ-01' : 'REQ-02',
    module: 'Profile',
    priority: negative ? 'High' : 'Medium',
    coverageArea: negative ? 'Validation' : 'Functional',
    scenario: negative ? 'Reject empty profile name' : `Save profile variation ${index + 1}`,
    testCase: negative
      ? 'Verify that the user cannot save a profile with an empty name'
      : `Verify that the user can save profile variation ${index + 1}`,
    testData: negative ? 'Empty name' : `Valid profile ${index + 1}`,
    preconditions: 'User can open the Profile page.',
    testSteps: negative
      ? '1. Clear Name.\n2. Click Save.'
      : `1. Enter valid profile ${index + 1}.\n2. Click Save.`,
    expectedResult: negative
      ? 'An error is displayed and the profile is not saved.'
      : `Profile variation ${index + 1} is saved and displayed.`,
    postCondition: negative ? 'Profile remains unchanged.' : 'Saved profile is available.',
    type: negative ? 'Negative' : 'Positive',
  };
}

test('Claude Subscription full-suite generation uses one deadline-safe invocation', async () => {
  const calls: ClaudeCliGenerationOptions[] = [];
  configureClaudeCliStructuredGenerator(async <T>(options: ClaudeCliGenerationOptions) => {
    calls.push(options);
    return { testCases: Array.from({ length: 6 }, (_, index) => professionalCase(index)) } as T;
  });

  try {
    const fixtureValidation = validateGeneratedCases(
      'requirement',
      'The user can save a profile. An empty profile name displays an error.',
      Array.from({ length: 6 }, (_, index) => professionalCase(index)),
      null,
      true
    );
    assert.deepEqual(
      fixtureValidation.violations,
      [],
      `Invalid one-call fixture: ${fixtureValidation.violations.join(' | ')}`
    );

    const result = await runGenerateTestCasePipeline({
      aiSettings: {
        provider: 'claude_cli',
        claudeCliModel: 'sonnet',
        generationMode: 'rob_style',
        strictRequirementMode: true,
      },
      input: 'The user can save a profile. An empty profile name displays an error.',
      inputType: 'requirement',
      images: [],
      cacheKey: null,
    });

    assert.equal(
      calls.length,
      1,
      `Unexpected Claude calls: ${calls.map((call) => call.featureName).join(', ')}`
    );
    assert.equal(result.testCases.length, 6);
    assert.match(calls[0].systemPrompt, /MANDATORY INTERNAL PRINCIPAL-QA QUALITY GATE/);
    assert.match(calls[0].systemPrompt, /atomic requirement points/);
    assert.match(calls[0].systemPrompt, /semantic duplicates/);
  } finally {
    configureClaudeCliStructuredGenerator(null);
  }
});

test('strict requirement filtering removes contradictions and unsupported assumptions', () => {
  const requirement = 'POE applies to all order types with no STOCKLIST restriction. customerOrigin ItochuJapan is exempt.';
  const valid = professionalCase(0);
  const validNegativeControl = {
    ...professionalCase(4),
    id: 'TC_005',
    scenario: 'Reject a non-freight-forward STOCKLIST order',
    testCase: 'Verify that no POE row is created for a STOCKLIST order sent to a non-freight-forward address',
    testData: 'STOCKLIST order and standard shipping address; no restriction is applied based on order type.',
    preconditions: 'Assuming a test tenant exists, enable POE and prepare both STOCKLIST and standard orders.',
    expectedResult: 'No POE row is created because the shipping address is not a freight-forward destination.',
    type: 'Negative',
  };
  const validAllTypes = {
    ...professionalCase(5),
    id: 'TC_006',
    scenario: 'Create POE for every supported order type',
    testCase: 'Verify that POE creation applies to STOCKLIST and all other order types without restriction',
    testData: 'STOCKLIST and non-STOCKLIST qualifying orders.',
    expectedResult: 'Exactly one POE row is created for each qualifying order type, including STOCKLIST.',
    type: 'Positive',
  };
  const stocklistContradiction = {
    ...professionalCase(1),
    id: 'TC_002',
    testCase: 'Verify that no POE row is created for STOCKLIST orders',
    expectedResult: 'STOCKLIST orders are excluded and no POE row is created.',
  };
  const defaultAssumption = {
    ...professionalCase(2),
    id: 'TC_003',
    testCase: 'Verify that a missing flag defaults to disabled',
    expectedResult: 'No row is created, assuming a default-off behavior.',
  };
  const normalizationAssumption = {
    ...professionalCase(3),
    id: 'TC_004',
    testCase: 'Verify that ItochuJapan casing and whitespace variants remain exempt',
    expectedResult: 'Casing and whitespace are normalized before comparison.',
  };

  assert.match(findStrictRequirementContradictions(requirement, stocklistContradiction)[0], /excludes stocklist/i);
  assert.deepEqual(
    removeUnsupportedStrictTestCases(
      requirement,
      [
        valid,
        validNegativeControl,
        validAllTypes,
        stocklistContradiction,
        defaultAssumption,
        normalizationAssumption,
      ],
      true
    ).map((testCase) => testCase.testCase),
    [valid.testCase, validNegativeControl.testCase, validAllTypes.testCase]
  );
});

test('simple requirements produce a complete right-sized suite without count padding', async () => {
  const calls: ClaudeCliGenerationOptions[] = [];
  const dashboardCase = {
    ...professionalCase(0),
    requirementReference: 'REQ-01',
    module: 'Dashboard',
    coverageArea: 'Access',
    scenario: 'View the dashboard',
    testCase: 'Verify that the user can view the dashboard',
    testData: 'User with dashboard access',
    preconditions: 'The user is authenticated.',
    testSteps: '1. Open the dashboard.',
    expectedResult: 'The dashboard is displayed to the user.',
    postCondition: 'The dashboard remains available.',
    type: 'Positive' as const,
  };

  configureClaudeCliStructuredGenerator(async <T>(options: ClaudeCliGenerationOptions) => {
    calls.push(options);
    return { testCases: [dashboardCase] } as T;
  });

  try {
    const result = await runGenerateTestCasePipeline({
      aiSettings: {
        provider: 'claude_cli',
        claudeCliModel: 'sonnet',
        generationMode: 'professional_standard',
        strictRequirementMode: false,
      },
      input: 'The user can view the dashboard.',
      inputType: 'requirement',
      images: [],
      cacheKey: null,
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(result.testCases, [dashboardCase]);
    const promptText = calls[0].userParts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    assert.match(promptText, /Do not target or pad to a predetermined testcase count/);
    assert.match(promptText, /input or data permutations/);
    assert.doesNotMatch(promptText, /28 to 35|30 to 35/);
  } finally {
    configureClaudeCliStructuredGenerator(null);
  }
});

test('requirement, high-level, and scenario validation reject missing explicit behavior without count floors', () => {
  const suite = [{
    ...professionalCase(0),
    requirementReference: 'AC-01',
    module: 'Sales Order List',
    coverageArea: 'Filter Order',
    scenario: 'ALL filter appears first',
    testCase: 'Verify that the user sees the ALL filter first when configured filters exist',
    testData: 'Tenant with configured filters',
    expectedResult: 'The ALL filter appears first.',
    type: 'Positive' as const,
  }];
  for (const inputType of ['requirement', 'highlevel', 'scenario'] as const) {
    const validation = validateGeneratedCases(
      inputType,
      'Acceptance Criteria\n- ALL appears first when configured filters exist.\n- Selecting ALL clears every other selected filter.',
      suite,
      null,
      true
    );

    assert.equal(validation.valid, false);
    assert.ok(validation.violations.some((violation) =>
      /Explicit requirement coverage is missing/i.test(violation) &&
      /Selecting ALL clears every other selected filter/i.test(violation)
    ));
    assert.ok(validation.violations.every((violation) => !/expected at least/i.test(violation)));
  }
});

test('validation requires a Negative row only when the requirement states a negative outcome', () => {
  const mislabeledNegative = [{
    ...professionalCase(0),
    requirementReference: 'AC-01',
    module: 'Login',
    coverageArea: 'Credential Validation',
    scenario: 'Invalid password error',
    testCase: 'Verify that the user sees an error for an invalid password',
    testData: 'Registered email and invalid password',
    expectedResult: 'An invalid password error is displayed.',
    type: 'Positive' as const,
  }];
  const validation = validateGeneratedCases(
    'requirement',
    'Acceptance Criteria\n- Invalid password displays an error.',
    mislabeledNegative,
    null,
    true
  );

  assert.equal(validation.valid, false);
  assert.ok(validation.violations.some((violation) => /has no Negative testcase/i.test(violation)));
});

test('equally noncompliant retries are not selected just because they contain more rows', async () => {
  const calls: ClaudeCliGenerationOptions[] = [];
  const buildInvalidCase = (index: number) => ({
    ...professionalCase(index),
    testCase: `Check profile display variation ${index + 1}`,
    scenario: `Profile display variation ${index + 1}`,
  });

  configureClaudeCliStructuredGenerator(async <T>(options: ClaudeCliGenerationOptions) => {
    calls.push(options);
    const count = calls.length === 1 ? 4 : 2;
    return { testCases: Array.from({ length: count }, (_, index) => buildInvalidCase(index)) } as T;
  });

  try {
    const result = await runGenerateTestCasePipeline({
      aiSettings: {
        provider: 'claude_cli',
        claudeCliModel: 'sonnet',
        generationMode: 'rob_style',
        strictRequirementMode: true,
      },
      input: 'Profile display',
      inputType: 'scenario',
      images: [],
      cacheKey: null,
    });

    assert.equal(calls.length, 2);
    assert.equal(result.testCases.length, 2);
  } finally {
    configureClaudeCliStructuredGenerator(null);
  }
});

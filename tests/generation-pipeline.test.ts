import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureClaudeCliStructuredGenerator,
  type ClaudeCliGenerationOptions,
} from '../supabase/functions/_shared/aiClient.ts';
import {
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

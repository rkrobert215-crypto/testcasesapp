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

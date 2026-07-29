import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureClaudeCliStructuredGenerator,
  type ClaudeCliGenerationOptions,
} from '../supabase/functions/_shared/aiClient.ts';
import { generateReviewedStructuredData } from '../supabase/functions/_shared/reviewedStructuredGeneration.ts';

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

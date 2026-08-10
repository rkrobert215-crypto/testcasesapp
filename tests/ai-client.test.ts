import assert from 'node:assert/strict';
import test from 'node:test';
import { generateStructuredData } from '../supabase/functions/_shared/aiClient';

test('OpenRouter requests use a bounded structured-output token budget', async () => {
  const originalFetch = globalThis.fetch;
  const originalMaxTokens = process.env.OPENROUTER_MAX_TOKENS;
  let requestBody: Record<string, unknown> | null = null;

  process.env.OPENROUTER_MAX_TOKENS = '4096';
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({ value: 'ok' }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const result = await generateStructuredData<{ value: string }>({
      aiSettings: {
        provider: 'openrouter',
        openrouterApiKey: 'test-key',
        openrouterModel: 'openrouter/auto',
      },
      systemPrompt: 'Return the structured result.',
      userParts: [{ type: 'text', text: 'Test input' }],
      output: {
        name: 'return_test_result',
        description: 'Return a test result.',
        schema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
      featureName: 'ai-client-test',
    });

    assert.deepEqual(result, { value: 'ok' });
    assert.equal(requestBody?.max_tokens, 4096);
  } finally {
    globalThis.fetch = originalFetch;
    if (typeof originalMaxTokens === 'string') {
      process.env.OPENROUTER_MAX_TOKENS = originalMaxTokens;
    } else {
      delete process.env.OPENROUTER_MAX_TOKENS;
    }
  }
});

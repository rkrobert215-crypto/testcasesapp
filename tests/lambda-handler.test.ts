import assert from 'node:assert/strict';
import test from 'node:test';
import { createLambdaHandler } from '../cloud/aws/lambda-handler.mjs';

function event(overrides: Record<string, unknown> = {}) {
  return {
    rawPath: '/api/functions/generate-test-cases',
    requestContext: { http: { method: 'POST' } },
    headers: { 'x-testcase-proxy-token': 'proxy-secret' },
    body: JSON.stringify({
      input: 'Requirement',
      inputType: 'requirement',
      aiSettings: {
        provider: 'claude_cli',
        claudeCliModel: 'sonnet',
        hostedAccessToken: 'must-not-reach-lambda-server',
        openaiApiKey: 'must-not-reach-server',
      },
    }),
    ...overrides,
  };
}

test('Lambda rejects requests before loading the server when proxy token is wrong', async () => {
  let loaded = false;
  const handler = createLambdaHandler({
    environment: { LAMBDA_PROXY_TOKEN: 'proxy-secret' },
    loadServer: async () => {
      loaded = true;
      return {};
    },
  });
  const response = await handler(event({ headers: { 'x-testcase-proxy-token': 'wrong' } }));

  assert.equal(response.statusCode, 404);
  assert.equal(loaded, false);
});

test('Lambda dispatches a known function and strips browser API keys', async () => {
  let receivedBody: Record<string, unknown> | null = null;
  const handler = createLambdaHandler({
    environment: { LAMBDA_PROXY_TOKEN: 'proxy-secret' },
    loadServer: async () => ({
      handleHostedFunctionRequest: async (_name: string, body: Record<string, unknown>) => {
        receivedBody = body;
        return { testCases: [{ id: 'TC-001' }] };
      },
      toProviderFailure: () => null,
    }),
  });
  const response = await handler(event());
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.testCases[0].id, 'TC-001');
  const settings = receivedBody?.aiSettings as Record<string, unknown>;
  assert.equal(settings.provider, 'claude_cli');
  assert.equal(settings.hostedAccessToken, undefined);
  assert.equal(settings.openaiApiKey, undefined);
});

test('Lambda accepts Function URL base64 bodies', async () => {
  const body = JSON.stringify({ requirement: 'Exact AC' });
  const handler = createLambdaHandler({
    environment: { LAMBDA_PROXY_TOKEN: 'proxy-secret' },
    loadServer: async () => ({
      handleHostedFunctionRequest: async () => ({ ok: true }),
      toProviderFailure: () => null,
    }),
  });
  const response = await handler(
    event({
      rawPath: '/api/functions/test-plan',
      isBase64Encoded: true,
      body: Buffer.from(body).toString('base64'),
    })
  );

  assert.equal(response.statusCode, 200);
});

test('Lambda does not expose stack traces for unexpected failures', async () => {
  const handler = createLambdaHandler({
    environment: { LAMBDA_PROXY_TOKEN: 'proxy-secret' },
    loadServer: async () => ({
      handleHostedFunctionRequest: async () => {
        throw new Error('database stack /private/path secret implementation');
      },
      toProviderFailure: () => null,
    }),
  });
  const response = await handler(event());

  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), {
    error: 'The AI service could not complete the request.',
  });
});

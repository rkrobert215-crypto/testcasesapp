import assert from 'node:assert/strict';
import test from 'node:test';
import { createVercelHandler } from '../api/functions/[functionName].ts';

function responseRecorder() {
  let statusCode = 200;
  const headers = new Map<string, string>();
  let body: unknown;
  let ended = false;

  return {
    response: {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
      },
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      end() {
        ended = true;
      },
    },
    read() {
      return { statusCode, headers, body, ended };
    },
  };
}

test('Vercel handler strips browser provider keys before calling the hosted server', async () => {
  let receivedBody: Record<string, unknown> | null = null;
  const handler = createVercelHandler(
    async () => ({
      handleHostedFunctionRequest: async (_functionName, body) => {
        receivedBody = body;
        return { testCases: [{ id: 'TC_001' }] };
      },
      toProviderFailure: () => null,
    }),
    { environment: {} }
  );
  const recorder = responseRecorder();

  await handler(
    {
      method: 'POST',
      query: { functionName: 'generate-test-cases' },
      body: {
        input: 'Requirement',
        aiSettings: {
          provider: 'gemini',
          geminiApiKey: 'browser-secret',
          generationMode: 'rob_style',
        },
      },
    },
    recorder.response
  );

  assert.equal(recorder.read().statusCode, 200);
  assert.equal((receivedBody?.aiSettings as Record<string, unknown>).geminiApiKey, undefined);
});

test('Vercel handler does not expose unexpected error details', async () => {
  const handler = createVercelHandler(
    async () => ({
      handleHostedFunctionRequest: async () => {
        throw new Error('private stack path and secret implementation');
      },
      toProviderFailure: () => null,
    }),
    { environment: {} }
  );
  const recorder = responseRecorder();

  await handler(
    { method: 'POST', query: { functionName: 'test-plan' }, body: {} },
    recorder.response
  );

  assert.deepEqual(recorder.read().body, {
    error: 'The AI service could not complete the request.',
  });
  assert.equal(recorder.read().statusCode, 500);
});

test('Vercel handler routes Claude Subscription through the protected Lambda backend', async () => {
  let receivedUrl = '';
  let receivedInit: RequestInit | undefined;
  const handler = createVercelHandler(
    async () => {
      throw new Error('The local Vercel server path must not run for Claude Subscription.');
    },
    {
      environment: {
        CLAUDE_CLI_LAMBDA_URL: 'https://example.lambda-url.test/',
        LAMBDA_PROXY_TOKEN: 'private-proxy-token',
        HOSTED_AI_ACCESS_TOKEN: 'hosted-access-token',
      },
      fetchImpl: async (url, init) => {
        receivedUrl = url;
        receivedInit = init;
        return new Response(JSON.stringify({ testCases: [{ id: 'TC_001' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    }
  );
  const recorder = responseRecorder();

  await handler(
    {
      method: 'POST',
      query: { functionName: 'generate-test-cases' },
      body: {
        input: 'Requirement',
        aiSettings: {
          provider: 'claude_cli',
          claudeCliModel: 'sonnet',
          hostedAccessToken: 'hosted-access-token',
          claudeApiKey: 'must-not-leave-the-browser-boundary',
        },
      },
    },
    recorder.response
  );

  assert.equal(receivedUrl, 'https://example.lambda-url.test/api/functions/generate-test-cases');
  assert.equal(
    (receivedInit?.headers as Record<string, string>)['X-Testcase-Proxy-Token'],
    'private-proxy-token'
  );
  const forwardedBody = JSON.parse(String(receivedInit?.body));
  assert.equal(forwardedBody.aiSettings.provider, 'claude_cli');
  assert.equal(forwardedBody.aiSettings.hostedAccessToken, undefined);
  assert.equal(forwardedBody.aiSettings.claudeApiKey, undefined);
  assert.equal(recorder.read().statusCode, 200);
});

test('Vercel handler reports an explicit configuration error when Claude backend is absent', async () => {
  const handler = createVercelHandler(
    async () => {
      throw new Error('Server loader must not run.');
    },
    { environment: { HOSTED_AI_ACCESS_TOKEN: 'hosted-access-token' } }
  );
  const recorder = responseRecorder();

  await handler(
    {
      method: 'POST',
      query: { functionName: 'test-plan' },
      body: {
        aiSettings: {
          provider: 'claude_cli',
          hostedAccessToken: 'hosted-access-token',
        },
      },
    },
    recorder.response
  );

  assert.equal(recorder.read().statusCode, 503);
  assert.deepEqual(recorder.read().body, {
    error:
      'Claude Subscription is not configured for this deployment. Configure the protected Claude CLI backend and redeploy.',
  });
});

test('Vercel handler rejects an invalid hosted access token before invoking a provider', async () => {
  let loaded = false;
  let fetched = false;
  const handler = createVercelHandler(
    async () => {
      loaded = true;
      return {
        handleHostedFunctionRequest: async () => ({ ok: true }),
        toProviderFailure: () => null,
      };
    },
    {
      environment: {
        CLAUDE_CLI_LAMBDA_URL: 'https://example.lambda-url.test/',
        LAMBDA_PROXY_TOKEN: 'private-proxy-token',
        HOSTED_AI_ACCESS_TOKEN: 'hosted-access-token',
      },
      fetchImpl: async () => {
        fetched = true;
        return new Response('{}');
      },
    }
  );
  const recorder = responseRecorder();

  await handler(
    {
      method: 'POST',
      query: { functionName: 'generate-test-cases' },
      body: {
        aiSettings: {
          provider: 'claude_cli',
          hostedAccessToken: 'wrong-token',
        },
      },
    },
    recorder.response
  );

  assert.equal(recorder.read().statusCode, 401);
  assert.deepEqual(recorder.read().body, { error: 'Hosted AI access is not authorized.' });
  assert.equal(loaded, false);
  assert.equal(fetched, false);
});

test('Vercel handler requires hosted access configuration for Claude Subscription', async () => {
  const handler = createVercelHandler(
    async () => {
      throw new Error('Server loader must not run.');
    },
    { environment: {} }
  );
  const recorder = responseRecorder();

  await handler(
    {
      method: 'POST',
      query: { functionName: 'test-plan' },
      body: { aiSettings: { provider: 'claude_cli' } },
    },
    recorder.response
  );

  assert.equal(recorder.read().statusCode, 503);
  assert.deepEqual(recorder.read().body, {
    error:
      'Hosted AI access is not configured for Claude Subscription. Set HOSTED_AI_ACCESS_TOKEN and redeploy.',
  });
});

test('Vercel handler protects direct API providers when hosted access is configured', async () => {
  let loaded = false;
  const handler = createVercelHandler(
    async () => {
      loaded = true;
      return {
        handleHostedFunctionRequest: async () => ({ ok: true }),
        toProviderFailure: () => null,
      };
    },
    { environment: { HOSTED_AI_ACCESS_TOKEN: 'hosted-access-token' } }
  );
  const recorder = responseRecorder();

  await handler(
    {
      method: 'POST',
      query: { functionName: 'requirement-analysis' },
      body: {
        aiSettings: {
          provider: 'gemini',
          hostedAccessToken: 'wrong-token',
        },
      },
    },
    recorder.response
  );

  assert.equal(recorder.read().statusCode, 401);
  assert.equal(loaded, false);
});

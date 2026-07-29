import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorker } from '../cloud/cloudflare/worker.js';

const credentials = `Basic ${Buffer.from('qa-user:strong-pass').toString('base64')}`;

function environment() {
  return {
    APP_USERNAME: 'qa-user',
    APP_PASSWORD: 'strong-pass',
    LAMBDA_FUNCTION_URL: 'https://lambda.example',
    LAMBDA_PROXY_TOKEN: 'private-token',
    ASSETS: {
      fetch: async () => new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }),
    },
  };
}

test('Worker fails closed when cloud secrets are missing', async () => {
  const response = await createWorker().fetch(new Request('https://app.example/'), {});
  assert.equal(response.status, 503);
});

test('Worker protects both static assets and API routes with Basic Auth', async () => {
  const worker = createWorker();
  const unauthorized = await worker.fetch(new Request('https://app.example/'), environment());
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('www-authenticate') || '', /Basic/);

  const authorized = await worker.fetch(
    new Request('https://app.example/', { headers: { Authorization: credentials } }),
    environment()
  );
  assert.equal(authorized.status, 200);
  assert.equal(authorized.headers.get('x-frame-options'), 'DENY');
});

test('Worker proxies only known AI functions and injects only the private token', async () => {
  let receivedRequest: { url: string; init: RequestInit } | null = null;
  const worker = createWorker(async (url: string, init: RequestInit) => {
    receivedRequest = { url, init };
    return new Response(JSON.stringify({ testCases: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const request = new Request('https://app.example/api/functions/generate-test-cases', {
    method: 'POST',
    headers: {
      Authorization: credentials,
      Cookie: 'browser-cookie=secret',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const response = await worker.fetch(request, environment());

  assert.equal(response.status, 200);
  assert.equal(receivedRequest?.url, 'https://lambda.example/api/functions/generate-test-cases');
  const headers = receivedRequest?.init.headers as Headers;
  assert.equal(headers.get('x-testcase-proxy-token'), 'private-token');
  assert.equal(headers.get('authorization'), null);
  assert.equal(headers.get('cookie'), null);

  const unknown = await worker.fetch(
    new Request('https://app.example/api/functions/not-real', {
      method: 'POST',
      headers: { Authorization: credentials },
      body: '{}',
    }),
    environment()
  );
  assert.equal(unknown.status, 404);
});

test('Worker rejects a declared oversized request before proxying', async () => {
  const response = await createWorker().fetch(
    new Request('https://app.example/api/functions/generate-test-cases', {
      method: 'POST',
      headers: {
        Authorization: credentials,
        'Content-Length': '5500001',
      },
      body: '{}',
    }),
    environment()
  );
  assert.equal(response.status, 413);
});

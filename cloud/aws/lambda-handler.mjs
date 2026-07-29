import { timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

const KNOWN_AI_FUNCTIONS = new Set([
  'generate-test-cases',
  'requirement-analysis',
  'audit-test-cases',
  'smart-merge-testcases',
  'validate-coverage',
  'test-plan',
  'traceability-matrix',
  'test-data-plan',
  'scenario-map',
  'clarification-questions',
]);
const MAX_REQUEST_BYTES = 5_500_000;
const MAX_RESPONSE_BYTES = 5_500_000;
const API_KEY_FIELDS = [
  'hostedAccessToken',
  'openaiApiKey',
  'claudeApiKey',
  'geminiApiKey',
  'groqApiKey',
  'openrouterApiKey',
];
let serverModulePromise;

export function createLambdaHandler({
  environment = process.env,
  loadServer = defaultLoadServer,
} = {}) {
  return async function lambdaHandler(event) {
    const configuredToken = environment.LAMBDA_PROXY_TOKEN;
    if (!configuredToken) {
      return jsonResponse(503, { error: 'AI service configuration is incomplete.' });
    }

    const suppliedToken = readHeader(event?.headers, 'x-testcase-proxy-token');
    if (!constantTimeEqual(suppliedToken, configuredToken)) {
      return jsonResponse(404, { error: 'Not found.' });
    }

    const method = event?.requestContext?.http?.method || event?.httpMethod;
    if (method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed.' }, { Allow: 'POST' });
    }

    const functionName = readFunctionName(event?.rawPath || event?.path || '');
    if (!functionName || !KNOWN_AI_FUNCTIONS.has(functionName)) {
      return jsonResponse(404, { error: 'Not found.' });
    }

    let body;
    try {
      body = parseRequestBody(event);
    } catch (error) {
      return jsonResponse(error?.statusCode || 400, {
        error: error instanceof Error ? error.message : 'Invalid request body.',
      });
    }

    await prepareClaudeHome(environment);

    try {
      const server = await loadServer();
      const result = await server.handleHostedFunctionRequest(functionName, stripBrowserSecrets(body));
      const response = jsonResponse(200, result);
      if (Buffer.byteLength(response.body, 'utf8') > MAX_RESPONSE_BYTES) {
        return jsonResponse(502, { error: 'Generated output exceeded the cloud response limit.' });
      }
      return response;
    } catch (error) {
      const server = await loadServer().catch(() => null);
      const providerError = server?.toProviderFailure?.(error) || null;
      if (providerError) {
        return jsonResponse(providerError.status, { error: providerError.errorText });
      }

      console.error('[lambda-ai] request failed:', safeErrorMessage(error));
      return jsonResponse(500, {
        error:
          error instanceof Error && isSafeOperationalError(error.message)
            ? error.message
            : 'The AI service could not complete the request.',
      });
    }
  };
}

export const handler = createLambdaHandler();

async function defaultLoadServer() {
  serverModulePromise ||= import('../../server-dist/generate-test-cases-server.js');
  return serverModulePromise;
}

function parseRequestBody(event) {
  const rawBody = typeof event?.body === 'string' ? event.body : '';
  const bodyBuffer = event?.isBase64Encoded
    ? Buffer.from(rawBody, 'base64')
    : Buffer.from(rawBody, 'utf8');

  if (bodyBuffer.length > MAX_REQUEST_BYTES) {
    throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
  }
  if (bodyBuffer.length === 0) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyBuffer.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must contain valid JSON.'), { statusCode: 400 });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { statusCode: 400 });
  }
  return parsed;
}

function stripBrowserSecrets(body) {
  const cleanBody = { ...body };
  if (!cleanBody.aiSettings || typeof cleanBody.aiSettings !== 'object' || Array.isArray(cleanBody.aiSettings)) {
    return cleanBody;
  }

  const cleanSettings = { ...cleanBody.aiSettings };
  for (const field of API_KEY_FIELDS) {
    delete cleanSettings[field];
  }
  cleanBody.aiSettings = cleanSettings;
  return cleanBody;
}

function readFunctionName(pathname) {
  const prefix = '/api/functions/';
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const functionName = pathname.slice(prefix.length);
  return functionName && !functionName.includes('/') ? decodeURIComponent(functionName) : null;
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return '';
  }
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === target);
  return typeof entry?.[1] === 'string' ? entry[1] : '';
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left || '', 'utf8');
  const rightBuffer = Buffer.from(right || '', 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    const padded = Buffer.alloc(rightBuffer.length);
    leftBuffer.copy(padded, 0, 0, Math.min(leftBuffer.length, padded.length));
    timingSafeEqual(padded, rightBuffer);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  };
}

async function prepareClaudeHome(environment) {
  if (!environment.AWS_LAMBDA_FUNCTION_NAME) {
    return;
  }
  environment.HOME ||= '/tmp/claude-home';
  environment.CLAUDE_CONFIG_DIR ||= '/tmp/claude-config';
  await Promise.all([
    mkdir(environment.HOME, { recursive: true }),
    mkdir(environment.CLAUDE_CONFIG_DIR, { recursive: true }),
  ]);
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:sk|AIza|gsk_|oauth)[A-Za-z0-9_.-]{8,}/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 800);
}

function isSafeOperationalError(message) {
  const normalized = message.toLowerCase();
  return [
    'claude cli timed out',
    'claude cli was not found',
    'claude cli exited',
    'subscription',
    'rate limit',
    'usage limit',
    'request body is too large',
    'screenshot',
  ].some((allowedFragment) => normalized.includes(allowedFragment));
}

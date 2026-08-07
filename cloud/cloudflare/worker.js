const AI_FUNCTIONS = new Set([
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
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function createWorker(fetchImpl = fetch) {
  return {
    async fetch(request, environment) {
      if (!hasRequiredEnvironment(environment)) {
        return secureJson({ error: 'Cloud deployment is not configured.' }, 503);
      }
      if (!isAuthorized(request, environment.APP_USERNAME, environment.APP_PASSWORD)) {
        return new Response('Authentication required.', {
          status: 401,
          headers: {
            ...SECURITY_HEADERS,
            'Cache-Control': 'no-store',
            'WWW-Authenticate': 'Basic realm="Test Case Generator", charset="UTF-8"',
          },
        });
      }

      const url = new URL(request.url);
      if (url.pathname === '/api/health') {
        return secureJson({ ok: true }, 200);
      }
      if (url.pathname.startsWith('/api/functions/')) {
        return proxyAiFunction(request, environment, fetchImpl);
      }

      const assetResponse = await environment.ASSETS.fetch(request);
      return withSecurityHeaders(assetResponse, {
        'Cache-Control': isHashedAsset(url.pathname)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
    },
  };
}

export default createWorker();

async function proxyAiFunction(request, environment, fetchImpl) {
  if (request.method !== 'POST') {
    return secureJson({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
  }

  const url = new URL(request.url);
  const functionName = url.pathname.slice('/api/functions/'.length);
  if (!AI_FUNCTIONS.has(functionName) || functionName.includes('/')) {
    return secureJson({ error: 'Not found.' }, 404);
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    return secureJson({ error: 'Request body is too large.' }, 413);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_REQUEST_BYTES) {
    return secureJson({ error: 'Request body is too large.' }, 413);
  }

  const targetBase = environment.LAMBDA_FUNCTION_URL.replace(/\/+$/, '');
  const targetUrl = `${targetBase}/api/functions/${encodeURIComponent(functionName)}`;
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Testcase-Proxy-Token': environment.LAMBDA_PROXY_TOKEN,
  });

  let upstreamResponse;
  try {
    upstreamResponse = await fetchImpl(targetUrl, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
    });
  } catch (error) {
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
    const redactedDiagnostic = diagnostic.replace(/https?:\/\/\S+/g, '[upstream-url]');
    console.error(
      '[cloudflare-worker] Lambda proxy fetch failed:',
      redactedDiagnostic
    );
    return secureJson({ error: 'The AI service is temporarily unavailable.' }, 502);
  }

  if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    return secureJson({ error: 'The AI service returned an invalid redirect.' }, 502);
  }

  // Streamed through deliberately: the Lambda emits whitespace heartbeats to stop this
  // subrequest going idle, and buffering here would discard that. A late Lambda failure
  // therefore arrives as a 200 whose body carries the real status in `__upstreamStatus`
  // (see cloud/aws/lambda-handler.mjs); the browser unwraps it in src/lib/retryWithBackoff.ts.
  // Do not buffer or rewrite the body here.
  return withSecurityHeaders(
    new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: {
        'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json',
      },
    }),
    { 'Cache-Control': 'no-store' }
  );
}

function hasRequiredEnvironment(environment) {
  return Boolean(
    environment?.ASSETS &&
      environment.APP_USERNAME &&
      environment.APP_PASSWORD &&
      environment.LAMBDA_FUNCTION_URL &&
      environment.LAMBDA_PROXY_TOKEN
  );
}

function isAuthorized(request, username, password) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Basic ')) {
    return false;
  }

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(':');
    if (separator < 0) {
      return false;
    }
    return (
      constantTimeEqual(decoded.slice(0, separator), username) &&
      constantTimeEqual(decoded.slice(separator + 1), password)
    );
  } catch {
    return false;
  }
}

function constantTimeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maximumLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

function secureJson(payload, status, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function withSecurityHeaders(response, extraHeaders = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, ...extraHeaders })) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isHashedAsset(pathname) {
  return /^\/assets\/.+-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/.test(pathname);
}

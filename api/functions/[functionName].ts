import { createHash, timingSafeEqual } from 'node:crypto';

export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
};

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
const API_KEY_FIELDS = [
  'hostedAccessToken',
  'openaiApiKey',
  'claudeApiKey',
  'geminiApiKey',
  'groqApiKey',
  'openrouterApiKey',
];

interface ProviderFailure {
  ok: false;
  status: number;
  errorText: string;
}

interface VercelRequestLike {
  method?: string;
  query?: {
    functionName?: string | string[];
  };
  body?: unknown;
}

interface VercelResponseLike {
  status: (statusCode: number) => VercelResponseLike;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: () => void;
}

interface HostedServerModule {
  handleHostedFunctionRequest: (functionName: string, body: Record<string, unknown>) => Promise<unknown>;
  toProviderFailure: (error: unknown) => ProviderFailure | null;
}

type LoadHostedServer = () => Promise<HostedServerModule>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface VercelHandlerOptions {
  environment?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
}

export function createVercelHandler(
  loadServer: LoadHostedServer = defaultLoadServer,
  options: VercelHandlerOptions = {}
) {
  const environment = options.environment ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  return async function vercelHandler(req: VercelRequestLike, res: VercelResponseLike) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const functionName = resolveFunctionName(req.query?.functionName);
    if (!functionName || !KNOWN_AI_FUNCTIONS.has(functionName)) {
      res.status(404).json({ error: 'Not found.' });
      return;
    }

    try {
      const rawBody = normalizeBody(req.body);
      const claudeCliRequest = isClaudeCliRequest(rawBody);
      const authorizationError = authorizeHostedAiRequest(rawBody, environment, claudeCliRequest);
      if (authorizationError) {
        res.status(authorizationError.status).json({ error: authorizationError.error });
        return;
      }

      const body = stripBrowserSecrets(rawBody);
      if (claudeCliRequest) {
        await proxyClaudeCliRequest(functionName, body, res, environment, fetchImpl);
        return;
      }

      const serverModule = await loadServer();
      const result = await serverModule.handleHostedFunctionRequest(functionName, body);
      res.status(200).json(result);
    } catch (error) {
      const serverModule = await loadServer().catch(() => null);
      const providerError = serverModule?.toProviderFailure(error) ?? null;
      if (providerError) {
        res.status(providerError.status).json({ error: providerError.errorText });
        return;
      }

      console.error('[vercel-ai] request failed');
      res.status(500).json({ error: 'The AI service could not complete the request.' });
    }
  };
}

async function defaultLoadServer() {
  return await import('../../server-dist/generate-test-cases-server.js');
}

export default createVercelHandler();

function setCorsHeaders(res: VercelResponseLike) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type, accept');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function resolveFunctionName(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeBody(body: unknown): Record<string, unknown> {
  if (!body) {
    return {};
  }

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}

function stripBrowserSecrets(body: Record<string, unknown>) {
  if (!body.aiSettings || typeof body.aiSettings !== 'object' || Array.isArray(body.aiSettings)) {
    return body;
  }

  const cleanSettings = { ...(body.aiSettings as Record<string, unknown>) };
  for (const field of API_KEY_FIELDS) {
    delete cleanSettings[field];
  }

  return { ...body, aiSettings: cleanSettings };
}

function isClaudeCliRequest(body: Record<string, unknown>) {
  return Boolean(
    body.aiSettings &&
      typeof body.aiSettings === 'object' &&
      !Array.isArray(body.aiSettings) &&
      (body.aiSettings as Record<string, unknown>).provider === 'claude_cli'
  );
}

function authorizeHostedAiRequest(
  body: Record<string, unknown>,
  environment: Record<string, string | undefined>,
  claudeCliRequest: boolean
): { status: number; error: string } | null {
  const configuredToken = (environment.HOSTED_AI_ACCESS_TOKEN || '').trim();
  if (!configuredToken) {
    return claudeCliRequest
      ? {
          status: 503,
          error:
            'Hosted AI access is not configured for Claude Subscription. Set HOSTED_AI_ACCESS_TOKEN and redeploy.',
        }
      : null;
  }

  const settings =
    body.aiSettings && typeof body.aiSettings === 'object' && !Array.isArray(body.aiSettings)
      ? body.aiSettings as Record<string, unknown>
      : {};
  const suppliedToken =
    typeof settings.hostedAccessToken === 'string' ? settings.hostedAccessToken.trim() : '';

  if (constantTimeEqual(suppliedToken, configuredToken)) {
    return null;
  }

  return {
    status: 401,
    error: suppliedToken
      ? 'Hosted AI access token does not match this deployment. Open AI Settings and re-paste the exact HOSTED_AI_ACCESS_TOKEN value configured on Vercel.'
      : 'Hosted AI access token is missing. Open AI Settings, paste the HOSTED_AI_ACCESS_TOKEN value configured on Vercel into "Hosted AI access token", and save.',
  };
}

function constantTimeEqual(left: string, right: string) {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

async function proxyClaudeCliRequest(
  functionName: string,
  body: Record<string, unknown>,
  res: VercelResponseLike,
  environment: Record<string, string | undefined>,
  fetchImpl: FetchLike
) {
  const lambdaUrl = (
    environment.CLAUDE_CLI_LAMBDA_URL ||
    environment.LAMBDA_FUNCTION_URL ||
    ''
  ).trim();
  const proxyToken = (environment.LAMBDA_PROXY_TOKEN || '').trim();

  if (!lambdaUrl || !proxyToken) {
    res.status(503).json({
      error:
        'Claude Subscription is not configured for this deployment. Configure the protected Claude CLI backend and redeploy.',
    });
    return;
  }

  let upstreamResponse: Response;
  try {
    const targetUrl = `${lambdaUrl.replace(/\/+$/, '')}/api/functions/${encodeURIComponent(functionName)}`;
    upstreamResponse = await fetchImpl(targetUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Testcase-Proxy-Token': proxyToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(285_000),
    });
  } catch {
    res.status(502).json({ error: 'The Claude Subscription service is temporarily unavailable.' });
    return;
  }

  const { status, payload } = await readUpstreamPayload(upstreamResponse);
  if (status >= 200 && status < 300) {
    res.status(status).json(payload);
    return;
  }

  const errorText =
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>).error === 'string'
      ? String((payload as Record<string, unknown>).error).slice(0, 800)
      : 'The Claude Subscription service could not complete the request.';
  res.status(status).json({ error: errorText });
}

async function readUpstreamPayload(
  response: Response
): Promise<{ status: number; payload: unknown }> {
  const text = await response.text();
  if (!text.trim()) {
    return { status: response.status, payload: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      status: response.ok ? 502 : response.status,
      payload: response.ok
        ? { error: 'The Claude Subscription service returned an invalid response.' }
        : {},
    };
  }

  return unwrapStreamStatus(parsed, response.status);
}

// The streaming Lambda commits `200` headers before it knows the outcome, so a late
// failure arrives as a 200 carrying the true status in the body. Contract is defined in
// cloud/aws/lambda-handler.mjs (STREAM_STATUS_FIELD).
function unwrapStreamStatus(payload: unknown, fallbackStatus: number) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { status: fallbackStatus, payload };
  }

  const { __upstreamStatus: smuggledStatus, ...rest } = payload as Record<string, unknown>;
  if (typeof smuggledStatus !== 'number' || !Number.isInteger(smuggledStatus)) {
    return { status: fallbackStatus, payload };
  }
  if (smuggledStatus < 400 || smuggledStatus > 599) {
    return { status: fallbackStatus, payload: rest };
  }

  return { status: smuggledStatus, payload: rest };
}

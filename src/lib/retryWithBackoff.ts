import { getStoredAiRequestSettings } from '@/lib/aiSettings';
import { getProviderRetryAfterMs, isRetryableAiErrorMessage } from '@/lib/providerErrors';

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
}

interface FunctionStreamEvent {
  stage?: string;
  message?: string;
  error?: string;
  cached?: boolean;
  testCases?: unknown[];
  [key: string]: unknown;
}

interface StreamOptions extends RetryOptions {
  onStage?: (event: FunctionStreamEvent) => void;
}

interface DirectFunctionTarget {
  url: string;
  requiresSupabaseAuth: boolean;
  acceptsHostedAccessToken: boolean;
}

const LOCAL_AI_SERVER_FUNCTIONS = new Set([
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

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isLocalSupabaseTarget() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return false;

  try {
    return isLocalHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

function shouldAutoAttachLocalAiSettings() {
  if (typeof window === 'undefined') {
    return false;
  }

  return isLocalHostname(window.location.hostname) && isLocalSupabaseTarget();
}

function getLocalAiServerTarget(functionName: string): DirectFunctionTarget | null {
  if (typeof window === 'undefined' || !isLocalHostname(window.location.hostname)) {
    return null;
  }

  if (!LOCAL_AI_SERVER_FUNCTIONS.has(functionName)) {
    return null;
  }

  const hostedAiBaseUrl = import.meta.env.VITE_HOSTED_AI_API_BASE_URL;
  if (hostedAiBaseUrl) {
    try {
      return {
        url: new URL(`/api/functions/${functionName}`, hostedAiBaseUrl).toString(),
        requiresSupabaseAuth: false,
        acceptsHostedAccessToken: true,
      };
    } catch {
      return null;
    }
  }

  const baseUrl = import.meta.env.VITE_LOCAL_AI_SERVER_URL || 'http://127.0.0.1:8787';
  if (!baseUrl) {
    return null;
  }

  try {
    return {
      url: new URL(`/functions/v1/${functionName}`, baseUrl).toString(),
      requiresSupabaseAuth: false,
      acceptsHostedAccessToken: false,
    };
  } catch {
    return null;
  }
}

function getHostedAiServerTarget(functionName: string): DirectFunctionTarget | null {
  if (typeof window === 'undefined' || isLocalHostname(window.location.hostname)) {
    return null;
  }

  if (!LOCAL_AI_SERVER_FUNCTIONS.has(functionName)) {
    return null;
  }

  if (import.meta.env.VITE_USE_VERCEL_AI_API === 'false') {
    return null;
  }

  return {
    url: `/api/functions/${functionName}`,
    requiresSupabaseAuth: false,
    acceptsHostedAccessToken: true,
  };
}

function buildRequestBody(functionName: string, body: Record<string, unknown>) {
  if (typeof body.aiSettings !== 'undefined') {
    return { ...body };
  }

  if (typeof window === 'undefined') {
    return { ...body };
  }

  return {
    ...body,
    aiSettings: getStoredAiRequestSettings({
      includeSecrets: shouldAutoAttachLocalAiSettings(),
      includeHostedAccessToken:
        getDirectFunctionTarget(functionName)?.acceptsHostedAccessToken === true,
    }),
  };
}

function getDirectFunctionTarget(functionName: string): DirectFunctionTarget | null {
  const localAiServerTarget = getLocalAiServerTarget(functionName);
  if (localAiServerTarget) {
    return localAiServerTarget;
  }

  const hostedAiServerTarget = getHostedAiServerTarget(functionName);
  if (hostedAiServerTarget) {
    return hostedAiServerTarget;
  }

  if (import.meta.env.DEV) {
    return {
      url: `/api/functions/${functionName}`,
      requiresSupabaseAuth: false,
      acceptsHostedAccessToken: false,
    };
  }

  if (!isLocalSupabaseTarget()) {
    return null;
  }

  return {
    url: new URL(`/functions/v1/${functionName}`, import.meta.env.VITE_SUPABASE_URL).toString(),
    requiresSupabaseAuth: true,
    acceptsHostedAccessToken: false,
  };
}

function getDirectFunctionUrl(functionName: string) {
  return getDirectFunctionTarget(functionName)?.url ?? null;
}

function getDirectFunctionHeaders(functionName: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const target = getDirectFunctionTarget(functionName);
  if (target?.requiresSupabaseAuth) {
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (publishableKey) {
      headers.apikey = publishableKey;
      headers.Authorization = `Bearer ${publishableKey}`;
    }
  }

  return headers;
}

// The streaming Lambda commits `200` headers before the provider outcome is known, so a
// late failure arrives as a 200 carrying its real status in the body. The Vercel route
// unwraps this server-side, but the Cloudflare worker streams the body through untouched,
// so the browser has to understand it too. Contract: cloud/aws/lambda-handler.mjs.
const STREAM_STATUS_FIELD = '__upstreamStatus';

function unwrapStreamStatus(payload: unknown, fallbackStatus: number) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { status: fallbackStatus, payload };
  }

  const { [STREAM_STATUS_FIELD]: smuggledStatus, ...rest } = payload as Record<string, unknown>;
  if (typeof smuggledStatus !== 'number' || !Number.isInteger(smuggledStatus)) {
    return { status: fallbackStatus, payload };
  }
  if (smuggledStatus < 400 || smuggledStatus > 599) {
    return { status: fallbackStatus, payload: rest };
  }

  return { status: smuggledStatus, payload: rest };
}

async function readFunctionResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  const raw = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return unwrapStreamStatus(raw, response.status);
}

function readErrorMessage(payload: unknown, status: number) {
  return typeof payload === 'object' && payload && 'error' in payload
    ? String((payload as { error?: unknown }).error)
    : `Function request failed with status ${status}`;
}

async function parseFunctionError(response: Response) {
  const { status, payload } = await readFunctionResponse(response);
  return readErrorMessage(payload, status);
}

async function invokeViaDirectFetch(
  functionName: string,
  body: Record<string, unknown>
) {
  const directUrl = getDirectFunctionUrl(functionName);

  if (!directUrl) {
    throw new Error('Direct function fetch is only available for local environments.');
  }

  const response = await fetch(directUrl, {
    method: 'POST',
    headers: getDirectFunctionHeaders(functionName),
    body: JSON.stringify(body),
  });

  const { status, payload: data } = await readFunctionResponse(response);

  if (status >= 400) {
    const functionError = new Error(readErrorMessage(data, status)) as Error & { status?: number };
    functionError.status = status;
    return {
      data: null,
      error: functionError,
    };
  }

  return {
    data,
    error: null,
  };
}

async function readEventStream(
  response: Response,
  onStage?: (event: FunctionStreamEvent) => void
) {
  if (!response.body) {
    throw new Error('Generation stream is unavailable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload: FunctionStreamEvent | null = null;

  const emitPayload = (rawEvent: string) => {
    const dataLines = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      return;
    }

    const payload = JSON.parse(dataLines.join('\n')) as FunctionStreamEvent;
    onStage?.(payload);

    if (payload.stage === 'error') {
      throw new Error(typeof payload.error === 'string' ? payload.error : 'Function stream failed.');
    }

    if (payload.stage === 'complete') {
      finalPayload = payload;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, '\n');

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const eventChunk = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 2);
      if (eventChunk) {
        emitPayload(eventChunk);
      }
      separatorIndex = buffer.indexOf('\n\n');
    }

    if (done) {
      break;
    }
  }

  const remaining = buffer.trim();
  if (remaining) {
    emitPayload(remaining);
  }

  if (!finalPayload) {
    throw new Error('Generation finished without a completion event.');
  }

  return finalPayload;
}

export async function invokeWithStageStream(
  functionName: string,
  body: Record<string, unknown>,
  options: StreamOptions = {}
) {
  const requestBody = {
    ...buildRequestBody(functionName, body),
    stream: true,
  };
  const directUrl = getDirectFunctionUrl(functionName);

  if (!directUrl) {
    return invokeWithRetry(functionName, body, options);
  }

  let sawStageEvent = false;

  try {
    const response = await fetch(directUrl, {
      method: 'POST',
      headers: {
        ...getDirectFunctionHeaders(functionName),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      const { status, payload } = await readFunctionResponse(response);
      if (status >= 400) {
        throw new Error(readErrorMessage(payload, status));
      }
      return payload;
    }

    if (!response.ok) {
      throw new Error(await parseFunctionError(response));
    }

    return await readEventStream(response, (event) => {
      sawStageEvent = true;
      options.onStage?.(event);
    });
  } catch (error) {
    if (!sawStageEvent) {
      return invokeWithRetry(functionName, body, options);
    }

    throw error;
  }
}

export async function invokeWithRetry(
  functionName: string,
  body: Record<string, unknown>,
  options: RetryOptions = {}
) {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 10000 } = options;
  const requestBody = buildRequestBody(functionName, body);
  const directTarget = getDirectFunctionTarget(functionName);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = directTarget
      ? await invokeViaDirectFetch(functionName, requestBody)
      : await invokeViaSupabase(functionName, requestBody);

    if (!error && !data?.error) {
      return data;
    }

    // Don't retry on non-retryable errors
    const errorMsg = error?.message || data?.error || '';
    const status =
      typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
        ? error.status
        : undefined;
    const isRetryable = isRetryableAiErrorMessage(errorMsg, status);

    if (!isRetryable || attempt === maxRetries) {
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    }

    const providerRetryAfterMs = getProviderRetryAfterMs(errorMsg);
    const delay = providerRetryAfterMs !== null
      ? Math.min(providerRetryAfterMs + 750, 120_000)
      : Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 500, maxDelay);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  throw new Error('Max retries exceeded');
}

async function invokeViaSupabase(functionName: string, requestBody: Record<string, unknown>) {
  if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    return {
      data: null,
      error: new Error(
        'No hosted AI route or Supabase function configuration is available for this deployment.'
      ),
    };
  }

  const { supabase } = await import('@/integrations/supabase/client');
  return await supabase.functions.invoke(functionName, { body: requestBody });
}

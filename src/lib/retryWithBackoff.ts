import { supabase } from '@/integrations/supabase/client';
import { getStoredAiRequestSettings } from '@/lib/aiSettings';
import { isRetryableAiErrorMessage } from '@/lib/providerErrors';

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

  const baseUrl = import.meta.env.VITE_LOCAL_AI_SERVER_URL || 'http://127.0.0.1:8787';
  if (!baseUrl) {
    return null;
  }

  try {
    return {
      url: new URL(`/functions/v1/${functionName}`, baseUrl).toString(),
      requiresSupabaseAuth: false,
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
  };
}

function buildRequestBody(body: Record<string, unknown>) {
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
    };
  }

  if (!isLocalSupabaseTarget()) {
    return null;
  }

  return {
    url: new URL(`/functions/v1/${functionName}`, import.meta.env.VITE_SUPABASE_URL).toString(),
    requiresSupabaseAuth: true,
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

async function parseFunctionError(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return typeof payload === 'object' && payload && 'error' in payload
    ? String((payload as { error?: unknown }).error)
    : `Function request failed with status ${response.status}`;
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

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const errorMessage =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error?: unknown }).error)
        : `Function request failed with status ${response.status}`;

    return {
      data: null,
      error: new Error(errorMessage),
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
    ...buildRequestBody(body),
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

    if (!response.ok) {
      throw new Error(await parseFunctionError(response));
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      return contentType.includes('application/json') ? await response.json() : await response.text();
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
  const requestBody = buildRequestBody(body);
  const directTarget = getDirectFunctionTarget(functionName);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = directTarget
      ? await invokeViaDirectFetch(functionName, requestBody)
      : await supabase.functions.invoke(functionName, { body: requestBody });

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

    const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 500, maxDelay);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  throw new Error('Max retries exceeded');
}

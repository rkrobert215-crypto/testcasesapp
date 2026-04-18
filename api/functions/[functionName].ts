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

export default async function handler(req: VercelRequestLike, res: VercelResponseLike) {
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

  let toProviderFailure:
    | ((error: unknown) => ProviderFailure | null)
    | null = null;

  try {
    const serverModule = await import('../../server/generate-test-cases-server.ts');
    toProviderFailure = serverModule.toProviderFailure;

    const body = normalizeBody(req.body);
    const result = await serverModule.handleHostedFunctionRequest(functionName, body);
    res.status(200).json(result);
  } catch (error) {
    const providerError = toProviderFailure?.(error) ?? null;
    if (providerError) {
      res.status(providerError.status).json({ error: providerError.errorText });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;

    res.status(500).json({
      error: message,
      ...(stack ? { stack } : {}),
    });
  }
}

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

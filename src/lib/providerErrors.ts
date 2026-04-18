export interface AiErrorPresentation {
  title: string;
  description: string;
  retryable: boolean;
}

function normalizeErrorMessage(error: unknown, fallbackMessage: string) {
  const raw = error instanceof Error ? error.message : String(error ?? fallbackMessage);
  return raw.replace(/\s+/g, ' ').trim();
}

export function isRetryableAiErrorMessage(message: string, status?: number) {
  const lower = message.toLowerCase();
  const retryableSignals = [
    'high demand',
    'please try again later',
    'please retry in',
    'temporarily unavailable',
    'rate limit',
    'timeout',
    'timed out',
    'fetch failed',
    'network request failed',
    'upstream connect error',
  ];

  return status === 429 || (typeof status === 'number' && status >= 500) || retryableSignals.some((signal) => lower.includes(signal));
}

export function describeAiError(
  error: unknown,
  fallbackTitle: string,
  fallbackDescription: string
): AiErrorPresentation {
  const message = normalizeErrorMessage(error, fallbackDescription);
  const lower = message.toLowerCase();

  if (
    lower.includes('api key is not configured') ||
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key') ||
    lower.includes('unauthorized') ||
    lower.includes('401')
  ) {
    return {
      title: 'API key issue',
      description: 'The selected provider key is missing or was rejected. Check AI Settings or your local env file and try again.',
      retryable: false,
    };
  }

  if (
    lower.includes('quota exceeded') ||
    lower.includes('insufficient_quota') ||
    lower.includes('free tier') ||
    lower.includes('credit') ||
    lower.includes('billing') ||
    lower.includes('resource has been exhausted')
  ) {
    return {
      title: 'Provider quota reached',
      description: 'The selected provider or project has no usable quota right now. Retry later, switch models, or use another provider.',
      retryable: false,
    };
  }

  if (
    lower.includes('high demand') ||
    lower.includes('please try again later') ||
    lower.includes('temporarily unavailable')
  ) {
    return {
      title: 'Provider is busy',
      description: 'The selected model is under heavy demand right now. Retry in a bit or switch to another model/provider.',
      retryable: true,
    };
  }

  if (lower.includes('rate limit') || lower.includes('429')) {
    return {
      title: 'Rate limit reached',
      description: 'The provider throttled this request. Wait a moment and retry, or switch to a less busy model.',
      retryable: true,
    };
  }

  if (lower.includes('timed out') || lower.includes('timeout')) {
    return {
      title: 'Request timed out',
      description: 'The AI request took too long to finish. Retry once, or switch to a faster/more reliable model if it keeps happening.',
      retryable: true,
    };
  }

  if (lower.includes('failed to call a function') || lower.includes('failed_generation') || lower.includes('no structured data')) {
    return {
      title: 'Model output issue',
      description: 'The selected model could not return the structured testcase payload reliably. Try a stronger model/provider for this flow.',
      retryable: false,
    };
  }

  if (
    lower.includes('could not reach the local generate server') ||
    lower.includes('failed to fetch') ||
    lower.includes('network request failed') ||
    lower.includes('load failed')
  ) {
    return {
      title: 'Local service unavailable',
      description: 'The local AI server is not reachable. Start or restart the local stack, then try again.',
      retryable: true,
    };
  }

  return {
    title: fallbackTitle,
    description: message || fallbackDescription,
    retryable: false,
  };
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;
const REQUEST_CACHE_VERSION = '2026-04-08-v7';
const cache = new Map<string, { data: unknown; timestamp: number }>();

export async function computeRequestCacheKey(
  featureName: string,
  aiSettings: unknown,
  payload: unknown
): Promise<string> {
  const rawSettings = aiSettings && typeof aiSettings === 'object' ? (aiSettings as Record<string, unknown>) : {};
  const provider = typeof rawSettings.provider === 'string' ? rawSettings.provider : 'gemini';
  const openaiModel = typeof rawSettings.openaiModel === 'string' ? rawSettings.openaiModel : '';
  const claudeModel = typeof rawSettings.claudeModel === 'string' ? rawSettings.claudeModel : '';
  const geminiModel = typeof rawSettings.geminiModel === 'string' ? rawSettings.geminiModel : '';
  const openrouterModel = typeof rawSettings.openrouterModel === 'string' ? rawSettings.openrouterModel : '';
  const strictRequirementMode = rawSettings.strictRequirementMode === true ? 'strict' : 'normal';
  const generationMode =
    rawSettings.generationMode === 'professional_standard'
      ? 'professional_standard'
      : rawSettings.generationMode === 'swag_style'
        ? 'swag_style'
      : rawSettings.generationMode === 'yuv_style'
        ? 'yuv_style'
        : rawSettings.generationMode === 'rob_style' || rawSettings.generationMode === 'my_style'
          ? 'rob_style'
          : 'rob_style';
  const raw = `${REQUEST_CACHE_VERSION}::${featureName}::${provider}::${openaiModel}::${claudeModel}::${geminiModel}::${openrouterModel}::${generationMode}::${strictRequirementMode}::${stableStringify(payload)}`;
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getCachedRequest<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCachedRequest(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, timestamp: Date.now() });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);

  return `{${entries.join(',')}}`;
}

export type AiProvider = 'openai' | 'claude' | 'gemini' | 'groq' | 'openrouter';
export type GenerationMode = 'rob_style' | 'yuv_style' | 'swag_style' | 'professional_standard';
export type OpenAiModel = 'gpt-5.4' | 'gpt-5.4-mini';
export type ClaudeModel = 'claude-sonnet-4-20250514' | 'claude-opus-4-1-20250805';
export type OpenRouterModel = string;

export type GeminiModel =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-3-flash-preview';

export interface AiSettings {
  provider: AiProvider;
  generationMode: GenerationMode;
  strictRequirementMode: boolean;
  openaiApiKey: string;
  claudeApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  openrouterApiKey: string;
  openaiModel: OpenAiModel;
  claudeModel: ClaudeModel;
  geminiModel: GeminiModel;
  openrouterModel: OpenRouterModel;
}

export interface ProviderOption {
  value: AiProvider;
  label: string;
  description: string;
}

export interface GeminiModelOption {
  value: GeminiModel;
  label: string;
  description: string;
}

export interface OpenAiModelOption {
  value: OpenAiModel;
  label: string;
  description: string;
}

export interface ClaudeModelOption {
  value: ClaudeModel;
  label: string;
  description: string;
}

export interface OpenRouterModelOption {
  value: OpenRouterModel;
  label: string;
  description: string;
}

export interface GenerationModeOption {
  value: GenerationMode;
  label: string;
  description: string;
}

export interface AiSettingsLoadResult {
  settings: AiSettings;
  migrationNotices: string[];
}

export interface RequestAiSettings {
  provider: AiProvider;
  generationMode: GenerationMode;
  strictRequirementMode: boolean;
  openaiModel: OpenAiModel;
  claudeModel: ClaudeModel;
  geminiModel: GeminiModel;
  openrouterModel: OpenRouterModel;
  openaiApiKey?: string;
  claudeApiKey?: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  openrouterApiKey?: string;
}

export const AI_SETTINGS_STORAGE_KEY = 'testcase-generator-ai-settings';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'gemini',
  generationMode: 'rob_style',
  strictRequirementMode: false,
  openaiApiKey: '',
  claudeApiKey: '',
  geminiApiKey: '',
  groqApiKey: '',
  openrouterApiKey: '',
  openaiModel: 'gpt-5.4',
  claudeModel: 'claude-sonnet-4-20250514',
  geminiModel: 'gemini-2.5-pro',
  openrouterModel: 'openrouter/auto',
};

export const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    description: 'Uses your OpenAI API key with a selectable GPT-5.4 model.',
  },
  {
    value: 'claude',
    label: 'Claude',
    description: 'Uses your Anthropic API key with Claude 4 models. Best overall fit for this app.',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    description: 'Uses your Google AI API key with a selectable Gemini model. Best free and default option for this app.',
  },
  {
    value: 'groq',
    label: 'Groq',
    description: 'Uses your Groq API key with Llama 4 Scout. Fast, but less reliable for strict structured testcase generation than Claude/OpenAI/OpenRouter.',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    description: 'Uses one OpenRouter API key to access many providers through an OpenAI-compatible gateway.',
  },
];

export const OPENAI_MODEL_OPTIONS: OpenAiModelOption[] = [
  {
    value: 'gpt-5.4',
    label: 'GPT-5.4',
    description: 'Best OpenAI quality for complex professional QA work and richer reasoning.',
  },
  {
    value: 'gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    description: 'Best-value OpenAI option when you want strong quality at a lower cost.',
  },
];

export const CLAUDE_MODEL_OPTIONS: ClaudeModelOption[] = [
  {
    value: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    description: 'Recommended overall for this app: strong reasoning, clean writing, and balanced cost.',
  },
  {
    value: 'claude-opus-4-1-20250805',
    label: 'Claude Opus 4.1',
    description: 'Highest-end Claude option for maximum reasoning quality at a higher cost.',
  },
];

export const OPENROUTER_MODEL_OPTIONS: OpenRouterModelOption[] = [
  {
    value: 'openrouter/auto',
    label: 'OpenRouter Auto Router',
    description: 'Recommended. Lets OpenRouter choose a stronger compatible model automatically for structured requests.',
  },
  {
    value: 'openrouter/free',
    label: 'OpenRouter Free Router',
    description: 'Free router. Less reliable for strict structured testcase generation because the selected model can vary.',
  },
];

export const GEMINI_MODEL_OPTIONS: GeminiModelOption[] = [
  {
    value: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Fastest general-purpose option for day-to-day generation.',
  },
  {
    value: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Best for the heaviest reasoning and large, complex requirements.',
  },
  {
    value: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    description: 'Newest Flash-family preview option for fast multimodal generation.',
  },
];

export const GENERATION_MODE_OPTIONS: GenerationModeOption[] = [
  {
    value: 'rob_style',
    label: 'Rob',
    description: 'Clean permission-aware QA wording with strong "Verify that the user..." titles and crisp expected results.',
  },
  {
    value: 'yuv_style',
    label: 'Yuv',
    description: 'Broader module/page-focused QA coverage with stronger UI, navigation, sorting, and edge-case coverage.',
  },
  {
    value: 'swag_style',
    label: 'SWAG',
    description: 'Benchmark-driven modern web-app coverage for forms, grids, uploads, exports, settings, auth, persistence, and UI behavior.',
  },
  {
    value: 'professional_standard',
    label: 'Professional Standard',
    description: 'Pushes stricter enterprise traceability, stronger reviewer checks, and a more formal QA tone.',
  },
];

export const PROVIDER_MODEL_LABELS: Record<AiProvider, string> = {
  openai: 'Selectable GPT-5.4 model',
  claude: 'Selectable Claude 4 model',
  gemini: 'Selectable Gemini model',
  groq: 'meta-llama/llama-4-scout-17b-16e-instruct',
  openrouter: 'Selectable OpenRouter router or custom model slug',
};

export function normalizeAiSettings(value: unknown): AiSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<AiSettings> & { provider?: string }) : {};
  const normalizedOpenAiModel = raw.openaiModel === 'gpt-4.1-mini' ? 'gpt-5.4-mini' : raw.openaiModel;
  const normalizedGeminiModel =
    raw.geminiModel === 'gemini-3.1-flash-lite-preview' ? 'gemini-3-flash-preview' : raw.geminiModel;
  const normalizedGenerationMode = raw.generationMode === 'my_style' ? 'rob_style' : raw.generationMode;

  return {
    provider: isProvider(raw.provider) ? raw.provider : DEFAULT_AI_SETTINGS.provider,
    generationMode: isGenerationMode(normalizedGenerationMode) ? normalizedGenerationMode : DEFAULT_AI_SETTINGS.generationMode,
    strictRequirementMode:
      typeof raw.strictRequirementMode === 'boolean'
        ? raw.strictRequirementMode
        : DEFAULT_AI_SETTINGS.strictRequirementMode,
    openaiApiKey: typeof raw.openaiApiKey === 'string' ? raw.openaiApiKey : DEFAULT_AI_SETTINGS.openaiApiKey,
    claudeApiKey: typeof raw.claudeApiKey === 'string' ? raw.claudeApiKey : DEFAULT_AI_SETTINGS.claudeApiKey,
    geminiApiKey: typeof raw.geminiApiKey === 'string' ? raw.geminiApiKey : DEFAULT_AI_SETTINGS.geminiApiKey,
    groqApiKey: typeof raw.groqApiKey === 'string' ? raw.groqApiKey : DEFAULT_AI_SETTINGS.groqApiKey,
    openrouterApiKey: typeof raw.openrouterApiKey === 'string' ? raw.openrouterApiKey : DEFAULT_AI_SETTINGS.openrouterApiKey,
    openaiModel: isOpenAiModel(normalizedOpenAiModel) ? normalizedOpenAiModel : DEFAULT_AI_SETTINGS.openaiModel,
    claudeModel: isClaudeModel(raw.claudeModel) ? raw.claudeModel : DEFAULT_AI_SETTINGS.claudeModel,
    geminiModel: isGeminiModel(normalizedGeminiModel) ? normalizedGeminiModel : DEFAULT_AI_SETTINGS.geminiModel,
    openrouterModel: normalizeOpenRouterModel(raw.openrouterModel),
  };
}

export function getStoredAiSettings(): AiSettings {
  return loadStoredAiSettings().settings;
}

export function serializeAiSettingsForRequest(
  settings: AiSettings,
  options: { includeSecrets?: boolean } = {}
): RequestAiSettings {
  const requestSettings: RequestAiSettings = {
    provider: settings.provider,
    generationMode: settings.generationMode,
    strictRequirementMode: settings.strictRequirementMode,
    openaiModel: settings.openaiModel,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
    openrouterModel: settings.openrouterModel,
  };

  if (!options.includeSecrets) {
    return requestSettings;
  }

  return {
    ...requestSettings,
    openaiApiKey: settings.openaiApiKey,
    claudeApiKey: settings.claudeApiKey,
    geminiApiKey: settings.geminiApiKey,
    groqApiKey: settings.groqApiKey,
    openrouterApiKey: settings.openrouterApiKey,
  };
}

export function getStoredAiRequestSettings(options: { includeSecrets?: boolean } = {}) {
  return serializeAiSettingsForRequest(getStoredAiSettings(), options);
}

export function loadStoredAiSettings(): AiSettingsLoadResult {
  if (typeof window === 'undefined') {
    return {
      settings: DEFAULT_AI_SETTINGS,
      migrationNotices: [],
    };
  }

  const stored = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
  if (!stored) {
    return {
      settings: DEFAULT_AI_SETTINGS,
      migrationNotices: [],
    };
  }

  try {
    const parsed = JSON.parse(stored);
    const migrationNotices = getAiSettingsMigrationNotices(parsed);
    const normalized = normalizeAiSettings(parsed);

    if (migrationNotices.length > 0) {
      persistAiSettings(normalized);
    }

    return {
      settings: normalized,
      migrationNotices,
    };
  } catch {
    return {
      settings: DEFAULT_AI_SETTINGS,
      migrationNotices: [],
    };
  }
}

export function persistAiSettings(settings: AiSettings) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function isProvider(value: unknown): value is AiProvider {
  return value === 'openai' || value === 'claude' || value === 'gemini' || value === 'groq' || value === 'openrouter';
}

function isGenerationMode(value: unknown): value is GenerationMode {
  return value === 'rob_style' || value === 'yuv_style' || value === 'swag_style' || value === 'professional_standard';
}

function getAiSettingsMigrationNotices(value: unknown): string[] {
  const raw = value && typeof value === 'object' ? (value as Partial<AiSettings>) : {};
  const notices: string[] = [];

  if (raw.openaiModel === 'gpt-4.1-mini') {
    notices.push('Your saved OpenAI model "gpt-4.1-mini" was upgraded to "gpt-5.4-mini". Review AI Settings if you want a different OpenAI model.');
  }

  if (raw.geminiModel === 'gemini-3.1-flash-lite-preview') {
    notices.push('Your saved Gemini model "gemini-3.1-flash-lite-preview" was replaced with "gemini-3-flash-preview".');
  }

  if (raw.generationMode === 'my_style') {
    notices.push('Your saved generation style "My Style" was split into "Rob" and "Yuv". It was migrated to "Rob" as the closest match for your existing testcase wording.');
  }

  return notices;
}

function isOpenAiModel(value: unknown): value is OpenAiModel {
  return value === 'gpt-5.4' || value === 'gpt-5.4-mini';
}

function isClaudeModel(value: unknown): value is ClaudeModel {
  return value === 'claude-sonnet-4-20250514' || value === 'claude-opus-4-1-20250805';
}

function isGeminiModel(value: unknown): value is GeminiModel {
  return (
    value === 'gemini-2.5-flash' ||
    value === 'gemini-2.5-pro' ||
    value === 'gemini-3-flash-preview'
  );
}

function normalizeOpenRouterModel(value: unknown): OpenRouterModel {
  if (typeof value !== 'string') {
    return DEFAULT_AI_SETTINGS.openrouterModel;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_AI_SETTINGS.openrouterModel;
}

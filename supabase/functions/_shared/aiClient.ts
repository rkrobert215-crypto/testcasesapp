type AiProvider = 'openai' | 'claude' | 'gemini' | 'groq' | 'openrouter';
type OpenAiModel = 'gpt-5.4' | 'gpt-5.4-mini';
type ClaudeModel = 'claude-sonnet-4-20250514' | 'claude-opus-4-1-20250805';
type GeminiModel = 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'gemini-3-flash-preview';
type OpenRouterModel = string;

type JsonSchema = Record<string, unknown>;

interface AiSettings {
  provider: AiProvider;
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

interface StructuredOutputDefinition {
  name: string;
  description: string;
  schema: JsonSchema;
}

type AiPromptPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      dataUrl: string;
    };

interface StructuredGenerationOptions {
  aiSettings: unknown;
  systemPrompt: string;
  userParts: AiPromptPart[];
  output: StructuredOutputDefinition;
  featureName: string;
}

const DEFAULT_SETTINGS: AiSettings = {
  provider: 'gemini',
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

const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const PROVIDER_SECRET_ENV_NAMES: Record<AiProvider, string[]> = {
  openai: ['OPENAI_API_KEY'],
  claude: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
};

class StructuredOutputParseError extends Error {
  rawText?: string;

  constructor(message: string, rawText?: string) {
    super(message);
    this.name = 'StructuredOutputParseError';
    this.rawText = rawText;
  }
}

export async function generateStructuredData<T>({
  aiSettings,
  systemPrompt,
  userParts,
  output,
  featureName,
}: StructuredGenerationOptions): Promise<T> {
  const normalizedSettings = normalizeAiSettings(aiSettings);

  try {
    return await callProvider<T>({
      provider: normalizedSettings.provider,
      settings: normalizedSettings,
      systemPrompt,
      userParts,
      output,
    });
  } catch (error) {
    if (isStructuredOutputParseError(error)) {
      try {
        return await callProvider<T>({
          provider: normalizedSettings.provider,
          settings: normalizedSettings,
          systemPrompt: buildRepairSystemPrompt(systemPrompt, output),
          userParts: buildRepairUserParts(userParts, error),
          output,
        });
      } catch (retryError) {
        const providerError = toError(retryError);
        console.error(`[${featureName}] ${normalizedSettings.provider} provider failed after JSON repair retry:`, providerError.message);
        throw providerError;
      }
    }

    const providerError = toError(error);
    console.error(`[${featureName}] ${normalizedSettings.provider} provider failed:`, providerError.message);
    throw providerError;
  }
}

function normalizeAiSettings(value: unknown): AiSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<AiSettings> & { provider?: string }) : {};
  const normalizedOpenAiModel = raw.openaiModel === 'gpt-4.1-mini' ? 'gpt-5.4-mini' : raw.openaiModel;

  return {
    provider: isProvider(raw.provider) ? raw.provider : DEFAULT_SETTINGS.provider,
    openaiApiKey: typeof raw.openaiApiKey === 'string' ? raw.openaiApiKey : DEFAULT_SETTINGS.openaiApiKey,
    claudeApiKey: typeof raw.claudeApiKey === 'string' ? raw.claudeApiKey : DEFAULT_SETTINGS.claudeApiKey,
    geminiApiKey: typeof raw.geminiApiKey === 'string' ? raw.geminiApiKey : DEFAULT_SETTINGS.geminiApiKey,
    groqApiKey: typeof raw.groqApiKey === 'string' ? raw.groqApiKey : DEFAULT_SETTINGS.groqApiKey,
    openrouterApiKey: typeof raw.openrouterApiKey === 'string' ? raw.openrouterApiKey : DEFAULT_SETTINGS.openrouterApiKey,
    openaiModel: isOpenAiModel(normalizedOpenAiModel) ? normalizedOpenAiModel : DEFAULT_SETTINGS.openaiModel,
    claudeModel: isClaudeModel(raw.claudeModel) ? raw.claudeModel : DEFAULT_SETTINGS.claudeModel,
    geminiModel: isGeminiModel(raw.geminiModel) ? raw.geminiModel : DEFAULT_SETTINGS.geminiModel,
    openrouterModel: normalizeOpenRouterModel(raw.openrouterModel),
  };
}

async function callProvider<T>({
  provider,
  settings,
  systemPrompt,
  userParts,
  output,
}: {
  provider: AiProvider;
  settings: AiSettings;
  systemPrompt: string;
  userParts: AiPromptPart[];
  output: StructuredOutputDefinition;
}): Promise<T> {
  switch (provider) {
    case 'openai':
      return await callOpenAiCompatibleTool<T>({
        url: 'https://api.openai.com/v1/chat/completions',
        apiKey: resolveApiKey(settings.openaiApiKey, 'OpenAI', PROVIDER_SECRET_ENV_NAMES.openai),
        model: settings.openaiModel,
        systemPrompt,
        userParts,
        output,
      });
    case 'claude':
      return await callAnthropicTool<T>({
        apiKey: resolveApiKey(settings.claudeApiKey, 'Claude', PROVIDER_SECRET_ENV_NAMES.claude),
        model: settings.claudeModel,
        systemPrompt,
        userParts,
        output,
      });
    case 'gemini':
      return await callGeminiStructured<T>({
        apiKey: resolveApiKey(settings.geminiApiKey, 'Google Gemini', PROVIDER_SECRET_ENV_NAMES.gemini),
        model: settings.geminiModel,
        systemPrompt,
        userParts,
        output,
      });
    case 'groq':
      return await callOpenAiCompatibleTool<T>({
        url: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey: resolveApiKey(settings.groqApiKey, 'Groq', PROVIDER_SECRET_ENV_NAMES.groq),
        model: GROQ_MODEL,
        systemPrompt,
        userParts,
        output,
        providerLabel: 'Groq',
      });
    case 'openrouter':
      return await callOpenRouterWithFallback<T>({
        apiKey: resolveApiKey(settings.openrouterApiKey, 'OpenRouter', PROVIDER_SECRET_ENV_NAMES.openrouter),
        model: settings.openrouterModel,
        systemPrompt,
        userParts,
        output,
      });
    default:
      throw new Error('Unsupported AI provider.');
  }
}

async function callOpenRouterWithFallback<T>({
  apiKey,
  model,
  systemPrompt,
  userParts,
  output,
}: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userParts: AiPromptPart[];
  output: StructuredOutputDefinition;
}): Promise<T> {
  try {
    return await callOpenAiCompatibleTool<T>({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey,
      model,
      systemPrompt,
      userParts,
      output,
      providerLabel: 'OpenRouter',
      extraHeaders: getOpenRouterHeaders(),
    });
  } catch (error) {
    if (!shouldRetryOpenRouterWithAuto(model, error)) {
      throw error;
    }

    return await callOpenAiCompatibleTool<T>({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey,
      model: 'openrouter/auto',
      systemPrompt,
      userParts,
      output,
      providerLabel: 'OpenRouter',
      extraHeaders: getOpenRouterHeaders(),
    });
  }
}

async function callOpenAiCompatibleTool<T>({
  url,
  apiKey,
  model,
  systemPrompt,
  userParts,
  output,
  providerLabel = 'OpenAI-compatible AI provider',
  extraHeaders = {},
}: {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userParts: AiPromptPart[];
  output: StructuredOutputDefinition;
  providerLabel?: string;
  extraHeaders?: Record<string, string>;
}): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: toOpenAiContent(userParts) },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: output.name,
            description: output.description,
            parameters: output.schema,
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: output.name },
      },
    }),
  });

  const data = await readJsonResponse(response, providerLabel);
  const toolArguments = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;

  if (toolArguments) {
    return safeJsonParse<T>(toolArguments, 'OpenAI-compatible tool arguments');
  }

  const messageContent = readOpenAiMessageContent(data?.choices?.[0]?.message?.content);
  return parseJsonText<T>(messageContent);
}

async function callAnthropicTool<T>({
  apiKey,
  model,
  systemPrompt,
  userParts,
  output,
}: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userParts: AiPromptPart[];
  output: StructuredOutputDefinition;
}): Promise<T> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: toAnthropicContent(userParts),
        },
      ],
      tools: [
        {
          name: output.name,
          description: output.description,
          input_schema: output.schema,
        },
      ],
      tool_choice: {
        type: 'tool',
        name: output.name,
      },
    }),
  });

  const data = await readJsonResponse(response, 'Anthropic');
  const toolUseBlock = Array.isArray(data?.content)
    ? data.content.find(
        (item: { type?: string; name?: string; input?: unknown }) =>
          item?.type === 'tool_use' && item?.name === output.name
      )
    : null;

  if (toolUseBlock?.input) {
    return toolUseBlock.input as T;
  }

  const textContent = Array.isArray(data?.content)
    ? data.content
        .filter((item: { type?: string }) => item?.type === 'text')
        .map((item: { text?: string }) => item.text ?? '')
        .join('\n')
    : '';

  return parseJsonText<T>(textContent);
}

async function callGeminiStructured<T>({
  apiKey,
  model,
  systemPrompt,
  userParts,
  output,
}: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userParts: AiPromptPart[];
  output: StructuredOutputDefinition;
}): Promise<T> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: toGeminiContent(userParts),
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseJsonSchema: output.schema,
        },
      }),
    }
  );

  const data = await readJsonResponse(response, 'Google Gemini');
  const textContent = Array.isArray(data?.candidates?.[0]?.content?.parts)
    ? data.candidates[0].content.parts.map((part: { text?: string }) => part.text ?? '').join('\n')
    : '';

  return parseJsonText<T>(textContent);
}

function toOpenAiContent(userParts: AiPromptPart[]) {
  return userParts.map((part) => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }

    return {
      type: 'image_url',
      image_url: {
        url: part.dataUrl,
      },
    };
  });
}

function toAnthropicContent(userParts: AiPromptPart[]) {
  return userParts.map((part) => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }

    const { mediaType, data } = parseDataUrl(part.dataUrl);
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data,
      },
    };
  });
}

function toGeminiContent(userParts: AiPromptPart[]) {
  return userParts.map((part) => {
    if (part.type === 'text') {
      return { text: part.text };
    }

    const { mediaType, data } = parseDataUrl(part.dataUrl);
    return {
      inlineData: {
        mimeType: mediaType,
        data,
      },
    };
  });
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid image data URL.');
  }

  return {
    mediaType: match[1],
    data: match[2],
  };
}

async function readJsonResponse(response: Response, providerLabel: string) {
  const text = await response.text();
  let parsed: unknown = null;
  let parsedObject: Record<string, unknown> | null = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedObject = parsed as Record<string, unknown>;
      }
    } catch {
      parsed = null;
      parsedObject = null;
    }
  }

  if (!response.ok) {
    const nestedError =
      parsedObject?.error && typeof parsedObject.error === 'object' && 'message' in parsedObject.error
        ? (parsedObject.error as { message?: unknown }).message
        : undefined;
    const message =
      nestedError ||
      parsedObject?.error ||
      parsedObject?.message ||
      `${providerLabel} request failed with status ${response.status}.`;

    throw new Error(typeof message === 'string' ? message : `${providerLabel} request failed.`);
  }

  if (!parsed) {
    throw new Error(`${providerLabel} returned an empty or invalid JSON response.`);
  }

  return parsed;
}

function readOpenAiMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object' && 'text' in item) {
          const part = item as { text?: unknown };
          if (typeof part.text === 'string') {
            return part.text;
          }
        }

        return '';
      })
      .join('\n');
  }

  return '';
}

function parseJsonText<T>(text: string): T {
  if (!text.trim()) {
    throw new Error('The AI provider returned no structured data.');
  }

  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  return safeJsonParse<T>(cleaned, 'AI provider text output');
}

function resolveApiKey(apiKey: string, providerLabel: string, envNames: string[]) {
  const directKey = apiKey.trim();
  if (directKey) {
    return directKey;
  }

  for (const envName of envNames) {
    const envValue = getRuntimeEnv(envName)?.trim();
    if (envValue) {
      return envValue;
    }
  }

  throw new Error(
    `${providerLabel} API key is not configured. For localhost use, save it in AI Settings. For hosted deployment, configure ${envNames.join(
      ' or '
    )} as a Supabase Edge Function secret.`
  );
}

function getRuntimeEnv(name: string) {
  const denoGlobal = globalThis as typeof globalThis & {
    Deno?: {
      env?: {
        get?: (envName: string) => string | undefined;
      };
    };
  };

  const denoValue = denoGlobal.Deno?.env?.get?.(name);
  if (typeof denoValue === 'string') {
    return denoValue;
  }

  if (typeof process !== 'undefined' && typeof process.env?.[name] === 'string') {
    return process.env[name];
  }

  return undefined;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function safeJsonParse<T>(text: string, sourceLabel: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new StructuredOutputParseError(`The ${sourceLabel} was not valid JSON.`, text);
  }
}

function buildRepairSystemPrompt(systemPrompt: string, output: StructuredOutputDefinition) {
  return [
    systemPrompt,
    '',
    'CRITICAL OUTPUT REPAIR RULE:',
    `Return only valid JSON that matches the schema for "${output.name}".`,
    'Do not include markdown fences, explanations, or extra prose.',
    'If a value is uncertain, still return valid JSON with the closest schema-compliant value.',
  ].join('\n');
}

function buildRepairUserParts(userParts: AiPromptPart[], error: StructuredOutputParseError): AiPromptPart[] {
  const preview = error.rawText ? error.rawText.slice(0, 3000) : 'Unavailable';

  return [
    ...userParts,
    {
      type: 'text',
      text: [
        'Your previous structured output could not be parsed as valid JSON.',
        'Repair it and return only valid JSON.',
        '',
        'Previous invalid output snippet:',
        preview,
      ].join('\n'),
    },
  ];
}

function isStructuredOutputParseError(error: unknown): error is StructuredOutputParseError {
  return error instanceof StructuredOutputParseError;
}

function shouldRetryOpenRouterWithAuto(model: string, error: unknown) {
  if (model !== 'openrouter/free') {
    return false;
  }

  if (isStructuredOutputParseError(error)) {
    return true;
  }

  const message = toError(error).message.toLowerCase();
  return (
    message.includes('no structured data') ||
    message.includes('valid json') ||
    message.includes('tool arguments') ||
    message.includes('failed to call a function') ||
    message.includes('failed_generation')
  );
}

function isProvider(value: unknown): value is AiProvider {
  return value === 'openai' || value === 'claude' || value === 'gemini' || value === 'groq' || value === 'openrouter';
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
    return DEFAULT_SETTINGS.openrouterModel;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_SETTINGS.openrouterModel;
}

function getOpenRouterHeaders() {
  const headers: Record<string, string> = {};
  const referer = getRuntimeEnv('OPENROUTER_HTTP_REFERER')?.trim();
  const title = getRuntimeEnv('OPENROUTER_APP_TITLE')?.trim();

  if (referer) {
    headers['HTTP-Referer'] = referer;
  }

  if (title) {
    headers['X-OpenRouter-Title'] = title;
  }

  return headers;
}

// server/generate-test-cases-server.ts
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// supabase/functions/_shared/aiClient.ts
var DEFAULT_SETTINGS = {
  provider: "gemini",
  openaiApiKey: "",
  claudeApiKey: "",
  geminiApiKey: "",
  groqApiKey: "",
  openrouterApiKey: "",
  openaiModel: "gpt-5.4",
  claudeModel: "claude-sonnet-4-20250514",
  geminiModel: "gemini-2.5-pro",
  openrouterModel: "openrouter/free"
};
var GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
var PROVIDER_SECRET_ENV_NAMES = {
  openai: ["OPENAI_API_KEY"],
  claude: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"]
};
var StructuredOutputParseError = class extends Error {
  rawText;
  constructor(message, rawText) {
    super(message);
    this.name = "StructuredOutputParseError";
    this.rawText = rawText;
  }
};
async function generateStructuredData({
  aiSettings,
  systemPrompt,
  userParts,
  output,
  featureName
}) {
  const normalizedSettings = normalizeAiSettings(aiSettings);
  try {
    return await callProvider({
      provider: normalizedSettings.provider,
      settings: normalizedSettings,
      systemPrompt,
      userParts,
      output
    });
  } catch (error) {
    if (isStructuredOutputParseError(error)) {
      try {
        return await callProvider({
          provider: normalizedSettings.provider,
          settings: normalizedSettings,
          systemPrompt: buildRepairSystemPrompt(systemPrompt, output),
          userParts: buildRepairUserParts(userParts, error),
          output
        });
      } catch (retryError) {
        const providerError2 = toError(retryError);
        console.error(`[${featureName}] ${normalizedSettings.provider} provider failed after JSON repair retry:`, providerError2.message);
        throw providerError2;
      }
    }
    const providerError = toError(error);
    console.error(`[${featureName}] ${normalizedSettings.provider} provider failed:`, providerError.message);
    throw providerError;
  }
}
function normalizeAiSettings(value) {
  const raw = value && typeof value === "object" ? value : {};
  const normalizedOpenAiModel = raw.openaiModel === "gpt-4.1-mini" ? "gpt-5.4-mini" : raw.openaiModel;
  return {
    provider: isProvider(raw.provider) ? raw.provider : DEFAULT_SETTINGS.provider,
    openaiApiKey: typeof raw.openaiApiKey === "string" ? raw.openaiApiKey : DEFAULT_SETTINGS.openaiApiKey,
    claudeApiKey: typeof raw.claudeApiKey === "string" ? raw.claudeApiKey : DEFAULT_SETTINGS.claudeApiKey,
    geminiApiKey: typeof raw.geminiApiKey === "string" ? raw.geminiApiKey : DEFAULT_SETTINGS.geminiApiKey,
    groqApiKey: typeof raw.groqApiKey === "string" ? raw.groqApiKey : DEFAULT_SETTINGS.groqApiKey,
    openrouterApiKey: typeof raw.openrouterApiKey === "string" ? raw.openrouterApiKey : DEFAULT_SETTINGS.openrouterApiKey,
    openaiModel: isOpenAiModel(normalizedOpenAiModel) ? normalizedOpenAiModel : DEFAULT_SETTINGS.openaiModel,
    claudeModel: isClaudeModel(raw.claudeModel) ? raw.claudeModel : DEFAULT_SETTINGS.claudeModel,
    geminiModel: isGeminiModel(raw.geminiModel) ? raw.geminiModel : DEFAULT_SETTINGS.geminiModel,
    openrouterModel: normalizeOpenRouterModel(raw.openrouterModel)
  };
}
async function callProvider({
  provider,
  settings,
  systemPrompt,
  userParts,
  output
}) {
  switch (provider) {
    case "openai":
      return await callOpenAiCompatibleTool({
        url: "https://api.openai.com/v1/chat/completions",
        apiKey: resolveApiKey(settings.openaiApiKey, "OpenAI", PROVIDER_SECRET_ENV_NAMES.openai),
        model: settings.openaiModel,
        systemPrompt,
        userParts,
        output
      });
    case "claude":
      return await callAnthropicTool({
        apiKey: resolveApiKey(settings.claudeApiKey, "Claude", PROVIDER_SECRET_ENV_NAMES.claude),
        model: settings.claudeModel,
        systemPrompt,
        userParts,
        output
      });
    case "gemini":
      return await callGeminiStructured({
        apiKey: resolveApiKey(settings.geminiApiKey, "Google Gemini", PROVIDER_SECRET_ENV_NAMES.gemini),
        model: settings.geminiModel,
        systemPrompt,
        userParts,
        output
      });
    case "groq":
      return await callOpenAiCompatibleTool({
        url: "https://api.groq.com/openai/v1/chat/completions",
        apiKey: resolveApiKey(settings.groqApiKey, "Groq", PROVIDER_SECRET_ENV_NAMES.groq),
        model: GROQ_MODEL,
        systemPrompt,
        userParts,
        output,
        providerLabel: "Groq"
      });
    case "openrouter":
      return await callOpenAiCompatibleTool({
        url: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: resolveApiKey(settings.openrouterApiKey, "OpenRouter", PROVIDER_SECRET_ENV_NAMES.openrouter),
        model: settings.openrouterModel,
        systemPrompt,
        userParts,
        output,
        providerLabel: "OpenRouter",
        extraHeaders: getOpenRouterHeaders()
      });
    default:
      throw new Error("Unsupported AI provider.");
  }
}
async function callOpenAiCompatibleTool({
  url,
  apiKey,
  model,
  systemPrompt,
  userParts,
  output,
  providerLabel = "OpenAI-compatible AI provider",
  extraHeaders = {}
}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: toOpenAiContent(userParts) }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: output.name,
            description: output.description,
            parameters: output.schema
          }
        }
      ],
      tool_choice: {
        type: "function",
        function: { name: output.name }
      }
    })
  });
  const data = await readJsonResponse(response, providerLabel);
  const toolArguments = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (toolArguments) {
    return safeJsonParse(toolArguments, "OpenAI-compatible tool arguments");
  }
  const messageContent = readOpenAiMessageContent(data?.choices?.[0]?.message?.content);
  return parseJsonText(messageContent);
}
async function callAnthropicTool({
  apiKey,
  model,
  systemPrompt,
  userParts,
  output
}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: toAnthropicContent(userParts)
        }
      ],
      tools: [
        {
          name: output.name,
          description: output.description,
          input_schema: output.schema
        }
      ],
      tool_choice: {
        type: "tool",
        name: output.name
      }
    })
  });
  const data = await readJsonResponse(response, "Anthropic");
  const toolUseBlock = Array.isArray(data?.content) ? data.content.find(
    (item) => item?.type === "tool_use" && item?.name === output.name
  ) : null;
  if (toolUseBlock?.input) {
    return toolUseBlock.input;
  }
  const textContent = Array.isArray(data?.content) ? data.content.filter((item) => item?.type === "text").map((item) => item.text ?? "").join("\n") : "";
  return parseJsonText(textContent);
}
async function callGeminiStructured({
  apiKey,
  model,
  systemPrompt,
  userParts,
  output
}) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: toGeminiContent(userParts)
          }
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: output.schema
        }
      })
    }
  );
  const data = await readJsonResponse(response, "Google Gemini");
  const textContent = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts.map((part) => part.text ?? "").join("\n") : "";
  return parseJsonText(textContent);
}
function toOpenAiContent(userParts) {
  return userParts.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    return {
      type: "image_url",
      image_url: {
        url: part.dataUrl
      }
    };
  });
}
function toAnthropicContent(userParts) {
  return userParts.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    const { mediaType, data } = parseDataUrl(part.dataUrl);
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data
      }
    };
  });
}
function toGeminiContent(userParts) {
  return userParts.map((part) => {
    if (part.type === "text") {
      return { text: part.text };
    }
    const { mediaType, data } = parseDataUrl(part.dataUrl);
    return {
      inlineData: {
        mimeType: mediaType,
        data
      }
    };
  });
}
function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL.");
  }
  return {
    mediaType: match[1],
    data: match[2]
  };
}
async function readJsonResponse(response, providerLabel) {
  const text = await response.text();
  let parsed = null;
  let parsedObject = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedObject = parsed;
      }
    } catch {
      parsed = null;
      parsedObject = null;
    }
  }
  if (!response.ok) {
    const nestedError = parsedObject?.error && typeof parsedObject.error === "object" && "message" in parsedObject.error ? parsedObject.error.message : void 0;
    const message = nestedError || parsedObject?.error || parsedObject?.message || `${providerLabel} request failed with status ${response.status}.`;
    throw new Error(typeof message === "string" ? message : `${providerLabel} request failed.`);
  }
  if (!parsed) {
    throw new Error(`${providerLabel} returned an empty or invalid JSON response.`);
  }
  return parsed;
}
function readOpenAiMessageContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object" && "text" in item) {
        const part = item;
        if (typeof part.text === "string") {
          return part.text;
        }
      }
      return "";
    }).join("\n");
  }
  return "";
}
function parseJsonText(text) {
  if (!text.trim()) {
    throw new Error("The AI provider returned no structured data.");
  }
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return safeJsonParse(cleaned, "AI provider text output");
}
function resolveApiKey(apiKey, providerLabel, envNames) {
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
      " or "
    )} as a Supabase Edge Function secret.`
  );
}
function getRuntimeEnv(name) {
  const denoGlobal = globalThis;
  const denoValue = denoGlobal.Deno?.env?.get?.(name);
  if (typeof denoValue === "string") {
    return denoValue;
  }
  if (typeof process !== "undefined" && typeof process.env?.[name] === "string") {
    return process.env[name];
  }
  return void 0;
}
function toError(error) {
  return error instanceof Error ? error : new Error(String(error));
}
function safeJsonParse(text, sourceLabel) {
  try {
    return JSON.parse(text);
  } catch {
    throw new StructuredOutputParseError(`The ${sourceLabel} was not valid JSON.`, text);
  }
}
function buildRepairSystemPrompt(systemPrompt, output) {
  return [
    systemPrompt,
    "",
    "CRITICAL OUTPUT REPAIR RULE:",
    `Return only valid JSON that matches the schema for "${output.name}".`,
    "Do not include markdown fences, explanations, or extra prose.",
    "If a value is uncertain, still return valid JSON with the closest schema-compliant value."
  ].join("\n");
}
function buildRepairUserParts(userParts, error) {
  const preview = error.rawText ? error.rawText.slice(0, 3e3) : "Unavailable";
  return [
    ...userParts,
    {
      type: "text",
      text: [
        "Your previous structured output could not be parsed as valid JSON.",
        "Repair it and return only valid JSON.",
        "",
        "Previous invalid output snippet:",
        preview
      ].join("\n")
    }
  ];
}
function isStructuredOutputParseError(error) {
  return error instanceof StructuredOutputParseError;
}
function isProvider(value) {
  return value === "openai" || value === "claude" || value === "gemini" || value === "groq" || value === "openrouter";
}
function isOpenAiModel(value) {
  return value === "gpt-5.4" || value === "gpt-5.4-mini";
}
function isClaudeModel(value) {
  return value === "claude-sonnet-4-20250514" || value === "claude-opus-4-1-20250805";
}
function isGeminiModel(value) {
  return value === "gemini-2.5-flash" || value === "gemini-2.5-pro" || value === "gemini-3-flash-preview";
}
function normalizeOpenRouterModel(value) {
  if (typeof value !== "string") {
    return DEFAULT_SETTINGS.openrouterModel;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_SETTINGS.openrouterModel;
}
function getOpenRouterHeaders() {
  const headers = {};
  const referer = getRuntimeEnv("OPENROUTER_HTTP_REFERER")?.trim();
  const title = getRuntimeEnv("OPENROUTER_APP_TITLE")?.trim();
  if (referer) {
    headers["HTTP-Referer"] = referer;
  }
  if (title) {
    headers["X-OpenRouter-Title"] = title;
  }
  return headers;
}

// supabase/functions/_shared/generationMode.ts
var DEFAULT_GENERATION_MODE = "rob_style";
var GENERATION_MODE_PROFILES = {
  rob_style: {
    label: "Rob",
    generatorPromptLines: [
      "Keep the suite aligned with Rob-style manual QA writing: clean, permission-aware, actor-based, and easy to review.",
      'Strongly prefer actor-based testcase titles such as "Verify that the user..." whenever that matches the requirement actor.',
      "Keep authority names exact and visible when permissions drive the scenario.",
      "Write expected results as short, direct, observable outcomes instead of padded prose.",
      "When permissions matter, explicitly separate with-permission, without-permission, wrong-permission, action-visibility, and action-execution scenarios when they represent different risks.",
      "When exports, emails, notifications, or other user-visible side effects are part of the flow, keep trigger conditions and visible outcomes explicit instead of implied.",
      "When onboarding, account setup, or configuration screens are involved, keep step-by-step role-aware coverage practical and easy to execute.",
      "Use clean module/page names when the feature clearly refers to a specific page, screen, popup, list, or details view.",
      "Keep enterprise fields present, but make them concise, practical, and easy for a working QA team to use.",
      "Do not compress distinct useful QA checks just to make the output shorter; prefer complete, practical coverage."
    ],
    reviewerLines: [
      "Preserve Rob-style actor-based QA wording, especially clear permission-aware testcase titles.",
      "Flag cases that sound robotic, vague, or less precise than a clean senior manual-QA workbook.",
      "Approve only if the suite feels like strong senior-QA work while still sounding natural and crisp.",
      "Do not over-filter meaningful boundary, validation, navigation, or persistence checks when they add real coverage."
    ],
    reviewThreshold: 84,
    correctionReminder: "Keep the suite in a Rob-style QA voice while fixing coverage, naming, and quality gaps with clearer permission-aware titles and sharper expected results.",
    analysisPromptLines: [
      "Keep explanations simple, practical, and close to a clean senior QA workbook style.",
      "Prefer plain tester language over formal enterprise phrasing.",
      "Call out role-specific outcomes, notifications, exports, and user-visible side effects when they matter to testing.",
      "When suggesting testcase starters or testing ideas, keep them human, permission-aware, and browser-focused."
    ],
    auditPromptLines: [
      "When adding missing cases, keep the new cases aligned with Rob-style manual QA wording.",
      "Prefer actor-based testcase naming that sounds natural to experienced browser testers.",
      "Make permission or authority distinctions explicit when they are part of the real behavior.",
      "Keep expected results short, direct, and immediately observable.",
      "Keep email, export, notification, and downstream-reflection outcomes explicit when they are part of the real flow.",
      "Prefer complete gap coverage over compressed minimalist additions when the requirement clearly supports more detail."
    ],
    mergePromptLines: [
      "Preserve the clean tester voice of strong rows instead of over-formalizing everything.",
      "When merging duplicates, keep the final testcase wording practical, human, and permission-aware.",
      "Preserve distinct coverage and do not merge away meaningful variations just for neatness."
    ],
    coveragePromptLines: [
      "Explain coverage gaps in plain tester-friendly English.",
      "Recommendations should sound practical and actionable, not overly formal.",
      "Treat missing meaningful detail as a real gap instead of assuming a shorter suite is automatically stronger."
    ],
    planningPromptLines: [
      "Keep the test plan practical, browser-testing focused, and easy for a working QA team to execute.",
      "Prefer realistic scope, assumptions, risks, and deliverables over boilerplate template wording.",
      "Write planning notes the way a senior QA would hand them to another tester: clear, direct, and usable.",
      "Favor complete, useful planning detail over polished but shallow summaries."
    ],
    traceabilityPromptLines: [
      "Make the matrix easy to read by a manual QA team and keep coverage notes practical and direct.",
      "When coverage is missing, explain the gap in natural tester language.",
      "Call out missing role-based outcomes, settings combinations, and user-visible side effects when they are part of the requirement."
    ],
    testDataPromptLines: [
      "Suggest realistic, usable test data that a manual tester would actually prepare.",
      "Balance valid, invalid, and edge data without turning it into artificial filler.",
      "Call out permission-specific or status-specific data sets when they matter to execution."
    ],
    scenarioPromptLines: [
      "Map flows the way an experienced manual tester would think through the feature: primary, alternate, negative, and edge.",
      "Keep the scenario map concrete and easy to turn into testcases later.",
      "Do not collapse meaningful alternate or edge flows into generic umbrella statements."
    ],
    clarificationPromptLines: [
      "Ask practical QA clarification questions in plain English.",
      "Surface ambiguity the way an experienced tester would before execution starts.",
      "Prefer complete, risk-relevant clarification over a shorter but incomplete question set."
    ]
  },
  yuv_style: {
    label: "Yuv",
    generatorPromptLines: [
      "Keep the suite aligned with Yuv-style QA thinking: broad, practical, module-aware, and coverage-rich.",
      "Cover module/page behavior, UI states, navigation, list behavior, sorting, filters, and downstream reflection when they are relevant.",
      "When the feature is list- or grid-oriented, explicitly cover default sort, reverse sort, filters/search, empty state, row click navigation, column behavior, and downstream detail-page reflection where relevant.",
      "When account setup, onboarding, settings, customer, supplier, buyer, or reseller flows are involved, keep actor-specific page behavior and downstream reflection explicit.",
      "When exports, notifications, email delivery, API-triggered changes, or background side effects are visible to the user or business flow, cover them as separate meaningful scenarios.",
      "Keep testcase titles professional and actor-based, but optimize more for complete functional coverage than for title polish alone.",
      "Separate positive, negative, edge, navigation, and UI-behavior scenarios when they represent different user risks.",
      "Do not compress useful coverage just to make the output shorter; prefer better and more complete test cases."
    ],
    reviewerLines: [
      "Preserve Yuv-style breadth: module/page behavior, practical UI checks, and fuller scenario separation.",
      "Flag suites that miss list behavior, navigation, sorting, filtering, page/module context, or realistic negative paths.",
      "Approve only if the suite feels like a strong senior QA explored the feature end to end, not just the main AC bullets.",
      "Reject over-compressed artifacts that merge distinct user risks into a few generic cases."
    ],
    reviewThreshold: 86,
    correctionReminder: "Raise the suite to a Yuv-style QA standard with broader module-aware coverage, stronger UI/list/navigation coverage, and fuller positive/negative/edge separation.",
    analysisPromptLines: [
      "Keep the analysis practical and feature-oriented, with strong attention to modules, pages, states, and user-visible behavior.",
      "Highlight coverage implications around navigation, UI behavior, and downstream list/detail views when relevant.",
      "Surface settings, onboarding, multi-actor, export, and notification side-effect implications when the requirement supports them.",
      "Prefer concrete tester observations over abstract enterprise wording."
    ],
    auditPromptLines: [
      "When adding missing cases, widen the coverage the way a senior QA would: module behavior, UI states, navigation, and practical negatives.",
      "Preserve distinct page/list/detail/table/sort/filter scenarios instead of merging them away.",
      "When list behavior is relevant, add the missing sort, filter, search, empty-state, row-click, and downstream-reflection cases instead of summarizing them broadly.",
      "When onboarding, settings, notifications, exports, or multi-actor flows are relevant, keep those scenario clusters separate instead of hiding them in generic rows.",
      "Prefer complete gap coverage over compressed minimalist additions."
    ],
    mergePromptLines: [
      "Preserve meaningful scenario breadth when merging and keep module/page context clear.",
      "Do not merge away useful UI, sorting, navigation, table, or state-based differences just for neatness.",
      "Keep the final wording practical and immediately usable for execution."
    ],
    coveragePromptLines: [
      "Explain coverage gaps in a practical QA voice with clear references to missing UI states, navigation paths, or module behavior.",
      "Treat missing page/list/detail behavior, state transitions, and edge conditions as real coverage gaps when supported by the requirement.",
      "Treat missing notifications, emails, exports, onboarding steps, and actor-specific outcomes as real gaps when supported by the requirement.",
      "Prefer fuller, execution-ready recommendations over minimalist summaries."
    ],
    planningPromptLines: [
      "Keep the plan practical and execution-focused, with attention to modules, pages, states, and realistic user flows.",
      "Prefer realistic scope, assumptions, risks, and deliverables over boilerplate wording.",
      "Call out multi-actor coordination, settings dependencies, and side effects such as export, email, and downstream reflection when they matter.",
      "Favor complete, useful planning detail over polished but shallow summaries."
    ],
    traceabilityPromptLines: [
      "Make the matrix easy to read by a QA team and keep coverage notes tied to concrete module/page behavior.",
      "Highlight where navigation, list behavior, state changes, or UI interactions are only partially covered."
    ],
    testDataPromptLines: [
      "Suggest realistic, usable test data that supports positive, negative, edge, and state-based coverage.",
      "Include data combinations that help exercise list views, sorting, filtering, statuses, and downstream reflection when relevant."
    ],
    scenarioPromptLines: [
      "Map flows the way an experienced manual tester would think through the feature: primary, alternate, negative, edge, and UI/state-driven flows.",
      "Keep the scenario map concrete and easy to turn into fuller testcases later.",
      "Do not collapse meaningful alternate, UI, state, or edge flows into generic umbrella statements."
    ],
    clarificationPromptLines: [
      "Ask practical QA clarification questions in plain English.",
      "Surface ambiguity around modules, pages, state behavior, navigation, sorting/filtering, and downstream visibility before execution starts.",
      "Prefer complete, risk-relevant clarification over a shorter but incomplete question set."
    ]
  },
  swag_style: {
    label: "SWAG",
    generatorPromptLines: [
      "Use the SWAG benchmark style: broad web-app QA coverage across common UI patterns, business states, and user-visible behavior.",
      "Treat forms, inputs, dropdowns, radios, checkboxes, file uploads, drag-and-drop, grids, filters, sorting, pagination, exports, refresh behavior, and persistence as reusable QA coverage patterns when relevant.",
      "Cover permission, role, tenant-setting, feature-flag, state-transition, network/API reflection, and DB/data-persistence behavior when the requirement supports them.",
      "Also cover onboarding, account setup, customer/supplier/buyer/reseller actor differences, notification/email delivery, and user-visible side effects when they are relevant.",
      "When the requirement points to accessibility, cover keyboard navigation, focus behavior, labels, and accessible error or dialog behavior explicitly.",
      "When the requirement points to mobile or responsive behavior, cover desktop/tablet/mobile differences, truncation/overflow, and touch behavior explicitly.",
      "When the requirement points to concurrency, volume, or environment compatibility, cover multi-user conflicts, duplicate-submit protection, performance/loading behavior, and browser-specific differences explicitly.",
      "When export, API/network, or background actions are part of the requirement, keep both trigger behavior and reflected user/business outcomes explicit.",
      "Keep testcase titles professional and actor-based, but prioritize complete benchmark-worthy coverage over minimal output.",
      "Professional-quality benchmark mode means better and more complete test cases, not fewer ones."
    ],
    reviewerLines: [
      "Review the suite against broad web-app QA benchmark expectations, not just explicit AC bullets.",
      "Flag missing UI pattern coverage such as sort/filter/search/list behavior, form validation, upload/download, state persistence, redirects, and side effects when the requirement supports them.",
      "Flag missing onboarding, settings, notification/email, export, API/network-reflection, and multi-actor coverage when the requirement supports them.",
      "Flag missing accessibility, responsive/mobile, concurrency, performance/large-data, deeper API/DB, or browser-compatibility coverage when the requirement supports them.",
      "Approve only if the suite feels benchmark-worthy for a modern web app and does not over-compress useful cases.",
      "Reject suites that miss realistic permission, state, navigation, persistence, or user-message coverage."
    ],
    reviewThreshold: 88,
    correctionReminder: "Raise the artifact to SWAG benchmark quality with complete web-app QA coverage, explicit state/permission handling, and practical execution-ready detail.",
    analysisPromptLines: [
      "Analyze the requirement with a broad web-app QA benchmark mindset.",
      "Surface reusable UI, state, permission, navigation, and persistence patterns when they are relevant.",
      "Surface onboarding, account setup, notification/email, export, API/network-reflection, and multi-actor patterns when they are relevant.",
      "Also surface accessibility, responsive/mobile, concurrency, performance/large-data, deeper API/DB, and cross-browser patterns when they are relevant.",
      "Prefer practical benchmark-style tester observations over shallow summaries."
    ],
    auditPromptLines: [
      "When adding missing cases, fill benchmark-worthy gaps across web-app patterns such as forms, grids, filters, uploads, exports, state transitions, and persistence.",
      "Also fill missing benchmark-worthy gaps around onboarding, settings, notifications, emails, network/API reflection, and multi-actor flows when they are relevant.",
      "Also fill missing benchmark-worthy gaps around accessibility, responsive/mobile behavior, concurrency, performance/volume, browser compatibility, and deeper API/DB verification when they are relevant.",
      "Preserve distinct scenario clusters instead of merging them into broad umbrella rows.",
      "Prefer complete benchmark coverage over minimalist additions."
    ],
    mergePromptLines: [
      "Preserve meaningful benchmark-level coverage when merging and do not merge away distinct UI, state, permission, or persistence risks.",
      "Keep the final wording practical, professional, and execution-ready."
    ],
    coveragePromptLines: [
      "Judge coverage against common web-app QA benchmark expectations when the requirement supports them.",
      "Treat missing form validation, list behavior, upload/download behavior, redirect behavior, settings combinations, and persistence as real gaps when relevant.",
      "Treat missing notifications, emails, export/network reflection, onboarding/account setup, and actor-specific outcomes as real gaps when relevant.",
      "Treat missing accessibility, responsive/mobile, concurrency, performance/loading, deeper API/DB, and browser-compatibility coverage as real gaps when relevant.",
      "Prefer fuller benchmark-minded recommendations over overly short summaries."
    ],
    planningPromptLines: [
      "Make planning artifacts reflect benchmark-quality modern web-app QA coverage.",
      "Highlight reusable UI, state, role, navigation, data, and persistence risks clearly.",
      "Include onboarding, settings, notification/email, export/network, and multi-actor risks when they matter.",
      "Also include accessibility, responsive/mobile, concurrency, performance/volume, API/DB, and browser-compatibility risks when they matter.",
      "Favor complete and practical planning detail over boilerplate."
    ],
    traceabilityPromptLines: [
      "Keep traceability tied to explicit requirement points plus clear benchmark-worthy coverage areas such as forms, grids, settings, and persistence.",
      "Include actor-specific flows and side effects like notifications, exports, or reflected data updates when they matter.",
      "Include accessibility, responsive/mobile, concurrency, performance/loading, API/DB, and browser-compatibility obligations when they matter.",
      "Highlight where key web-app behaviors are only partially covered."
    ],
    testDataPromptLines: [
      "Suggest data combinations that support benchmark-style coverage: valid/invalid/boundary, role-based, status-based, search/filter, upload/export, and persistence checks.",
      "Include realistic datasets for customer/supplier/buyer/reseller actors, settings combinations, and notification/export side effects when relevant.",
      "Include realistic datasets for large-volume records, conflict scenarios, and API/DB state verification when relevant.",
      "Keep the data realistic and execution-ready."
    ],
    scenarioPromptLines: [
      "Map scenarios with a strong web-app QA benchmark mindset: primary, alternate, negative, edge, state, permission, navigation, persistence, and side-effect flows.",
      "Include onboarding/setup and multi-actor interaction flows when the requirement supports them.",
      "Include accessibility, responsive/mobile, concurrency, performance/loading, API/DB, and browser-compatibility flows when the requirement supports them.",
      "Do not collapse meaningful UI or workflow variations into generic umbrella statements."
    ],
    clarificationPromptLines: [
      "Ask benchmark-minded QA clarification questions in plain English.",
      "Surface ambiguity around forms, grids, state transitions, settings, permissions, uploads/downloads, redirects, and persistence before execution starts.",
      "Also surface ambiguity around onboarding, account setup, notifications/emails, exports, API/network reflection, and actor-specific outcomes when relevant.",
      "Also surface ambiguity around accessibility obligations, mobile/responsive support, browser coverage, concurrency rules, performance expectations, and API/DB verification when relevant.",
      "Prefer complete, risk-relevant clarification over a shorter but incomplete question set."
    ]
  },
  professional_standard: {
    label: "Professional Standard",
    generatorPromptLines: [
      "Optimize for enterprise-standard QA documentation and formal review readiness.",
      "Maintain strong traceability from requirement points to testcase rows.",
      "Make module, priority, test data, and post-condition fields meaningfully useful for project teams.",
      "Keep wording professional, concise, and audit-ready while still using actor-based titles when appropriate.",
      "Use clean module/page naming and keep expected results direct, observable, and reviewer-friendly.",
      "When permissions or list/grid behavior are central to the feature, cover them with explicit, distinct cases rather than generic umbrella rows.",
      "When settings, onboarding, notifications, exports, or multi-actor outcomes are central to the feature, cover them with explicit, distinct cases rather than generic umbrella rows.",
      "Prefer risk-based, stakeholder-ready artifacts over generic checklist filler.",
      "Professional standard does not mean fewer rows; prefer complete, useful, review-worthy coverage over over-compressed output."
    ],
    reviewerLines: [
      "Be strict about traceability, coverage completeness, and enterprise field quality.",
      "Flag weak prioritization, vague test data, or missing post-conditions.",
      "Approve only if the suite reads like a formally reviewable senior-QA deliverable.",
      "Reject artifacts that feel generic, boilerplate-heavy, or weak on risk and business impact.",
      "Reject over-compressed artifacts that remove meaningful validation, boundary, navigation, or risk coverage."
    ],
    reviewThreshold: 90,
    correctionReminder: "Raise the suite to a formal professional QA standard with stronger traceability, cleaner prioritization, and more audit-ready wording.",
    analysisPromptLines: [
      "Use cleaner enterprise-style summaries and more formal QA language where helpful.",
      "Emphasize traceability, risk, and review-ready clarity in the analysis.",
      "Keep recommendations concise, structured, and suitable for professional QA documentation.",
      "Call out ambiguity, risk, and coverage implications the way a senior QA reviewer would."
    ],
    auditPromptLines: [
      "Make new gap-filling cases look formally reviewable and traceable to requirement points.",
      "Prioritize strong module assignment, priority, and enterprise field quality.",
      "Prefer risk-first gap filling rather than broad but shallow padding.",
      "Do not trim away meaningful missing scenarios just to keep the enhancement set shorter."
    ],
    mergePromptLines: [
      "Normalize the final suite into a consistent, professional, enterprise-ready format.",
      "Prefer concise, formally reviewable testcase wording and stronger field standardization.",
      "Do not preserve weak rows just for quantity; preserve business coverage, not clutter.",
      "Do not merge away distinct requirement coverage just because two rows look superficially similar."
    ],
    coveragePromptLines: [
      "Explain gaps and recommendations in a formal, review-ready QA tone.",
      "Make recommendations concise, prioritized, and enterprise-appropriate.",
      "Keep the coverage judgment honest and risk-weighted rather than optimistic.",
      "Treat missing side effects, actor-specific flows, and settings-driven behavior as real risk gaps when supported by the requirement.",
      "Treat missing meaningful QA detail as a real coverage gap; do not reward over-compressed suites."
    ],
    planningPromptLines: [
      "Make the test plan read like a formal, enterprise-ready QA strategy artifact.",
      "Keep scope, risks, entry criteria, exit criteria, and deliverables cleanly structured and reviewable.",
      "Favor realistic execution value over template language.",
      "Keep planning artifacts complete and decision-useful, not polished but shallow."
    ],
    traceabilityPromptLines: [
      "Structure the matrix for professional traceability and review readiness.",
      "Use concise, formal coverage notes that clearly show covered, partial, and missing areas.",
      "Highlight the requirement points that would create release risk if left partial or missing."
    ],
    testDataPromptLines: [
      "Make the test data plan look organized, complete, and enterprise-ready.",
      "Emphasize traceability between scenarios, data categories, and why each dataset matters.",
      "Use realistic values and edge cases a working QA team would actually prepare."
    ],
    scenarioPromptLines: [
      "Present the scenario map in a structured, professional QA planning style.",
      "Highlight regression-sensitive intersections and high-risk paths clearly.",
      "Avoid decorative filler flows; emphasize the flows that actually matter for defects and release risk.",
      "Do not over-compress distinct alternate, negative, or edge flows that matter for real QA coverage."
    ],
    clarificationPromptLines: [
      "Phrase clarification questions in a concise, professional, stakeholder-ready style.",
      "Clearly distinguish blockers from lower-priority ambiguities.",
      "Surface the unanswered decisions most likely to cause test escapes or rework.",
      "Prefer a complete, risk-driven question set over a shorter but incomplete one."
    ]
  }
};
function getGenerationMode(aiSettings) {
  const rawSettings = aiSettings && typeof aiSettings === "object" ? aiSettings : {};
  if (rawSettings.generationMode === "professional_standard") return "professional_standard";
  if (rawSettings.generationMode === "swag_style") return "swag_style";
  if (rawSettings.generationMode === "yuv_style") return "yuv_style";
  if (rawSettings.generationMode === "rob_style" || rawSettings.generationMode === "my_style") return "rob_style";
  return DEFAULT_GENERATION_MODE;
}
function isStrictRequirementMode(aiSettings) {
  const rawSettings = aiSettings && typeof aiSettings === "object" ? aiSettings : {};
  return rawSettings.strictRequirementMode === true;
}
function getGenerationModeProfile(generationMode) {
  return GENERATION_MODE_PROFILES[generationMode] || GENERATION_MODE_PROFILES[DEFAULT_GENERATION_MODE];
}

// supabase/functions/_shared/reviewedStructuredGeneration.ts
var artifactReviewSchema = {
  type: "object",
  properties: {
    overallScore: { type: "number" },
    decision: { type: "string", enum: ["approve", "revise"] },
    strengths: {
      type: "array",
      items: { type: "string" }
    },
    criticalGaps: {
      type: "array",
      items: { type: "string" }
    },
    revisionInstructions: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["overallScore", "decision", "strengths", "criticalGaps", "revisionInstructions"],
  additionalProperties: false
};
async function generateReviewedStructuredData({
  aiSettings,
  featureName,
  artifactLabel,
  systemPrompt,
  userParts,
  output,
  reviewThreshold = 86,
  reviewFocusLines = [],
  correctionReminder = "Raise the artifact to a senior-QA, enterprise-ready standard without changing the requirement scope."
}) {
  const strictRequirementMode = isStrictRequirementMode(aiSettings);
  const firstDraft = await generateStructuredData({
    aiSettings,
    featureName,
    systemPrompt,
    userParts,
    output
  });
  const draftJson = JSON.stringify(firstDraft, null, 2);
  let review;
  try {
    review = await generateStructuredData({
      aiSettings,
      featureName: `${featureName}-quality-review`,
      systemPrompt: [
        "You are a principal QA reviewer in 2026 auditing a generated QA artifact.",
        "",
        `Review the candidate ${artifactLabel} against the original requirement/context and decide whether it is strong enough for a 10+ year senior QA standard.`,
        `Minimum approval score: ${reviewThreshold}. If the artifact is below that score, you must return "revise".`,
        "",
        "Evaluate for:",
        "- traceability to the requirement",
        "- preservation of exact named labels, config keys, logic terms, and fixed behaviors from the requirement when they matter",
        "- realism and practical QA usefulness",
        "- coverage of high-risk and high-priority areas",
        "- professional wording and review readiness",
        "- absence of vague filler or generic boilerplate",
        "- absence of invented configuration-management UI, setup workflow, or modal behavior that is not stated in the requirement",
        ...strictRequirementMode ? [
          "- strict exact-requirement fidelity when the source contains exact labels, config keys, rule names, or fixed behavior terms",
          "- rejection of placeholder examples that replace exact requirement terms with generic substitute values"
        ] : [],
        ...reviewFocusLines.map((line) => `- ${line}`),
        "",
        'Choose "revise" if the artifact has meaningful gaps, weak wording, weak prioritization, missing risk focus, or poor stakeholder usefulness.',
        "Be strict but practical."
      ].join("\n"),
      userParts: [
        ...userParts,
        {
          type: "text",
          text: [
            `Candidate ${artifactLabel} JSON:`,
            draftJson
          ].join("\n")
        }
      ],
      output: {
        name: "return_artifact_review",
        description: "Return a strict quality review of the generated QA artifact.",
        schema: artifactReviewSchema
      }
    });
  } catch (error) {
    console.warn(`[${featureName}] artifact review failed, returning first draft:`, error);
    return firstDraft;
  }
  const needsRevision = review.decision === "revise" || review.overallScore < reviewThreshold || review.criticalGaps.length > 0;
  if (!needsRevision) {
    return firstDraft;
  }
  try {
    return await generateStructuredData({
      aiSettings,
      featureName: `${featureName}-quality-correction`,
      systemPrompt: [
        systemPrompt,
        "",
        "QUALITY CORRECTION PASS:",
        `Revise the ${artifactLabel} so it meets a senior-QA, enterprise-ready standard.`,
        correctionReminder,
        "Fix every review issue while staying inside the original requirement scope.",
        "Preserve exact named labels, config keys, logic terms, and fixed behaviors from the requirement when they matter.",
        "Do not invent admin/configuration screens, modals, or setup workflows unless the requirement explicitly includes them.",
        ...strictRequirementMode ? [
          "Strict exact requirement mode is enabled, so keep the corrected artifact tightly aligned to the source wording and fixed logic terms.",
          "Do not replace exact requirement terms with generic examples or substitute values."
        ] : [],
        "Return only the corrected final artifact."
      ].join("\n"),
      userParts: [
        ...userParts,
        {
          type: "text",
          text: [
            `First draft ${artifactLabel} JSON:`,
            draftJson,
            "",
            `Quality review result:`,
            `- Overall score: ${review.overallScore}`,
            `- Decision: ${review.decision}`,
            `- Strengths: ${review.strengths.join(" | ") || "None listed"}`,
            `- Critical gaps: ${review.criticalGaps.join(" | ") || "None listed"}`,
            `- Revision instructions: ${review.revisionInstructions.join(" | ") || "None listed"}`
          ].join("\n")
        }
      ],
      output
    });
  } catch (error) {
    console.warn(`[${featureName}] artifact correction failed, returning first draft:`, error);
    return firstDraft;
  }
}

// supabase/functions/_shared/requestCache.ts
var CACHE_TTL_MS = 5 * 60 * 1e3;
var MAX_CACHE_SIZE = 100;
var REQUEST_CACHE_VERSION = "2026-04-08-v7";
var cache = /* @__PURE__ */ new Map();
async function computeRequestCacheKey(featureName, aiSettings, payload) {
  const rawSettings = aiSettings && typeof aiSettings === "object" ? aiSettings : {};
  const provider = typeof rawSettings.provider === "string" ? rawSettings.provider : "gemini";
  const openaiModel = typeof rawSettings.openaiModel === "string" ? rawSettings.openaiModel : "";
  const claudeModel = typeof rawSettings.claudeModel === "string" ? rawSettings.claudeModel : "";
  const geminiModel = typeof rawSettings.geminiModel === "string" ? rawSettings.geminiModel : "";
  const openrouterModel = typeof rawSettings.openrouterModel === "string" ? rawSettings.openrouterModel : "";
  const strictRequirementMode = rawSettings.strictRequirementMode === true ? "strict" : "normal";
  const generationMode = rawSettings.generationMode === "professional_standard" ? "professional_standard" : rawSettings.generationMode === "swag_style" ? "swag_style" : rawSettings.generationMode === "yuv_style" ? "yuv_style" : rawSettings.generationMode === "rob_style" || rawSettings.generationMode === "my_style" ? "rob_style" : "rob_style";
  const raw = `${REQUEST_CACHE_VERSION}::${featureName}::${provider}::${openaiModel}::${claudeModel}::${geminiModel}::${openrouterModel}::${generationMode}::${strictRequirementMode}::${stableStringify(payload)}`;
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function getCachedRequest(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}
function setCachedRequest(key, data) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, timestamp: Date.now() });
}
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

// supabase/functions/_shared/requirementAnalysis.ts
var REQUIREMENT_ANALYSIS_CACHE_VERSION = "2026-04-08-v4";
var requirementAnalysisSchema = {
  type: "object",
  properties: {
    functionalityExplanation: { type: "string" },
    simpleSummary: { type: "string" },
    primaryActor: { type: "string" },
    primaryAction: { type: "string" },
    recommendedStarter: { type: "string" },
    businessModules: {
      type: "array",
      items: { type: "string" }
    },
    mainFlow: {
      type: "array",
      items: { type: "string" }
    },
    whatToTest: {
      type: "array",
      items: { type: "string" }
    },
    howToTest: {
      type: "array",
      items: { type: "string" }
    },
    acceptanceCriteria: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          criterion: { type: "string" },
          sourceType: { type: "string", enum: ["Explicit AC", "Derived Requirement Point"] },
          plainEnglishMeaning: { type: "string" },
          moduleHint: { type: "string" },
          priority: { type: "string", enum: ["Critical", "High", "Medium", "Low"] },
          whatToTest: {
            type: "array",
            items: { type: "string" }
          },
          howToTest: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["id", "criterion", "sourceType", "plainEnglishMeaning", "moduleHint", "priority", "whatToTest", "howToTest"],
        additionalProperties: false
      }
    },
    importantNotes: {
      type: "array",
      items: { type: "string" }
    },
    riskHotspots: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "functionalityExplanation",
    "simpleSummary",
    "primaryActor",
    "primaryAction",
    "recommendedStarter",
    "businessModules",
    "mainFlow",
    "whatToTest",
    "howToTest",
    "acceptanceCriteria",
    "importantNotes",
    "riskHotspots"
  ],
  additionalProperties: false
};
var requirementAnalysisSystemPrompt = `You are a senior QA analyst and requirement breakdown expert.

MANDATORY READING METHOD:
1. Read the requirement from TOP to BOTTOM, line by line.
2. Read the requirement again from BOTTOM to TOP, line by line.
3. Read the requirement once more from TOP to BOTTOM to confirm nothing was missed.

YOUR JOB:
- Explain the feature/functionality in simple English.
- Write a short simple summary that even a non-technical person can understand.
- Identify the PRIMARY ACTOR and PRIMARY ACTION from the requirement.
- Infer the recommended testcase starter phrase, such as "Verify that the user" or "Verify that the admin".
- Identify the main business modules or areas involved.
- Identify whether the requirement clearly refers to a list page, details page, grid/table, popup/modal, or create/edit form when that context is present.
- Identify whether behavior depends on tenant settings, configuration toggles, feature flags, permissions, role differences, redirects, or login/MFA state when that context is present.
- Identify whether onboarding, account setup, customer/supplier/buyer/reseller actor differences, notifications/emails, exports/downloads, or API/network side effects are part of the requirement when that context is present.
- Identify whether accessibility, responsive/mobile behavior, cross-browser support, concurrency, performance/volume expectations, or deeper API/DB verification are part of the requirement when that context is present.
- Preserve exact labels, config keys, rule terms, and fixed behavior names from the requirement when they matter.
- Tell the tester WHAT to test.
- Tell the tester HOW to test it.
- Break the requirement into acceptance-criteria-style points.
- Highlight the highest-risk hotspots where bugs are most likely or most serious.

AC RULES:
- If explicit acceptance criteria are present, keep them in order and mark them as "Explicit AC".
- If there are no explicit AC bullets, derive requirement points carefully from the requirement text and mark them as "Derived Requirement Point".
- Do not invent features that are not present in the requirement.
- Do not invent admin/configuration screens, setup workflows, or modal behavior unless the requirement explicitly mentions them.
- Be concrete, practical, and tester-friendly.

ACTOR RULES:
- Use the actor explicitly stated in the requirement when available.
- If no actor is clearly stated, default to "user".
- The recommendedStarter must be an exact phrase such as "Verify that the user", "Verify that the admin", "Verify that the buyer", or "Verify that the tenant".

WRITING STYLE:
- Use simple, clear English.
- Avoid jargon where possible.
- Make each test suggestion specific and actionable.
- Focus on manual/browser-style testing guidance unless the requirement clearly points elsewhere.`;
async function analyzeRequirementText(aiSettings, requirement, featureName) {
  const generationMode = getGenerationMode(aiSettings);
  const profile = getGenerationModeProfile(generationMode);
  const strictRequirementMode = isStrictRequirementMode(aiSettings);
  const trimmedRequirement = String(requirement).trim();
  const cacheKey = await computeRequestCacheKey("shared-requirement-analysis", aiSettings, {
    version: REQUIREMENT_ANALYSIS_CACHE_VERSION,
    requirement: trimmedRequirement
  });
  const cached = getCachedRequest(cacheKey);
  if (cached) {
    return cached;
  }
  const result = await generateReviewedStructuredData({
    aiSettings,
    featureName,
    artifactLabel: "requirement analysis",
    systemPrompt: [
      requirementAnalysisSystemPrompt,
      "",
      `GENERATION STYLE MODE: ${profile.label}`,
      ...strictRequirementMode ? [
        "STRICT EXACT REQUIREMENT MODE:",
        "- Stay tightly aligned to exact labels, config keys, rule terms, and fixed behavior names from the requirement.",
        "- Do not replace exact requirement wording with generic examples or invented substitute values."
      ] : [],
      ...profile.analysisPromptLines.map((line) => `- ${line}`)
    ].join("\n"),
    userParts: [
      {
        type: "text",
        text: [
          `Generation style mode: ${profile.label}`,
          "",
          `Requirement to analyze:`,
          trimmedRequirement
        ].join("\n")
      }
    ],
    output: {
      name: "return_requirement_analysis",
      description: "Return a structured requirement analysis with testing guidance and naming hints.",
      schema: requirementAnalysisSchema
    },
    reviewThreshold: profile.reviewThreshold,
    reviewFocusLines: [
      "Check whether the explanation is simple but still precise.",
      "Check whether primary actor, primary action, and recommended testcase starter are requirement-driven.",
      "Check whether the acceptance-criteria breakdown is complete, practical, and useful for testcase design.",
      "Check whether module/page/list/detail/popup context was captured when the requirement clearly supports it.",
      "Check whether tenant-setting, permission, role, redirect, or MFA/login dependencies were captured when the requirement clearly supports them.",
      "Check whether onboarding, account setup, export/download, notification/email, API/network side effects, and buyer/customer/supplier/reseller actor differences were captured when the requirement clearly supports them.",
      "Check whether accessibility, responsive/mobile, cross-browser, concurrency, performance/volume, and deeper API/DB verification obligations were captured when the requirement clearly supports them.",
      ...strictRequirementMode ? [
        "Check whether exact labels, config keys, and fixed logic terms were preserved instead of replaced by generic examples."
      ] : [],
      "Check whether what-to-test and how-to-test guidance is concrete and senior-QA-worthy."
    ],
    correctionReminder: strictRequirementMode ? "Strengthen traceability, actor detection, risk focus, and practical testing guidance while staying tightly aligned to the exact requirement wording and fixed logic terms." : "Strengthen traceability, actor detection, risk focus, and practical testing guidance while keeping the explanation simple and requirement-driven."
  });
  setCachedRequest(cacheKey, result);
  return result;
}

// supabase/functions/_shared/testCaseSchema.ts
var TEST_CASE_PRIORITY_VALUES = ["Critical", "High", "Medium", "Low"];
var TEST_CASE_TYPE_VALUES = ["Positive", "Negative"];
var testCaseItemSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Test case ID like TC_001" },
    requirementReference: {
      type: "string",
      description: "Requirement line, acceptance criteria ID, or derived point ID like AC-01 or REQ-03."
    },
    module: {
      type: "string",
      description: "Clean functional module, page, list view, details view, popup, or feature area name, for example Login, Checkout, Vendor List, Purchase Order Details, or Create Charge Popup."
    },
    priority: {
      type: "string",
      enum: TEST_CASE_PRIORITY_VALUES,
      description: "Business/testing priority: Critical, High, Medium, or Low."
    },
    coverageArea: {
      type: "string",
      description: "Specific functional area or scenario cluster being covered."
    },
    scenario: { type: "string", description: "Brief scenario description" },
    testCase: {
      type: "string",
      description: "Professional test case title, typically starting with Verify that the <actor>..."
    },
    testData: {
      type: "string",
      description: "Concrete data setup or values to use while executing the test."
    },
    preconditions: { type: "string", description: "Preconditions for the test" },
    testSteps: { type: "string", description: "Numbered execution steps" },
    expectedResult: {
      type: "string",
      description: "Expected outcome in professional QA style. Prefer short, direct, observable results over long padded paragraphs."
    },
    postCondition: {
      type: "string",
      description: "State of the system or data after test completion. Use Not Applicable where needed."
    },
    type: { type: "string", enum: TEST_CASE_TYPE_VALUES }
  },
  required: [
    "id",
    "requirementReference",
    "module",
    "priority",
    "coverageArea",
    "scenario",
    "testCase",
    "testData",
    "preconditions",
    "testSteps",
    "expectedResult",
    "postCondition",
    "type"
  ],
  additionalProperties: false
};
var testCaseCollectionSchema = {
  type: "object",
  properties: {
    testCases: {
      type: "array",
      items: testCaseItemSchema
    }
  },
  required: ["testCases"],
  additionalProperties: false
};
function normalizeGeneratedTestCases(rawCases) {
  return rawCases.filter((item) => !!item && typeof item === "object").map((item, index) => ({
    id: normalizeString(item.id, `TC_${String(index + 1).padStart(3, "0")}`),
    requirementReference: normalizeString(item.requirementReference, `REQ-${String(index + 1).padStart(2, "0")}`),
    module: normalizeString(item.module, "General"),
    priority: normalizePriority(item.priority),
    coverageArea: normalizeString(item.coverageArea),
    scenario: normalizeString(item.scenario),
    testCase: normalizeString(item.testCase),
    testData: normalizeString(item.testData, "Relevant valid and invalid data as per requirement"),
    preconditions: normalizeString(item.preconditions),
    testSteps: normalizeString(item.testSteps),
    expectedResult: normalizeString(item.expectedResult),
    postCondition: normalizeString(item.postCondition, "Not Applicable"),
    type: item.type === "Negative" ? "Negative" : "Positive"
  })).filter(
    (tc) => tc.requirementReference && tc.module && tc.coverageArea && tc.scenario && tc.testCase && tc.testData && tc.preconditions && tc.testSteps && tc.expectedResult && tc.postCondition
  );
}
function deduplicateGeneratedTestCases(testCases) {
  const seen = /* @__PURE__ */ new Map();
  return testCases.filter((testCase) => {
    const normalizedTitle = normalizeTitleForComparison(testCase.testCase);
    if (!normalizedTitle) return false;
    if (seen.has(normalizedTitle)) return false;
    for (const [existingTitle] of seen) {
      const words1 = new Set(normalizedTitle.split(" "));
      const words2 = new Set(existingTitle.split(" "));
      const intersection = [...words1].filter((word) => words2.has(word)).length;
      const union = (/* @__PURE__ */ new Set([...words1, ...words2])).size;
      if (union > 0 && intersection / union > 0.9) return false;
    }
    seen.set(normalizedTitle, 1);
    return true;
  });
}
function normalizeString(value, fallback = "") {
  return String(value ?? fallback).trim();
}
function normalizePriority(value) {
  return value === "Critical" || value === "High" || value === "Medium" || value === "Low" ? value : "Medium";
}
function normalizeTitleForComparison(value) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// supabase/functions/_shared/generateTestCasePipeline.ts
var GENERATE_CACHE_VERSION = "generate-test-cases-2026-04-08-v8";
var INPUT_TYPE_PROMPTS = {
  requirement: `You are a senior QA engineer with 15+ years of manual testing experience.

Think like a REAL HUMAN TESTER who tests the feature step by step in the browser.

HOW A SENIOR QA THINKS:
- Follow the end-to-end workflow from start to finish.
- Cover validations, permissions, UI behavior, navigation, persistence, and impact on related features.
- Read every line of the requirement carefully and do not skip statuses, authorities, conditions, or messages.
- Prefer meaningful user-action test cases, not tiny micro-checks.

STRICT RULES:
- Do not invent roles or authorities that are not in the requirement.
- Do not generate API-level penetration/security attack test cases.
- The first test case must be the primary business action of the feature.
- The number of test cases must scale with requirement complexity.
- Every acceptance criteria point or derived requirement point must be covered.

EXPECTED RESULT STYLE:
- Write like a professional QA tester.
- Never use the words "system", "application", "should", or "successfully".
- Use direct language such as "User redirected to dashboard" or "Error message displayed: 'Invalid password'".`,
  highlevel: `You are a senior QA engineer generating HIGH LEVEL smoke and sanity test cases.

RULES:
- Cover the main functionality, core validations, and the most important negative flows.
- Keep the suite concise but still professional and traceable.
- Every test case must still map back to a requirement point.
- Use enterprise-ready fields and practical manual-testing language.`,
  testcase: `You are a senior QA engineer completing partially written test cases.

RULES:
- Keep the original test case intent exactly the same.
- Fill the remaining fields so the testcase reads like an enterprise QA artifact.
- Strengthen weak preconditions, test data, steps, and expected results without changing the business meaning.`,
  scenario: `You are a senior QA engineer generating a full testcase suite from a scenario description.

RULES:
- Think like a manual tester walking through the feature from start to finish.
- Include happy path, validation, permission, edge, and data-persistence checks.
- Keep the titles professional, business-focused, and traceable to scenario details.`,
  expected: `You are a senior QA engineer generating expected results.

RULES:
- Return complete testcase rows with especially strong expected results.
- Expected results must be direct, observable, and professional.
- Do not use vague wording such as "works properly" or "successfully".`
};
async function computeGenerateCacheKey(input, inputType, imageCount, aiSettings) {
  return await computeRequestCacheKey(`generate-test-cases::${GENERATE_CACHE_VERSION}`, aiSettings, {
    inputType,
    input: input.trim().toLowerCase(),
    imageCount
  });
}
function buildSystemPrompt(inputType, generationMode, strictRequirementMode) {
  const profile = getGenerationModeProfile(generationMode);
  const lines = [
    INPUT_TYPE_PROMPTS[inputType] || INPUT_TYPE_PROMPTS.requirement,
    "",
    `GENERATION STYLE MODE: ${profile.label}`,
    ...profile.generatorPromptLines.map((line) => `- ${line}`),
    "- Think like a strong senior manual QA who separates meaningful validation, boundary, navigation, persistence, permission, and downstream-impact checks instead of collapsing them into a tiny suite.",
    "- Prefer fuller practical coverage for form-based and CRUD flows when the requirement supports it.",
    "- When list, table, grid, search, filter, sort, page, or details-view behavior is present, cover those user-visible behaviors explicitly instead of assuming they are implied.",
    "- When permissions or authorities are present, keep permission-pair coverage explicit and exact instead of hiding it inside broad generic rows.",
    "- When tenant settings, feature flags, enabled/disabled states, or policy toggles drive behavior, cover those state combinations explicitly.",
    "- When login, MFA, OTP, authentication, redirect, or enrollment behavior is present, cover redirect targets, visible messages, and role-specific flows explicitly.",
    "- When onboarding, account setup, customer/supplier/buyer/reseller actors, notifications, emails, exports, or API/network-driven side effects are present, keep those scenario clusters explicit instead of implied.",
    "- When a requirement is medium or large, favor a broad realistic suite over a compressed minimalist suite."
  ];
  if (strictRequirementMode) {
    lines.push(
      "- STRICT EXACT REQUIREMENT MODE is enabled.",
      "- Stay tightly anchored to the stated requirement, acceptance criteria, labels, config keys, rule names, and fixed logic terms.",
      "- Do not invent derived UI/setup/configuration flows unless they are an immediate tester-level extension of a stated behavior.",
      "- When the requirement contains exact labels, config keys, or logic names, preserve them throughout the suite instead of replacing them with generic examples."
    );
  }
  return lines.join("\n");
}
function isFormLikeRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "field",
    "form",
    "save",
    "cancel",
    "description",
    "name",
    "sku",
    "code",
    "active",
    "inactive",
    "button",
    "page",
    "list",
    "create",
    "new",
    "details"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  return hitCount >= 4 || (insights?.acceptanceCriteria.length ?? 0) >= 6;
}
function isListLikeRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "list",
    "grid",
    "table",
    "search",
    "filter",
    "sort",
    "column",
    "row",
    "details page",
    "details view",
    "results",
    "pagination",
    "empty state"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}
function isConfigLikeRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "tenant",
    "setting",
    "settings",
    "enabled",
    "disabled",
    "toggle",
    "configuration",
    "config",
    "feature flag",
    "preview permission",
    "manage permission"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}
function isAuthLikeRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "login",
    "log in",
    "sign in",
    "password",
    "otp",
    "mfa",
    "authentication",
    "redirect",
    "enrollment",
    "snackbar",
    "invalid username"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}
function isSideEffectRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "export",
    "download",
    "import",
    "email",
    "notification",
    "toast",
    "snackbar",
    "api",
    "network",
    "sync",
    "lambda",
    "webhook",
    "audit log",
    "background job",
    "response",
    "request"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}
function isOnboardingLikeRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "onboarding",
    "setup",
    "account setting",
    "account settings",
    "profile",
    "configuration",
    "config",
    "preference",
    "tenant setting"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}
function hasMultiActorSignals(input, insights) {
  const lower = input.toLowerCase();
  const signals = ["buyer", "supplier", "customer", "reseller", "vendor", "admin", "tenant", "user"];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 2 || criteriaHitCount >= 2;
}
function isAccessibilityRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "accessibility",
    "keyboard",
    "focus",
    "tab key",
    "screen reader",
    "aria",
    "label",
    "accessible"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}
function isResponsiveRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "responsive",
    "mobile",
    "tablet",
    "desktop",
    "touch",
    "small screen",
    "viewport",
    "orientation"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}
function isBrowserCompatibilityRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "browser",
    "chrome",
    "edge",
    "firefox",
    "safari",
    "cross-browser"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}
function isConcurrencyRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "concurrent",
    "same record",
    "another user",
    "multi-user",
    "double click",
    "double submit",
    "stale",
    "conflict",
    "lock"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}
function isPerformanceRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "performance",
    "large data",
    "large volume",
    "slow",
    "loading",
    "spinner",
    "timeout",
    "heavy list",
    "bulk"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}
function isApiDbRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "api",
    "request payload",
    "response",
    "database",
    "db",
    "rollback",
    "retry",
    "persistence",
    "duplicate save"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 1 || criteriaHitCount >= 1;
}
function buildClassicCoverageChecklist(input, insights) {
  if (!isFormLikeRequirement(input, insights)) {
    return [];
  }
  return [
    "For this form-style / CRUD-style requirement, behave like a classic strong manual QA and cover the feature more broadly.",
    "Explicitly include separate meaningful cases for: navigation entry, page title/breadcrumbs, default values, create success, duplicate handling, save-button enable/disable rules, cancel behavior, read-only behavior after creation, active/inactive downstream visibility, and description/data reflection where relevant.",
    "Also include practical derived QA cases for field boundaries and usability where relevant: maximum length, over-maximum length, valid special characters, whitespace handling, tab order, toggle persistence before save, and repeated sequential creation.",
    "Do not drop these derived manual-testing cases merely because they are not written as explicit AC bullets when they are a natural tester-level extension of the requirement.",
    "Keep distinct scenario clusters separate instead of merging them into a few broad cases.",
    "For medium-complexity form requirements like this, target a broad senior-QA suite, usually around 30 to 35 test cases unless the requirement is truly tiny."
  ];
}
function buildListCoverageChecklist(input, insights) {
  if (!isListLikeRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has list, grid, table, or page-behavior signals. Cover it the way a strong senior QA would, not just the core happy path.",
    "Explicitly include meaningful cases for default sort, reverse sort, filter/search behavior, empty state, row selection or row-click navigation, and details-page reflection where relevant.",
    "If columns, statuses, badges, buttons, or actions are visible in the list view, cover their visibility, state behavior, and permission-driven access when relevant.",
    "Keep list behavior, navigation behavior, and downstream data-reflection behavior separate when they represent different real user risks."
  ];
}
function buildConfigCoverageChecklist(input, insights) {
  if (!isConfigLikeRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has tenant-setting, configuration, feature-flag, or enabled/disabled behavior. Cover both visibility and behavior changes, not just one happy path.",
    "Explicitly include meaningful cases for enabled vs disabled settings, allowed vs unauthorized users, and the resulting visible or hidden UI/actions when those represent different outcomes.",
    "When a feature depends on both a setting and a permission, keep the combinations separate instead of merging them into one broad testcase."
  ];
}
function buildAuthCoverageChecklist(input, insights) {
  if (!isAuthLikeRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has login, MFA, OTP, authentication, or redirect behavior. Cover valid and invalid entry paths, redirect behavior, setup/enrollment screens, and user-facing messages when they are relevant.",
    "Explicitly include meaningful cases for tenant mode or policy on/off, role-specific user behavior, correct redirect target, and visible explanatory messages or errors when those are part of the flow.",
    "Keep authentication state, message validation, and redirect validation separate when they represent different real risks."
  ];
}
function buildSideEffectCoverageChecklist(input, insights) {
  if (!isSideEffectRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has export, import, email, notification, API/network, or background side-effect behavior.",
    "Keep trigger behavior, visible feedback, generated output, and reflected downstream state as separate checks when they represent different real risks.",
    "If export or download exists, cover action availability, generated output, and post-action reflection or visibility where relevant.",
    "If notification, email, toast, or snackbar behavior exists, cover the exact trigger condition, visible message or delivery outcome, and non-trigger behavior when relevant.",
    "If API/network or sync behavior exists, cover the user-visible or business-visible result of that side effect instead of assuming the backend outcome is automatically implied."
  ];
}
function buildOnboardingCoverageChecklist(input, insights) {
  if (!isOnboardingLikeRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has onboarding, account setup, or settings/configuration behavior.",
    "Cover setup entry, field/state behavior, save/apply behavior, persisted state after refresh, and downstream reflection in the affected module when relevant.",
    "If the flow depends on tenant settings, account status, or configuration combinations, keep those combinations explicit instead of implied."
  ];
}
function buildMultiActorCoverageChecklist(input, insights) {
  if (!hasMultiActorSignals(input, insights)) {
    return [];
  }
  return [
    "This requirement has multiple actor or role signals such as buyer, supplier, customer, reseller, vendor, admin, tenant, or user.",
    "Keep actor-specific visibility, action behavior, redirect behavior, and reflected outcomes separate when different actors experience different results.",
    "Do not merge actor-specific scenarios into one generic testcase if the requirement suggests different risks or outcomes by role."
  ];
}
function buildAccessibilityCoverageChecklist(input, insights) {
  if (!isAccessibilityRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has accessibility, keyboard, focus, label, or ARIA signals.",
    "Cover keyboard navigation, focus order/visibility, labels or accessible names, and accessible error or dialog behavior when relevant.",
    "Keep accessibility behavior separate from generic visual checks when the risk is different."
  ];
}
function buildResponsiveCoverageChecklist(input, insights) {
  if (!isResponsiveRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has responsive, mobile, tablet, desktop, or touch-behavior signals.",
    "Cover desktop/tablet/mobile differences, overflow or truncation issues, touch behavior, and small-screen visibility/layout changes when relevant.",
    "Keep responsive or touch behavior separate from standard desktop-only checks when the risk is different."
  ];
}
function buildBrowserCompatibilityChecklist(input, insights) {
  if (!isBrowserCompatibilityRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has browser-compatibility signals.",
    "Cover the intended browser set explicitly and keep browser-specific control, layout, upload/download, or date-input behavior separate when relevant."
  ];
}
function buildConcurrencyCoverageChecklist(input, insights) {
  if (!isConcurrencyRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has concurrency, multi-user, stale-data, or duplicate-submit signals.",
    "Cover same-record updates by multiple users, stale data handling, conflict behavior, and duplicate click/submit protection when relevant.",
    "Keep conflict handling and duplicate-submit protection separate when they represent different real risks."
  ];
}
function buildPerformanceCoverageChecklist(input, insights) {
  if (!isPerformanceRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has performance, heavy-data, loading-state, or slowness signals.",
    "Cover slow response handling, spinner/loading-state quality, large-data usability, and degraded-but-usable behavior when relevant.",
    "Keep performance/loading behavior separate from final data correctness when they represent different risks."
  ];
}
function buildApiDbCoverageChecklist(input, insights) {
  if (!isApiDbRequirement(input, insights)) {
    return [];
  }
  return [
    "This requirement has API, DB, payload, response, retry, rollback, or persistence-verification signals.",
    "Cover request/response handling, persistence/reflected state, retry or failure handling, rollback or partial-save handling, and duplicate-save protection when relevant.",
    "Keep user-visible or business-visible effects explicit instead of assuming the backend result is automatically understood."
  ];
}
function extractExactRequirementTerms(input) {
  const camelCaseTerms = [...input.matchAll(/\b[a-z]+(?:[A-Z][a-zA-Z0-9]+)+\b/g)].map((match) => match[0]);
  const snakeCaseTerms = [...input.matchAll(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g)].map((match) => match[0]);
  const allCapsTerms = [...input.matchAll(/\b[A-Z]{2,}(?:_[A-Z0-9]+)*\b/g)].map((match) => match[0]);
  const quotedTerms = [...input.matchAll(/["']([A-Za-z0-9_\- ]{2,})["']/g)].map((match) => match[1].trim());
  const specificLabels = ["ALL", "textRules", "numericRules"].filter((term) => input.includes(term));
  return [
    ...new Set(
      [...camelCaseTerms, ...snakeCaseTerms, ...allCapsTerms, ...quotedTerms, ...specificLabels].filter((term) => term.length >= 3).filter((term) => term.toLowerCase() !== "story")
    )
  ].slice(0, 20);
}
function isConfigDrivenFilterRequirement(input, insights) {
  const lower = input.toLowerCase();
  const signals = [
    "filter",
    "filters",
    "pill",
    "pills",
    "all filter",
    "orderlistgroups",
    "orderlistgroupstoinclude",
    "fulfillmentstatustoinclude",
    "textrules",
    "numericrules",
    "or behavior",
    "duplicate results"
  ];
  const hitCount = signals.filter((signal) => lower.includes(signal)).length;
  const criteriaText = insights?.acceptanceCriteria.map((point) => point.criterion.toLowerCase()).join(" ") || "";
  const criteriaHitCount = signals.filter((signal) => criteriaText.includes(signal)).length;
  return hitCount >= 4 || criteriaHitCount >= 3;
}
function buildRequirementFidelityChecklist(input, strictRequirementMode) {
  const exactTerms = extractExactRequirementTerms(input);
  if (exactTerms.length === 0) {
    return [];
  }
  const checklist = [
    `The requirement contains exact labels, config keys, or technical terms: ${exactTerms.join(", ")}.`,
    "Keep exact requirement terms visible where they matter instead of replacing them with generic examples or made-up business values.",
    "If the requirement defines named labels, config keys, rules, flags, or fixed filter values, create cases around those exact behaviors instead of drifting into a generic feature interpretation."
  ];
  if (strictRequirementMode) {
    checklist.push(
      "Strict exact requirement mode is enabled, so preserve most or all of those exact terms when they represent real user-visible or rule-driven behavior.",
      "Do not replace exact requirement values with placeholder examples, generic labels, or renamed business terms."
    );
  }
  return checklist;
}
function buildConfigDrivenFilterChecklist(input, insights, strictRequirementMode) {
  if (!isConfigDrivenFilterRequirement(input, insights)) {
    return [];
  }
  const checklist = [
    "This is a config-driven list/filter behavior requirement. Keep the testcase suite centered on the target list page behavior, not on an invented configuration-management UI.",
    "Create direct cases for exact filter rendering behavior such as clickable pills, ALL visibility rules, default selected state, configured order, single-select behavior, multi-select OR behavior, and ALL clearing other filters when those are stated.",
    "Create direct cases for exact rule-evaluation behavior such as OR across rules, AND within a rule, missing attributes evaluating false, invalid config entries being ignored, coexistence with existing status filters, and duplicate results not appearing when those are stated.",
    "Do not invent admin/configuration screens, add/remove filter workflows, unsaved-changes modals, hierarchical grouping, expand-collapse sections, or generic sample grouping values unless the requirement explicitly mentions them.",
    "When the requirement names exact config keys, logic terms, or fixed labels, preserve them in coverage instead of replacing them with placeholder values like Region or Product Category."
  ];
  if (strictRequirementMode) {
    checklist.push(
      "Strict exact requirement mode is enabled, so keep testcase wording tightly aligned to the stated filter names, config keys, rule terms, and acceptance-criteria logic."
    );
  }
  return checklist;
}
function extractAuthorities(text) {
  const upperKeywords = ["CAN_", "HAS_", "ALLOW_", "MANAGE_", "VIEW_", "EDIT_", "DELETE_", "CREATE_", "APPROVE_", "REJECT_", "READ_", "WRITE_", "ACCESS_"];
  const upperCaseMatches = text.split(/[\s,;:()[\]{}|"'`]+/).map((token) => token.replace(/^[^A-Z_]+|[^A-Z_]+$/g, "")).filter((token) => token.length > 3 && /^[A-Z_]+$/.test(token)).filter((token) => upperKeywords.some((keyword) => token.includes(keyword)));
  const camelRegex = /\b(can|has|allow|manage|view|edit|delete|create|approve|reject|access)[A-Z][a-zA-Z]{2,}\b/g;
  const camelMatches = [...text.matchAll(camelRegex)].map((match) => match[0]);
  return [.../* @__PURE__ */ new Set([...upperCaseMatches, ...camelMatches])];
}
function buildAuthorityCoverageChecklist(text) {
  const authorities = extractAuthorities(text);
  if (authorities.length === 0) {
    return [];
  }
  return [
    `The requirement explicitly references authorities or permissions: ${authorities.join(", ")}.`,
    "Include separate meaningful permission cases for with-authority, without-authority, wrong-authority, action visibility, and action execution whenever those represent different real user outcomes.",
    "Keep permission names exact. Do not paraphrase, invent, or generalize them away."
  ];
}
function detectPrimaryAction(input) {
  const actionVerbs = [
    "export",
    "import",
    "cancel",
    "create",
    "delete",
    "update",
    "edit",
    "approve",
    "reject",
    "assign",
    "submit",
    "upload",
    "download",
    "archive",
    "activate",
    "deactivate",
    "send",
    "generate",
    "publish",
    "transfer",
    "merge",
    "split",
    "clone",
    "duplicate",
    "restore",
    "revoke",
    "suspend",
    "enable",
    "disable",
    "login",
    "log in",
    "sign in"
  ];
  const lower = input.toLowerCase();
  for (const verb of actionVerbs) {
    if (lower.includes(verb)) return verb.replace(/\s+/g, " ");
  }
  return null;
}
function estimateMinimumTestCases(inputType, input, insights) {
  if (inputType === "highlevel") {
    return Math.max(10, Math.min(20, (insights?.acceptanceCriteria.length ?? 0) * 2 || 10));
  }
  if (inputType === "testcase" || inputType === "expected") {
    return 1;
  }
  const bulletRegex = /^\s*[-*•]\s|^\s*\d+[.)]\s/;
  const normalizedInput = input.replaceAll("\u2022", "-");
  const bulletLines = normalizedInput.split("\n").filter((line) => bulletRegex.test(line)).length;
  const paragraphCount = input.split(/\n\s*\n/).filter((paragraph) => paragraph.trim().length > 0).length;
  const acCount = insights?.acceptanceCriteria.length ?? 0;
  const formLike = isFormLikeRequirement(input, insights);
  const hasAuthorities = extractAuthorities(input).length > 0;
  const listLike = isListLikeRequirement(input, insights);
  const onboardingLike = isOnboardingLikeRequirement(input, insights);
  const sideEffectLike = isSideEffectRequirement(input, insights);
  const multiActorLike = hasMultiActorSignals(input, insights);
  const accessibilityLike = isAccessibilityRequirement(input, insights);
  const responsiveLike = isResponsiveRequirement(input, insights);
  const browserLike = isBrowserCompatibilityRequirement(input, insights);
  const concurrencyLike = isConcurrencyRequirement(input, insights);
  const performanceLike = isPerformanceRequirement(input, insights);
  const apiDbLike = isApiDbRequirement(input, insights);
  let baseline = formLike ? 24 : 15;
  if (bulletLines >= 5 || input.length > 1e3 || paragraphCount >= 3) baseline = 20;
  if (bulletLines >= 10 || input.length > 2e3 || paragraphCount >= 6) baseline = 30;
  if (bulletLines >= 15 || input.length > 3e3) baseline = 40;
  if (acCount > 0) baseline = Math.max(baseline, Math.min(70, acCount * 2));
  if (formLike) baseline = Math.max(baseline, 28);
  if (formLike && hasAuthorities) baseline = Math.max(baseline, 30);
  if (formLike && (input.length > 1200 || acCount >= 8)) baseline = Math.max(baseline, 32);
  if (listLike) baseline = Math.max(baseline, 24);
  if (onboardingLike) baseline = Math.max(baseline, 22);
  if (sideEffectLike) baseline = Math.max(baseline, 22);
  if (multiActorLike) baseline = Math.max(baseline, 22);
  if (accessibilityLike) baseline = Math.max(baseline, 18);
  if (responsiveLike) baseline = Math.max(baseline, 18);
  if (browserLike) baseline = Math.max(baseline, 16);
  if (concurrencyLike) baseline = Math.max(baseline, 18);
  if (performanceLike) baseline = Math.max(baseline, 18);
  if (apiDbLike) baseline = Math.max(baseline, 18);
  return baseline;
}
function validateGeneratedCases(inputType, input, testCases, insights, strictRequirementMode) {
  const violations = [];
  if (testCases.length === 0) {
    violations.push("No test cases were generated.");
    return { valid: false, violations };
  }
  const minimum = estimateMinimumTestCases(inputType, input, insights);
  if (testCases.length < minimum) {
    violations.push(`Generated only ${testCases.length} test cases, expected at least ${minimum} for this requirement size.`);
  }
  if (inputType !== "testcase" && inputType !== "expected") {
    const hasPositive = testCases.some((testCase) => testCase.type === "Positive");
    const hasNegative = testCases.some((testCase) => testCase.type === "Negative");
    if (!hasPositive || !hasNegative) {
      violations.push("Output must include both Positive and Negative test cases.");
    }
  }
  const missingEnterpriseFields = testCases.filter(
    (testCase) => !testCase.requirementReference || !testCase.module || !testCase.priority || !testCase.testData || !testCase.postCondition
  );
  if (missingEnterpriseFields.length > 0) {
    violations.push("Some test cases are missing enterprise fields like requirementReference, module, priority, testData, or postCondition.");
  }
  const invalidTitles = testCases.filter((testCase) => {
    const lower = testCase.testCase.toLowerCase();
    return !(lower.startsWith("verify that") || lower.startsWith("validate that") || lower.startsWith("ensure that") || lower.startsWith("verify if"));
  });
  if (invalidTitles.length > Math.ceil(testCases.length * 0.25)) {
    violations.push('Too many test case titles do not use professional QA starters like "Verify that", "Validate that", or "Ensure that".');
  }
  if (insights?.recommendedStarter) {
    const preferredStarter = insights.recommendedStarter.toLowerCase();
    const preferredCount = testCases.filter((testCase) => testCase.testCase.toLowerCase().startsWith(preferredStarter)).length;
    if (preferredCount === 0) {
      violations.push(`No test case starts with the preferred actor-based phrase "${insights.recommendedStarter}".`);
    }
  }
  if (inputType === "requirement") {
    const primaryAction = insights?.primaryAction || detectPrimaryAction(input);
    const firstCase = testCases[0]?.testCase?.toLowerCase() || "";
    if (primaryAction && !firstCase.includes(primaryAction.toLowerCase())) {
      violations.push(`TC_001 does not reference the primary action "${primaryAction}" from the requirement.`);
    }
  }
  const authorities = extractAuthorities(input);
  if (authorities.length > 0) {
    const combinedText2 = JSON.stringify(testCases);
    const missingAuthorities = authorities.filter((authority) => !combinedText2.includes(authority));
    if (missingAuthorities.length > 0) {
      violations.push(`Missing explicit authority coverage for: ${missingAuthorities.join(", ")}.`);
    }
    const foundAuthorities = extractAuthorities(combinedText2);
    const unauthorizedAuthorities = foundAuthorities.filter((authority) => !authorities.includes(authority));
    if (unauthorizedAuthorities.length > 0) {
      violations.push(`Contains invented authorities not present in requirement: ${unauthorizedAuthorities.join(", ")}.`);
    }
  }
  if (insights?.acceptanceCriteria?.length) {
    const missingPointIds = insights.acceptanceCriteria.map((point) => point.id).filter((pointId) => !testCases.some((testCase) => testCase.requirementReference.includes(pointId)));
    if (missingPointIds.length > 0) {
      violations.push(`Requirement references missing from testcase suite: ${missingPointIds.join(", ")}.`);
    }
  }
  const combinedText = JSON.stringify(testCases);
  const exactTerms = extractExactRequirementTerms(input);
  if (exactTerms.length >= 3) {
    const preservedTermCount = exactTerms.filter((term) => combinedText.includes(term)).length;
    const minimumPreservedTerms = strictRequirementMode ? Math.min(exactTerms.length, Math.max(3, Math.ceil(exactTerms.length * 0.6))) : Math.min(3, exactTerms.length);
    if (preservedTermCount < minimumPreservedTerms) {
      violations.push("Generated suite dropped too many exact requirement terms/labels and appears to be drifting into generic coverage.");
    }
  }
  if (isConfigDrivenFilterRequirement(input, insights)) {
    const lowerCombined = combinedText.toLowerCase();
    const inventedUiSignals = [
      "configuration interface",
      "configuration modal",
      "unsaved changes",
      "add a new grouping filter",
      "remove an existing grouping filter",
      "hierarchical groups",
      "expand or collapse grouped sections"
    ];
    const foundInventedSignals = inventedUiSignals.filter((signal) => lowerCombined.includes(signal));
    if (foundInventedSignals.length > 0) {
      violations.push(`Suite invented configuration-management behavior not stated in the requirement: ${foundInventedSignals.join(", ")}.`);
    }
    if (strictRequirementMode) {
      const placeholderTerms = ["region", "sales rep", "product category"];
      const inventedPlaceholders = placeholderTerms.filter(
        (term) => lowerCombined.includes(term) && !input.toLowerCase().includes(term)
      );
      if (inventedPlaceholders.length > 0) {
        violations.push(
          `Suite replaced exact config-driven filter behavior with generic placeholder values: ${inventedPlaceholders.join(", ")}.`
        );
      }
    }
  }
  return { valid: violations.length === 0, violations };
}
function buildInsightSummary(insights) {
  if (!insights) return "";
  const acceptanceCriteriaLines = insights.acceptanceCriteria.map(
    (point) => `${point.id} [${point.sourceType}] [${point.priority}] [${point.moduleHint}] ${point.criterion}
Meaning: ${point.plainEnglishMeaning}
What to test: ${point.whatToTest.join(" | ")}
How to test: ${point.howToTest.join(" | ")}`
  ).join("\n\n");
  return [
    "Requirement intelligence:",
    `- Functionality explanation: ${insights.functionalityExplanation}`,
    `- Simple summary: ${insights.simpleSummary}`,
    `- Primary actor: ${insights.primaryActor}`,
    `- Primary action: ${insights.primaryAction}`,
    `- Recommended testcase starter: ${insights.recommendedStarter}`,
    `- Business modules: ${insights.businessModules.join(", ") || "General"}`,
    `- Main flow: ${insights.mainFlow.join(" -> ")}`,
    `- Risk hotspots: ${insights.riskHotspots.join(" | ") || "None identified"}`,
    `- Important notes: ${insights.importantNotes.join(" | ") || "None"}`,
    "",
    "Acceptance criteria / derived requirement points:",
    acceptanceCriteriaLines || "No structured requirement points available."
  ].join("\n");
}
function buildInstructionText(input, images, inputType, insights, generationMode, strictRequirementMode) {
  const profile = getGenerationModeProfile(generationMode);
  const preferredStarter = insights?.recommendedStarter || "Verify that the user";
  const formLike = isFormLikeRequirement(input, insights);
  const listLike = isListLikeRequirement(input, insights);
  const listCoverageChecklist = buildListCoverageChecklist(input, insights);
  const authorityCoverageChecklist = buildAuthorityCoverageChecklist(input);
  const configCoverageChecklist = buildConfigCoverageChecklist(input, insights);
  const authCoverageChecklist = buildAuthCoverageChecklist(input, insights);
  const sideEffectCoverageChecklist = buildSideEffectCoverageChecklist(input, insights);
  const onboardingCoverageChecklist = buildOnboardingCoverageChecklist(input, insights);
  const multiActorCoverageChecklist = buildMultiActorCoverageChecklist(input, insights);
  const requirementFidelityChecklist = buildRequirementFidelityChecklist(input, strictRequirementMode);
  const configDrivenFilterChecklist = buildConfigDrivenFilterChecklist(input, insights, strictRequirementMode);
  const accessibilityCoverageChecklist = buildAccessibilityCoverageChecklist(input, insights);
  const responsiveCoverageChecklist = buildResponsiveCoverageChecklist(input, insights);
  const browserCoverageChecklist = buildBrowserCompatibilityChecklist(input, insights);
  const concurrencyCoverageChecklist = buildConcurrencyCoverageChecklist(input, insights);
  const performanceCoverageChecklist = buildPerformanceCoverageChecklist(input, insights);
  const apiDbCoverageChecklist = buildApiDbCoverageChecklist(input, insights);
  const lines = [
    "Generate enterprise-quality test cases in structured form.",
    "Return the complete testcase suite with these exact fields for every row: id, requirementReference, module, priority, coverageArea, scenario, testCase, testData, preconditions, testSteps, expectedResult, postCondition, type.",
    "Do not return markdown or commentary.",
    "",
    `GENERATION STYLE MODE: ${profile.label}`,
    ...profile.generatorPromptLines.map((line) => `- ${line}`),
    "",
    "MANDATORY OUTPUT QUALITY RULES:",
    "- Read every line of the requirement and map each acceptance criteria point to one or more test cases.",
    "- Include both Positive and Negative scenarios where appropriate.",
    "- Do not invent roles, authorities, statuses, or features that are not in the requirement.",
    "- Make the suite read like a senior QA deliverable, not generic AI output.",
    "- Use clean module, page, modal, popup, list, or details-view names instead of vague generic labels whenever the requirement supports a clearer name.",
    "- Use practical business modules, priority, test data, and post-condition fields.",
    "- requirementReference must point to AC IDs or derived requirement IDs such as AC-01 or REQ-03.",
    "- For standard functional cases, prefer the recommended actor-based starter phrase from requirement analysis.",
    "- Do not compress distinct meaningful checks into one case when a senior QA would keep them separate.",
    "- Include practical derived coverage beyond explicit AC wording when it is a natural manual-testing extension of the requirement.",
    "- If a requirement supports additional realistic field-validation or UI-behavior coverage, include it instead of stopping at the minimum explicit AC count.",
    "- Expected results should usually be short, direct, and observable. Prefer clean execution-ready outcomes over long padded paragraphs.",
    "- When settings, permissions, roles, or statuses combine to change behavior, keep those combinations explicit if they create different real outcomes.",
    "- When exports, notifications, emails, downloads, API/network-driven updates, or downstream reflection are part of the requirement, make those side effects explicit.",
    "- When onboarding, account setup, or multi-actor behavior is present, keep role-specific and persisted-state coverage explicit.",
    "- When accessibility, responsive/mobile, concurrency, performance, or browser support is part of the requirement, keep those obligations explicit instead of implied.",
    "- When API or DB verification is part of the requirement, keep request/response, persistence, retry/failure, and rollback behavior explicit when relevant.",
    "- When a requirement contains exact labels, config keys, rule terms, or fixed values, preserve those exact terms in the suite instead of replacing them with generic examples.",
    "- Do not invent a separate admin/configuration screen, modal, setup workflow, or settings editor unless the requirement explicitly describes one."
  ];
  if (strictRequirementMode) {
    lines.push(
      "- STRICT EXACT REQUIREMENT MODE is enabled for this run.",
      "- Stay tightly anchored to the stated requirement and acceptance-criteria wording.",
      "- Prefer exact behavior fidelity over broad inferred expansion when those two goals conflict.",
      "- Do not rename exact labels, config keys, rule terms, or fixed filter values into generic business examples."
    );
  }
  if (generationMode === "rob_style") {
    lines.push(
      `- Strongly prefer testcase titles that begin with "${preferredStarter}" or a closely matching actor-based phrase.`,
      "- Keep the writing human, practical, browser-focused, and close to a clean senior QA workbook style.",
      "- Make permission and authority wording exact whenever the requirement depends on it.",
      "- Keep expected results crisp, direct, and observable instead of padded.",
      "- Keep notification, email, export, and reflected-data outcomes practical and clearly visible in the testcase wording when they matter."
    );
  } else if (generationMode === "yuv_style") {
    lines.push(
      "- Keep the suite broad and execution-oriented with clear module, page, UI, and navigation coverage.",
      "- Separate meaningful list, table, sort, filter, state, and downstream-visibility checks when they represent different user risks.",
      "- Expand onboarding, settings, notification, export, and actor-specific flows the way a strong functional QA would.",
      "- Prefer stronger functional breadth over polished but narrow coverage."
    );
  } else if (generationMode === "swag_style") {
    lines.push(
      "- Keep the suite benchmark-driven and broad across common modern web-app UI patterns and business states.",
      "- Explicitly include reusable web-app QA patterns such as forms, inputs, dropdowns, radios, uploads, drag-and-drop, grids, filters, sorts, exports, refresh behavior, and persistence when relevant.",
      "- Treat onboarding, account setup, notifications, emails, export/network reflection, and multi-actor roles as first-class benchmark patterns when relevant.",
      "- Treat accessibility, responsive/mobile behavior, concurrency, performance/loading, deeper API/DB verification, and browser compatibility as first-class benchmark patterns when relevant.",
      "- Prefer benchmark-worthy completeness over narrow or over-compressed output."
    );
  } else {
    lines.push(
      "- Keep the suite formal, traceable, and ready for professional QA review boards or client sharing.",
      "- Make module names, priority, test data, and post-condition fields especially strong and useful.",
      "- Favor concise, enterprise-standard wording over casual phrasing."
    );
  }
  if (formLike) {
    lines.push(
      "- This is a form-style / CRUD-style requirement, so expand the suite the way a strong senior QA would.",
      "- Include separate practical cases for field validation, boundary length, duplicate handling, default values, save-button behavior, cancel/navigation behavior, and downstream data visibility where relevant.",
      "- If text or identifier fields are present, include realistic checks for max length, over-limit input, special characters, and leading/trailing spaces when those are meaningful to the requirement.",
      "- Keep boundary and UI/navigation cases separate if they represent different real user risks.",
      "- Target a fuller suite, typically around 28 to 35 cases for a medium-complexity form requirement unless the requirement is genuinely tiny."
    );
    lines.push(...buildClassicCoverageChecklist(input, insights).map((line) => `- ${line}`));
  }
  if (listLike) {
    lines.push(
      "- This requirement also has list/grid/table/page behavior, so include those scenarios explicitly instead of assuming they are covered by general functional cases."
    );
    lines.push(...listCoverageChecklist.map((line) => `- ${line}`));
  }
  if (authorityCoverageChecklist.length > 0) {
    lines.push(...authorityCoverageChecklist.map((line) => `- ${line}`));
  }
  if (configCoverageChecklist.length > 0) {
    lines.push(...configCoverageChecklist.map((line) => `- ${line}`));
  }
  if (authCoverageChecklist.length > 0) {
    lines.push(...authCoverageChecklist.map((line) => `- ${line}`));
  }
  if (sideEffectCoverageChecklist.length > 0) {
    lines.push(...sideEffectCoverageChecklist.map((line) => `- ${line}`));
  }
  if (onboardingCoverageChecklist.length > 0) {
    lines.push(...onboardingCoverageChecklist.map((line) => `- ${line}`));
  }
  if (multiActorCoverageChecklist.length > 0) {
    lines.push(...multiActorCoverageChecklist.map((line) => `- ${line}`));
  }
  if (requirementFidelityChecklist.length > 0) {
    lines.push(...requirementFidelityChecklist.map((line) => `- ${line}`));
  }
  if (configDrivenFilterChecklist.length > 0) {
    lines.push(...configDrivenFilterChecklist.map((line) => `- ${line}`));
  }
  if (accessibilityCoverageChecklist.length > 0) {
    lines.push(...accessibilityCoverageChecklist.map((line) => `- ${line}`));
  }
  if (responsiveCoverageChecklist.length > 0) {
    lines.push(...responsiveCoverageChecklist.map((line) => `- ${line}`));
  }
  if (browserCoverageChecklist.length > 0) {
    lines.push(...browserCoverageChecklist.map((line) => `- ${line}`));
  }
  if (concurrencyCoverageChecklist.length > 0) {
    lines.push(...concurrencyCoverageChecklist.map((line) => `- ${line}`));
  }
  if (performanceCoverageChecklist.length > 0) {
    lines.push(...performanceCoverageChecklist.map((line) => `- ${line}`));
  }
  if (apiDbCoverageChecklist.length > 0) {
    lines.push(...apiDbCoverageChecklist.map((line) => `- ${line}`));
  }
  if (insights) {
    lines.push("", buildInsightSummary(insights));
  }
  if (input.trim()) {
    lines.push("", "Requirement/Input:", input.trim());
  }
  if (images.length > 0) {
    lines.push(
      "",
      `Attached visual context: ${images.length} screenshot(s) or mockup(s). Analyze visible UI elements, buttons, forms, messages, and flows so the testcase suite covers both text and UI.`
    );
  }
  if (inputType === "testcase") {
    lines.push("", "Preserve the original testcase intent while upgrading the remaining fields.");
  }
  return lines.join("\n");
}
async function maybeAnalyzeRequirement(aiSettings, inputType, input) {
  if (!input.trim()) return null;
  if (inputType !== "requirement" && inputType !== "highlevel" && inputType !== "scenario") {
    return null;
  }
  try {
    return await analyzeRequirementText(aiSettings, input, "generate-test-cases-analysis");
  } catch (error) {
    console.warn("[generate-test-cases] requirement analysis skipped:", error);
    return null;
  }
}
async function callAiProvider(aiSettings, systemPrompt, userContent) {
  try {
    const parsed = await generateStructuredData({
      aiSettings,
      systemPrompt,
      userParts: userContent,
      featureName: "generate-test-cases",
      output: {
        name: "return_test_cases",
        description: "Return the generated test cases as structured data.",
        schema: testCaseCollectionSchema
      }
    });
    const normalized = deduplicateGeneratedTestCases(normalizeGeneratedTestCases(parsed.testCases || []));
    return { ok: true, testCases: normalized };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Failed to generate test cases";
    const lower = errorText.toLowerCase();
    const status = lower.includes("rate limit") ? 429 : lower.includes("credit") || lower.includes("payment") ? 402 : 500;
    return { ok: false, status, errorText };
  }
}
async function runGenerateTestCasePipeline({
  aiSettings,
  input,
  inputType,
  images,
  cacheKey,
  sendEvent
}) {
  const resolvedCacheKey = cacheKey === void 0 ? images.length === 0 ? await computeGenerateCacheKey(input, inputType, 0, aiSettings) : null : cacheKey;
  if (resolvedCacheKey) {
    const cached = getCachedRequest(resolvedCacheKey);
    if (cached) {
      sendEvent?.("finalizing", { message: "Loading cached results..." });
      return { testCases: cached, cached: true };
    }
  }
  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const strictRequirementMode = isStrictRequirementMode(aiSettings);
  sendEvent?.("reading", { message: "Reading requirement..." });
  const requirementInsights = await maybeAnalyzeRequirement(aiSettings, inputType, input || "");
  sendEvent?.("analyzing", {
    message: requirementInsights ? `Analyzing requirement deeply for actor, ACs, and risk areas in ${generationProfile.label} mode...` : `Analyzing input and planning testcase coverage in ${generationProfile.label} mode...`
  });
  const systemPrompt = buildSystemPrompt(inputType, generationMode, strictRequirementMode);
  const classicCoverageChecklist = buildClassicCoverageChecklist(input, requirementInsights);
  const listCoverageChecklist = buildListCoverageChecklist(input, requirementInsights);
  const authorityCoverageChecklist = buildAuthorityCoverageChecklist(input);
  const configCoverageChecklist = buildConfigCoverageChecklist(input, requirementInsights);
  const authCoverageChecklist = buildAuthCoverageChecklist(input, requirementInsights);
  const sideEffectCoverageChecklist = buildSideEffectCoverageChecklist(input, requirementInsights);
  const onboardingCoverageChecklist = buildOnboardingCoverageChecklist(input, requirementInsights);
  const multiActorCoverageChecklist = buildMultiActorCoverageChecklist(input, requirementInsights);
  const requirementFidelityChecklist = buildRequirementFidelityChecklist(input, strictRequirementMode);
  const configDrivenFilterChecklist = buildConfigDrivenFilterChecklist(input, requirementInsights, strictRequirementMode);
  const accessibilityCoverageChecklist = buildAccessibilityCoverageChecklist(input, requirementInsights);
  const responsiveCoverageChecklist = buildResponsiveCoverageChecklist(input, requirementInsights);
  const browserCoverageChecklist = buildBrowserCompatibilityChecklist(input, requirementInsights);
  const concurrencyCoverageChecklist = buildConcurrencyCoverageChecklist(input, requirementInsights);
  const performanceCoverageChecklist = buildPerformanceCoverageChecklist(input, requirementInsights);
  const apiDbCoverageChecklist = buildApiDbCoverageChecklist(input, requirementInsights);
  const userContent = [
    {
      type: "text",
      text: [
        buildInstructionText(input || "", images, inputType, requirementInsights, generationMode, strictRequirementMode),
        classicCoverageChecklist.length > 0 ? ["", "Classic senior-QA coverage checklist:", ...classicCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        listCoverageChecklist.length > 0 ? ["", "List / grid / page-behavior coverage checklist:", ...listCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        authorityCoverageChecklist.length > 0 ? ["", "Permission / authority coverage checklist:", ...authorityCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        configCoverageChecklist.length > 0 ? ["", "Tenant / configuration / feature-flag coverage checklist:", ...configCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        authCoverageChecklist.length > 0 ? ["", "Authentication / MFA / redirect coverage checklist:", ...authCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        sideEffectCoverageChecklist.length > 0 ? ["", "Export / notification / side-effect coverage checklist:", ...sideEffectCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        onboardingCoverageChecklist.length > 0 ? ["", "Onboarding / account setup / settings coverage checklist:", ...onboardingCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        multiActorCoverageChecklist.length > 0 ? ["", "Multi-actor / role coverage checklist:", ...multiActorCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        requirementFidelityChecklist.length > 0 ? ["", "Requirement fidelity checklist:", ...requirementFidelityChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        configDrivenFilterChecklist.length > 0 ? ["", "Config-driven filter behavior checklist:", ...configDrivenFilterChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        accessibilityCoverageChecklist.length > 0 ? ["", "Accessibility / keyboard / ARIA coverage checklist:", ...accessibilityCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        responsiveCoverageChecklist.length > 0 ? ["", "Responsive / mobile / touch coverage checklist:", ...responsiveCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        browserCoverageChecklist.length > 0 ? ["", "Cross-browser compatibility coverage checklist:", ...browserCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        concurrencyCoverageChecklist.length > 0 ? ["", "Concurrency / multi-user coverage checklist:", ...concurrencyCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        performanceCoverageChecklist.length > 0 ? ["", "Performance / large-data coverage checklist:", ...performanceCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : "",
        apiDbCoverageChecklist.length > 0 ? ["", "API / DB verification coverage checklist:", ...apiDbCoverageChecklist.map((line, index) => `${index + 1}. ${line}`)].join("\n") : ""
      ].filter(Boolean).join("\n")
    }
  ];
  for (const image of images) {
    userContent.push({ type: "image", dataUrl: image });
  }
  sendEvent?.("generating", { message: "Generating test cases..." });
  const attemptOne = await callAiProvider(aiSettings, systemPrompt, userContent);
  if (!attemptOne.ok) {
    throw attemptOne;
  }
  sendEvent?.("validating", { message: "Running QA rule checks..." });
  const firstValidation = validateGeneratedCases(
    inputType,
    input || "",
    attemptOne.testCases,
    requirementInsights,
    strictRequirementMode
  );
  if (firstValidation.valid) {
    if (resolvedCacheKey) {
      setCachedRequest(resolvedCacheKey, attemptOne.testCases);
    }
    return { testCases: attemptOne.testCases };
  }
  sendEvent?.("retrying", { message: "Improving coverage and rewriting weak cases..." });
  const correctionInstruction = [
    "The previous testcase suite is too weak or too compressed. Regenerate the FULL suite from scratch.",
    "",
    "Problems found:",
    ...firstValidation.violations.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Do not compress distinct meaningful checks into broad umbrella cases.",
    "Expand the suite with classic senior manual-QA coverage where relevant: boundaries, duplicate handling, whitespace, special characters, navigation, breadcrumbs/title, tab order, default values, downstream visibility, side effects, and repeated execution.",
    "Keep the suite broad and practical, closer to a classic strong QA export.",
    "Return only the structured testcase payload."
  ].join("\n");
  const retryContent = [...userContent, { type: "text", text: correctionInstruction }];
  const attemptTwo = await callAiProvider(aiSettings, systemPrompt, retryContent);
  if (!attemptTwo.ok) {
    return { testCases: attemptOne.testCases };
  }
  sendEvent?.("validating", { message: "Re-checking revised testcase suite..." });
  const secondValidation = validateGeneratedCases(
    inputType,
    input || "",
    attemptTwo.testCases,
    requirementInsights,
    strictRequirementMode
  );
  const bestResult = secondValidation.valid || attemptTwo.testCases.length >= attemptOne.testCases.length ? attemptTwo.testCases : attemptOne.testCases;
  if (resolvedCacheKey) {
    setCachedRequest(resolvedCacheKey, bestResult);
  }
  return { testCases: bestResult };
}

// supabase/functions/_shared/qaPlanningContext.ts
function formatRequirementInsights(insights) {
  if (!insights) {
    return "No structured requirement analysis available.";
  }
  const requirementPoints = insights.acceptanceCriteria.map(
    (point) => `${point.id} [${point.sourceType}] [${point.priority}] [${point.moduleHint}] ${point.criterion}
Meaning: ${point.plainEnglishMeaning}
What to test: ${point.whatToTest.join(" | ")}
How to test: ${point.howToTest.join(" | ")}`
  ).join("\n\n");
  return [
    `Requirement intelligence:`,
    `- Functionality explanation: ${insights.functionalityExplanation}`,
    `- Simple summary: ${insights.simpleSummary}`,
    `- Primary actor: ${insights.primaryActor}`,
    `- Primary action: ${insights.primaryAction}`,
    `- Recommended starter: ${insights.recommendedStarter}`,
    `- Business modules: ${insights.businessModules.join(", ") || "General"}`,
    `- Main flow: ${insights.mainFlow.join(" -> ")}`,
    `- Risk hotspots: ${insights.riskHotspots.join(" | ") || "None identified"}`,
    `- Important notes: ${insights.importantNotes.join(" | ") || "None"}`,
    "",
    `Requirement points:`,
    requirementPoints || "No structured requirement points available."
  ].join("\n");
}

// supabase/functions/_shared/qaPlanningSchemas.ts
var testPlanSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    objective: { type: "string" },
    scopeIn: { type: "array", items: { type: "string" } },
    scopeOut: { type: "array", items: { type: "string" } },
    testTypes: { type: "array", items: { type: "string" } },
    environments: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    dependencies: { type: "array", items: { type: "string" } },
    risks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          risk: { type: "string" },
          impact: { type: "string", enum: ["High", "Medium", "Low"] },
          mitigation: { type: "string" }
        },
        required: ["risk", "impact", "mitigation"],
        additionalProperties: false
      }
    },
    entryCriteria: { type: "array", items: { type: "string" } },
    exitCriteria: { type: "array", items: { type: "string" } },
    deliverables: { type: "array", items: { type: "string" } },
    milestones: { type: "array", items: { type: "string" } },
    rolesAndResponsibilities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          responsibility: { type: "string" }
        },
        required: ["role", "responsibility"],
        additionalProperties: false
      }
    },
    strategyNotes: { type: "array", items: { type: "string" } }
  },
  required: [
    "title",
    "objective",
    "scopeIn",
    "scopeOut",
    "testTypes",
    "environments",
    "assumptions",
    "dependencies",
    "risks",
    "entryCriteria",
    "exitCriteria",
    "deliverables",
    "milestones",
    "rolesAndResponsibilities",
    "strategyNotes"
  ],
  additionalProperties: false
};
var traceabilityMatrixSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    gaps: { type: "array", items: { type: "string" } },
    recommendedNextSteps: { type: "array", items: { type: "string" } },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          requirementReference: { type: "string" },
          requirementPoint: { type: "string" },
          module: { type: "string" },
          priority: { type: "string", enum: ["Critical", "High", "Medium", "Low"] },
          suggestedScenario: { type: "string" },
          suggestedTestCases: { type: "array", items: { type: "string" } },
          coverageStatus: { type: "string", enum: ["Covered", "Partial", "Missing"] },
          notes: { type: "string" }
        },
        required: [
          "id",
          "requirementReference",
          "requirementPoint",
          "module",
          "priority",
          "suggestedScenario",
          "suggestedTestCases",
          "coverageStatus",
          "notes"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["summary", "gaps", "recommendedNextSteps", "rows"],
  additionalProperties: false
};
var testDataPlanSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    dataCategories: { type: "array", items: { type: "string" } },
    environmentNotes: { type: "array", items: { type: "string" } },
    privacyNotes: { type: "array", items: { type: "string" } },
    datasets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          scenario: { type: "string" },
          dataCategory: { type: "string" },
          objective: { type: "string" },
          sampleData: { type: "array", items: { type: "string" } },
          negativeOrEdgeData: { type: "array", items: { type: "string" } },
          whyNeeded: { type: "string" },
          preconditions: { type: "array", items: { type: "string" } }
        },
        required: [
          "id",
          "scenario",
          "dataCategory",
          "objective",
          "sampleData",
          "negativeOrEdgeData",
          "whyNeeded",
          "preconditions"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["summary", "dataCategories", "environmentNotes", "privacyNotes", "datasets"],
  additionalProperties: false
};
var scenarioMapSchema = {
  type: "object",
  properties: {
    featureGoal: { type: "string" },
    primaryFlow: { type: "array", items: { type: "string" } },
    alternateFlows: { type: "array", items: { type: "string" } },
    negativeFlows: { type: "array", items: { type: "string" } },
    edgeCases: { type: "array", items: { type: "string" } },
    regressionFocus: { type: "array", items: { type: "string" } },
    highRiskIntersections: { type: "array", items: { type: "string" } }
  },
  required: [
    "featureGoal",
    "primaryFlow",
    "alternateFlows",
    "negativeFlows",
    "edgeCases",
    "regressionFocus",
    "highRiskIntersections"
  ],
  additionalProperties: false
};
var clarificationQuestionsSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    decisionsToConfirm: { type: "array", items: { type: "string" } },
    safeTestingAssumptions: { type: "array", items: { type: "string" } },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          whyItMatters: { type: "string" },
          riskIfUnanswered: { type: "string", enum: ["High", "Medium", "Low"] },
          suggestedOwner: { type: "string" },
          blockingLevel: { type: "string", enum: ["Blocking", "Important", "Nice to Have"] }
        },
        required: ["id", "question", "whyItMatters", "riskIfUnanswered", "suggestedOwner", "blockingLevel"],
        additionalProperties: false
      }
    }
  },
  required: ["summary", "assumptions", "decisionsToConfirm", "safeTestingAssumptions", "questions"],
  additionalProperties: false
};

// server/generate-test-cases-server.ts
var HOST = process.env.LOCAL_AI_SERVER_HOST || "127.0.0.1";
var PORT = Number(process.env.LOCAL_AI_SERVER_PORT || 8787);
var MAX_BODY_BYTES = 20 * 1024 * 1024;
var CACHE_TTL_MS2 = 5 * 60 * 1e3;
var GENERATION_TIME_BUDGET_MS = 20 * 60 * 1e3;
var RETRY_STAGE_RESERVE_MS = 3 * 60 * 1e3;
var FUNCTION_ROUTE_PREFIX = "/functions/v1";
var GENERATE_ROUTE_PATH = `${FUNCTION_ROUTE_PREFIX}/generate-test-cases`;
var LOCAL_FUNCTION_NAMES = /* @__PURE__ */ new Set([
  "generate-test-cases",
  "requirement-analysis",
  "audit-test-cases",
  "smart-merge-testcases",
  "validate-coverage",
  "test-plan",
  "traceability-matrix",
  "test-data-plan",
  "scenario-map",
  "clarification-questions"
]);
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept"
};
hydrateLocalEnv();
function createLocalAiServer() {
  return createServer(async (req, res) => {
    setCorsHeaders(res);
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const functionName = resolveLocalFunctionName(url.pathname);
    if (!functionName) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }
    try {
      const rawBody = await readRequestBody(req);
      const body = JSON.parse(rawBody || "{}");
      if (functionName === "generate-test-cases") {
        const { input, inputType, images, stream, aiSettings } = parseGenerationRequest(body);
        const cacheKey = images.length === 0 ? await computeCacheKey(input, inputType, 0, aiSettings) : null;
        if (stream) {
          res.writeHead(200, {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          });
          const sendEvent = (stage, data) => {
            res.write(`data: ${JSON.stringify({ stage, ...data })}

`);
          };
          try {
            const result3 = await runGenerationPipeline(aiSettings, input, inputType, images, cacheKey, sendEvent);
            sendEvent("finalizing", { message: "Finalizing output..." });
            sendEvent("complete", {
              testCases: result3.testCases,
              ...result3.cached ? { cached: true } : {}
            });
          } catch (error) {
            const providerError = toProviderFailure(error);
            sendEvent("error", {
              error: providerError?.errorText || (error instanceof Error ? error.message : "Unknown error")
            });
          } finally {
            res.end();
          }
          return;
        }
        const result2 = await runGenerationPipeline(aiSettings, input, inputType, images, cacheKey);
        sendJson(res, 200, {
          testCases: result2.testCases,
          ...result2.cached ? { cached: true } : {}
        });
        return;
      }
      const result = await handleLocalFunctionRoute(functionName, body);
      sendJson(res, 200, result);
    } catch (error) {
      const providerError = toProviderFailure(error);
      if (providerError) {
        sendJson(res, providerError.status, { error: providerError.errorText });
        return;
      }
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown error" });
    }
  });
}
if (isDirectServerEntry()) {
  const server = createLocalAiServer();
  server.listen(PORT, HOST, () => {
    console.log(`[local-ai-server] listening at http://${HOST}:${PORT}${FUNCTION_ROUTE_PREFIX}/<function-name>`);
  });
}
function isDirectServerEntry() {
  if (!process.argv[1]) {
    return false;
  }
  return fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
}
function hydrateLocalEnv() {
  const envFilePath = fileURLToPath(new URL("../supabase/functions/.env.local", import.meta.url));
  if (!existsSync(envFilePath)) {
    return;
  }
  const contents = readFileSync(envFilePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) {
      continue;
    }
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}
function setCorsHeaders(res) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}
function sendJson(res, status, payload) {
  res.writeHead(status, { ...corsHeaders, "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}
function resolveLocalFunctionName(pathname) {
  const normalized = pathname.startsWith(`${FUNCTION_ROUTE_PREFIX}/`) ? pathname.slice(FUNCTION_ROUTE_PREFIX.length + 1) : pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return LOCAL_FUNCTION_NAMES.has(normalized) ? normalized : null;
}
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}
function parseGenerationRequest(body) {
  const input = typeof body.input === "string" ? body.input : "";
  const inputType = normalizeInputType(body.inputType);
  const imagesBase64 = Array.isArray(body.imagesBase64) ? body.imagesBase64.filter((item) => typeof item === "string") : [];
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  const images = imagesBase64.length > 0 ? imagesBase64 : imageBase64 ? [imageBase64] : [];
  if (!input.trim() && images.length === 0) {
    throw new Error("Missing input or image");
  }
  if (!inputType) {
    throw new Error("Missing inputType");
  }
  return {
    input,
    inputType,
    images,
    stream: body.stream === true,
    aiSettings: body.aiSettings
  };
}
function normalizeInputType(value) {
  return value === "requirement" || value === "highlevel" || value === "testcase" || value === "scenario" || value === "expected" ? value : null;
}
function isKnownAiFunction(functionName) {
  return LOCAL_FUNCTION_NAMES.has(functionName);
}
async function handleHostedFunctionRequest(functionName, body) {
  if (!isKnownAiFunction(functionName)) {
    throw { ok: false, status: 404, errorText: "Not found." };
  }
  if (functionName === "generate-test-cases") {
    const { input, inputType, images, aiSettings } = parseGenerationRequest(body);
    const cacheKey = images.length === 0 ? await computeCacheKey(input, inputType, 0, aiSettings) : null;
    const result = await runGenerationPipeline(aiSettings, input, inputType, images, cacheKey);
    return {
      testCases: result.testCases,
      ...result.cached ? { cached: true } : {}
    };
  }
  return await handleLocalFunctionRoute(functionName, body);
}
async function computeCacheKey(input, inputType, imageCount, aiSettings) {
  return await computeGenerateCacheKey(input, inputType, imageCount, aiSettings);
}
async function runGenerationPipeline(aiSettings, input, inputType, images, cacheKey, sendEvent) {
  return await runGenerateTestCasePipeline({
    aiSettings,
    input,
    inputType,
    images,
    cacheKey,
    sendEvent
  });
}
async function handleLocalFunctionRoute(functionName, body) {
  switch (functionName) {
    case "requirement-analysis":
      return await handleRequirementAnalysis(body);
    case "audit-test-cases":
      return await handleAuditTestCases(body);
    case "smart-merge-testcases":
      return await handleSmartMerge(body);
    case "validate-coverage":
      return await handleValidateCoverage(body);
    case "test-plan":
      return await handleTestPlan(body);
    case "traceability-matrix":
      return await handleTraceabilityMatrix(body);
    case "test-data-plan":
      return await handleTestDataPlan(body);
    case "scenario-map":
      return await handleScenarioMap(body);
    case "clarification-questions":
      return await handleClarificationQuestions(body);
    default:
      throw { ok: false, status: 404, errorText: "Not found." };
  }
}
async function handleRequirementAnalysis(body) {
  const requirement = String(body.requirement ?? "").trim();
  const aiSettings = body.aiSettings;
  if (!requirement) {
    throw { ok: false, status: 400, errorText: "Missing requirement" };
  }
  return await analyzeRequirementText(aiSettings, requirement, "requirement-analysis");
}
async function handleAuditTestCases(body) {
  const requirement = String(body.requirement ?? "").trim();
  const images = Array.isArray(body.imagesBase64) ? body.imagesBase64.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
  const existingTestCases = Array.isArray(body.existingTestCases) ? body.existingTestCases : [];
  const requestedCoverageGaps = Array.isArray(body.focusMissingScenarios) ? body.focusMissingScenarios.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
  const aiSettings = body.aiSettings;
  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = images.length === 0 ? await computeRequestCacheKey("audit-test-cases", aiSettings, {
    requirement,
    existingTestCases,
    focusMissingScenarios: requestedCoverageGaps
  }) : null;
  if (cacheKey) {
    const cached = getCachedRequest(cacheKey);
    if (cached) {
      return cached;
    }
  }
  const requirementInsights = requirement ? await analyzeRequirementText(aiSettings, requirement, "audit-test-cases-analysis") : null;
  const systemPrompt = `You are a senior QA lead auditing an existing testcase suite.

Your job:
1. Read the requirement and the existing testcase set.
2. Identify missing requirement points, weak areas, and poor-quality testcase wording.
3. Generate NEW test cases only for the gaps and weak spots.
4. Return enterprise-ready testcases with requirement references, module, priority, test data, and post-condition.

STRICT RULES:
- Do not simply restate the uploaded cases.
- Focus on missing or weak coverage.
- Use professional testcase naming, preferably actor-based.
- Expected results must be concrete and observable.
- Do not invent features that are not in the requirement.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.auditPromptLines.map((line) => `- ${line}`).join("\n")}`;
  const analysisText = requirementInsights ? [
    `Requirement intelligence:`,
    `- Primary actor: ${requirementInsights.primaryActor}`,
    `- Primary action: ${requirementInsights.primaryAction}`,
    `- Recommended starter: ${requirementInsights.recommendedStarter}`,
    `- Modules: ${requirementInsights.businessModules.join(", ") || "General"}`,
    `- Risk hotspots: ${requirementInsights.riskHotspots.join(" | ") || "None"}`,
    `- Requirement points:`,
    ...requirementInsights.acceptanceCriteria.map(
      (point) => `${point.id} [${point.priority}] [${point.moduleHint}] ${point.criterion}`
    )
  ].join("\n") : "No structured requirement analysis available.";
  const userParts = [
    {
      type: "text",
      text: [
        `Generation style mode: ${generationProfile.label}`,
        ``,
        `Requirement:`,
        requirement || "No text requirement provided.",
        ``,
        analysisText,
        ``,
        `Existing test cases:`,
        JSON.stringify(existingTestCases, null, 2),
        ``,
        `Style guidance:`,
        ...generationProfile.auditPromptLines.map((line) => `- ${line}`),
        ``,
        ...requestedCoverageGaps.length > 0 ? [
          `Coverage gaps to generate full testcase rows for:`,
          ...requestedCoverageGaps.map((gap, index) => `${index + 1}. ${gap}`),
          ``,
          `Return only NEW testcase rows that cover these missing scenarios. Do not add unrelated extra cases.`
        ] : [],
        ``,
        `Return only NEW or materially improved cases that cover missing or weak areas.`
      ].join("\n")
    },
    ...images.map((dataUrl) => ({ type: "image", dataUrl }))
  ];
  const parsed = await generateReviewedStructuredData({
    aiSettings,
    artifactLabel: "gap-filling audited testcase suite",
    systemPrompt,
    userParts,
    featureName: "audit-test-cases",
    output: {
      name: "return_audited_test_cases",
      description: "Return newly generated test cases that fill the coverage gaps.",
      schema: testCaseCollectionSchema
    },
    reviewThreshold: generationProfile.reviewThreshold,
    reviewFocusLines: [
      "Check whether the new cases truly fill gaps instead of repeating the uploaded suite.",
      "Check whether requirement references, module, priority, test data, and post-condition are meaningful.",
      "Check whether the testcase names, steps, and expected results read like strong senior-QA work.",
      "Check whether high-risk, negative, and edge gaps are covered rather than only happy-path improvements.",
      ...requestedCoverageGaps.length > 0 ? ["Check whether the returned cases directly address the requested missing coverage scenarios instead of drifting into unrelated additions."] : []
    ],
    correctionReminder: "Return only materially useful new cases that close real coverage gaps and read like an enterprise-ready senior-QA enhancement set."
  });
  const normalized = deduplicateGeneratedTestCases(normalizeGeneratedTestCases(parsed.testCases || []));
  const responseBody = { testCases: normalized };
  if (cacheKey) {
    setCachedRequest(cacheKey, responseBody);
  }
  return responseBody;
}
async function handleSmartMerge(body) {
  const files = Array.isArray(body.files) ? body.files : null;
  const aiSettings = body.aiSettings;
  if (!files || files.length === 0) {
    throw { ok: false, status: 400, errorText: "No files provided" };
  }
  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey("smart-merge-testcases", aiSettings, { files });
  const cached = getCachedRequest(cacheKey);
  if (cached) {
    return cached;
  }
  const allRows = [];
  files.forEach((fileRows) => {
    fileRows.forEach((row) => allRows.push(row));
  });
  const testCaseText = allRows.map((row, index) => {
    const parts = [`--- Test Case ${index + 1} ---`];
    for (const [key, value] of Object.entries(row)) {
      if (value && value.trim()) {
        parts.push(`${key}: ${value}`);
      }
    }
    return parts.join("\n");
  }).join("\n\n");
  const systemPrompt = `You are a senior QA engineer specializing in testcase refinement, deduplication, and enterprise QA formatting.

You will receive test cases from multiple files. Your job is to:
1. Identify duplicates and near-duplicates.
2. Keep unique coverage.
3. Merge overlapping cases into one stronger professional testcase.
4. Normalize the final output into enterprise-ready fields.

RULES:
- Preserve genuinely different scenarios.
- Remove vague or duplicate wording.
- Use practical modules, requirement references where possible, priority, test data, and post-condition fields.
- Expected results must be direct and observable.
- Return a refined, deduplicated, professional testcase suite.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.mergePromptLines.map((line) => `- ${line}`).join("\n")}`;
  const parsed = await generateReviewedStructuredData({
    aiSettings,
    artifactLabel: "merged testcase suite",
    featureName: "smart-merge-testcases",
    systemPrompt,
    userParts: [
      {
        type: "text",
        text: [
          `Generation style mode: ${generationProfile.label}`,
          "",
          `I have ${allRows.length} uploaded rows from ${files.length} files. Deduplicate, refine, and normalize them.`,
          "",
          `Style guidance:`,
          ...generationProfile.mergePromptLines.map((line) => `- ${line}`),
          "",
          testCaseText
        ].join("\n")
      }
    ],
    output: {
      name: "return_test_cases",
      description: "Return the merged and refined test cases.",
      schema: testCaseCollectionSchema
    },
    reviewThreshold: generationProfile.reviewThreshold,
    reviewFocusLines: [
      "Check whether duplicates and near-duplicates were truly consolidated.",
      "Check whether unique business coverage was preserved instead of accidentally removed.",
      "Check whether the final merged rows look normalized, professional, and directly usable by QA teams.",
      "Check whether expected results, priorities, and fields are strong enough for enterprise review."
    ],
    correctionReminder: "Produce a deduplicated, coverage-preserving, enterprise-ready testcase suite with no weak filler rows."
  });
  const normalized = deduplicateGeneratedTestCases(normalizeGeneratedTestCases(parsed.testCases || [])).filter((tc) => tc.testCase && tc.expectedResult);
  const responseBody = { testCases: normalized };
  setCachedRequest(cacheKey, responseBody);
  return responseBody;
}
async function handleValidateCoverage(body) {
  const input = typeof body.input === "string" ? body.input : "";
  const inputType = typeof body.inputType === "string" ? body.inputType : "requirement";
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  const images = Array.isArray(body.imagesBase64) ? body.imagesBase64.filter((item) => typeof item === "string" && item.trim().length > 0) : imageBase64 ? [imageBase64] : [];
  const testCases = Array.isArray(body.testCases) ? body.testCases : [];
  const aiSettings = body.aiSettings;
  if (testCases.length === 0) {
    throw { ok: false, status: 400, errorText: "No test cases to validate" };
  }
  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = images.length === 0 ? await computeRequestCacheKey("validate-coverage", aiSettings, { input, inputType, testCases }) : null;
  if (cacheKey) {
    const cached = getCachedRequest(cacheKey);
    if (cached) {
      return cached;
    }
  }
  const userParts = [];
  let validationPrompt = `You are a senior QA engineer reviewing test case coverage.

TASK: Analyze the given requirement/input and the generated test cases. Identify if there are any GAPS or MISSING scenarios.

GENERATION STYLE MODE: ${generationProfile.label}

REQUIREMENT/INPUT:
${input || "No text input provided"}

GENERATED TEST CASES (${testCases.length} total):
${testCases.map((testCase, index) => `${index + 1}. [${testCase.type ?? "Unknown"}] ${testCase.testCase ?? "Untitled test case"}`).join("\n")}
`;
  if (images.length > 0) {
    validationPrompt += `
I've also attached ${images.length} UI screenshot(s)/mockup(s) that were used for generating these test cases. Check if all UI elements are covered.`;
  }
  validationPrompt += `

Style guidance:
${generationProfile.coveragePromptLines.map((line) => `- ${line}`).join("\n")}`;
  userParts.push({ type: "text", text: validationPrompt });
  for (const image of images) {
    userParts.push({ type: "image", dataUrl: image });
  }
  const parsed = await generateReviewedStructuredData({
    aiSettings,
    artifactLabel: "coverage analysis report",
    featureName: "validate-coverage",
    systemPrompt: `You are a senior QA engineer validating test coverage. Analyze the requirement and test cases to identify gaps.

Be thorough but practical. Focus on ACTUAL missing scenarios, not minor variations.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.coveragePromptLines.map((line) => `- ${line}`).join("\n")}`,
    userParts,
    output: {
      name: "return_coverage_analysis",
      description: "Return the structured coverage analysis result.",
      schema: {
        type: "object",
        properties: {
          coverageScore: { type: "number" },
          summary: { type: "string" },
          coveredAreas: { type: "array", items: { type: "string" } },
          missingScenarios: {
            type: "array",
            items: {
              type: "object",
              properties: {
                scenario: { type: "string" },
                priority: { type: "string", enum: ["High", "Medium", "Low"] },
                type: { type: "string", enum: ["Positive", "Negative"] }
              },
              required: ["scenario", "priority", "type"],
              additionalProperties: false
            }
          },
          recommendations: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["coverageScore", "summary", "coveredAreas", "missingScenarios", "recommendations"],
        additionalProperties: false
      }
    },
    reviewThreshold: generationProfile.reviewThreshold,
    reviewFocusLines: [
      "Check whether the score matches the actual gap severity instead of sounding inflated.",
      "Check whether covered areas, missing scenarios, and recommendations are requirement-driven and not generic filler.",
      "Check whether high-risk and high-priority missing scenarios are surfaced clearly.",
      "Check whether the report would be useful to a senior QA reviewer making next-step decisions."
    ],
    correctionReminder: "Tighten the coverage judgment so the report is honest, risk-aware, and useful for real QA decision-making."
  });
  if (cacheKey) {
    setCachedRequest(cacheKey, parsed);
  }
  return parsed;
}
async function handleTestPlan(body) {
  const requirement = String(body.requirement ?? "").trim();
  const aiSettings = body.aiSettings;
  if (!requirement) {
    throw { ok: false, status: 400, errorText: "Missing requirement" };
  }
  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey("test-plan", aiSettings, { requirement });
  const cached = getCachedRequest(cacheKey);
  if (cached) {
    return cached;
  }
  const requirementInsights = await analyzeRequirementText(aiSettings, requirement, "test-plan-analysis");
  const parsed = await generateReviewedStructuredData({
    aiSettings,
    artifactLabel: "test plan",
    featureName: "test-plan",
    systemPrompt: `You are a senior QA lead with 15+ years of experience creating practical, project-ready test plans.

Create a test plan that a real QA team can use, not a generic textbook template.

The output must include:
- title
- objective
- in-scope items
- out-of-scope items
- test types
- environments
- assumptions
- dependencies
- key risks with mitigation
- entry criteria
- exit criteria
- deliverables
- milestones
- roles and responsibilities
- strategy notes

STRICT RULES:
- Base the plan only on the given requirement and its derived business context.
- Keep the scope realistic and requirement-driven.
- Do not invent unrelated modules or delivery processes.
- Make the test types and risks relevant to the feature.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.planningPromptLines.map((line) => `- ${line}`).join("\n")}`,
    userParts: [
      {
        type: "text",
        text: [
          `Requirement:`,
          requirement,
          ``,
          formatRequirementInsights(requirementInsights),
          ``,
          `Build a requirement-specific QA test plan.`
        ].join("\n")
      }
    ],
    output: {
      name: "return_test_plan",
      description: "Return a structured QA test plan for the requirement.",
      schema: testPlanSchema
    },
    reviewThreshold: generationProfile.reviewThreshold,
    reviewFocusLines: [
      "Check whether the scope, risks, entry criteria, and exit criteria are requirement-specific rather than boilerplate.",
      "Check whether the plan is realistic for a working QA team and not a textbook template.",
      "Check whether the strategy notes, environments, and test types show strong senior-QA judgment."
    ],
    correctionReminder: "Raise the test plan to a practical, review-ready senior-QA artifact with realistic scope, risks, and execution guidance."
  });
  setCachedRequest(cacheKey, parsed);
  return parsed;
}
async function handleTraceabilityMatrix(body) {
  const requirement = String(body.requirement ?? "").trim();
  const testCases = Array.isArray(body.testCases) ? body.testCases : [];
  const aiSettings = body.aiSettings;
  if (!requirement) {
    throw { ok: false, status: 400, errorText: "Missing requirement" };
  }
  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey("traceability-matrix", aiSettings, { requirement, testCases });
  const cached = getCachedRequest(cacheKey);
  if (cached) {
    return cached;
  }
  const requirementInsights = await analyzeRequirementText(aiSettings, requirement, "traceability-matrix-analysis");
  const parsed = await generateReviewedStructuredData({
    aiSettings,
    artifactLabel: "requirement traceability matrix",
    featureName: "traceability-matrix",
    systemPrompt: `You are a senior QA lead building a requirement traceability matrix (RTM).

Your job:
- Read the requirement and its structured breakdown.
- Map each requirement point to one RTM row.
- If testcases are provided, judge whether the point appears Covered, Partial, or Missing.
- Suggest the scenario and testcase titles that should cover each point.
- Call out true gaps and next steps.

STRICT RULES:
- Do not invent requirement points not supported by the requirement.
- Make coverage status practical and honest.
- Keep notes concise and useful for a QA reviewer.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.traceabilityPromptLines.map((line) => `- ${line}`).join("\n")}`,
    userParts: [
      {
        type: "text",
        text: [
          `Requirement:`,
          requirement,
          ``,
          formatRequirementInsights(requirementInsights),
          ``,
          `Existing testcases for coverage comparison:`,
          testCases.length > 0 ? JSON.stringify(testCases, null, 2) : "No existing testcases provided.",
          ``,
          `Build an RTM with realistic coverage status.`
        ].join("\n")
      }
    ],
    output: {
      name: "return_traceability_matrix",
      description: "Return a structured requirement traceability matrix.",
      schema: traceabilityMatrixSchema
    },
    reviewThreshold: generationProfile.reviewThreshold,
    reviewFocusLines: [
      "Check whether every row is traceable to a real requirement point.",
      "Check whether coverage status is honest and not over-optimistic.",
      "Check whether gaps and next steps would help a QA lead drive action immediately."
    ],
    correctionReminder: "Make the RTM sharper, more traceable, and more honest about partial or missing coverage."
  });
  setCachedRequest(cacheKey, parsed);
  return parsed;
}
async function handleTestDataPlan(body) {
  const requirement = String(body.requirement ?? "").trim();
  const aiSettings = body.aiSettings;
  if (!requirement) {
    throw { ok: false, status: 400, errorText: "Missing requirement" };
  }
  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey("test-data-plan", aiSettings, { requirement });
  const cached = getCachedRequest(cacheKey);
  if (cached) {
    return cached;
  }
  const requirementInsights = await analyzeRequirementText(aiSettings, requirement, "test-data-plan-analysis");
  const parsed = await generateReviewedStructuredData({
    aiSettings,
    artifactLabel: "test data plan",
    featureName: "test-data-plan",
    systemPrompt: `You are a senior QA engineer designing a feature-specific test data plan.

Your job:
- Identify the data categories needed for this feature.
- Propose realistic datasets for happy path, negative, and edge testing.
- Explain why each dataset is needed.
- Mention useful preconditions and environment/privacy notes.

STRICT RULES:
- Keep the data plan tied to the requirement.
- Suggest realistic manual testing data, not fake filler.
- Include valid, invalid, and edge-oriented examples where relevant.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.testDataPromptLines.map((line) => `- ${line}`).join("\n")}`,
    userParts: [
      {
        type: "text",
        text: [
          `Requirement:`,
          requirement,
          ``,
          formatRequirementInsights(requirementInsights),
          ``,
          `Create a practical test data plan for this requirement.`
        ].join("\n")
      }
    ],
    output: {
      name: "return_test_data_plan",
      description: "Return a structured test data plan.",
      schema: testDataPlanSchema
    },
    reviewThreshold: generationProfile.reviewThreshold,
    reviewFocusLines: [
      "Check whether the datasets are realistic and useful for real manual execution.",
      "Check whether valid, invalid, and edge data coverage is balanced and requirement-driven.",
      "Check whether sample data and preconditions are concrete instead of generic placeholders."
    ],
    correctionReminder: "Make the test data plan more realistic, more risk-aware, and more directly usable by a senior QA team."
  });
  setCachedRequest(cacheKey, parsed);
  return parsed;
}
async function handleScenarioMap(body) {
  const requirement = String(body.requirement ?? "").trim();
  const aiSettings = body.aiSettings;
  if (!requirement) {
    throw { ok: false, status: 400, errorText: "Missing requirement" };
  }
  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey("scenario-map", aiSettings, { requirement });
  const cached = getCachedRequest(cacheKey);
  if (cached) {
    return cached;
  }
  const requirementInsights = await analyzeRequirementText(aiSettings, requirement, "scenario-map-analysis");
  const parsed = await generateReviewedStructuredData({
    aiSettings,
    artifactLabel: "scenario map",
    featureName: "scenario-map",
    systemPrompt: `You are a senior QA engineer mapping a feature into a scenario map before detailed testcase creation.

Your job:
- State the feature goal clearly.
- Break the feature into primary flow, alternate flows, negative flows, and edge cases.
- Identify regression focus areas and high-risk intersections.

STRICT RULES:
- Keep the map tied to the actual requirement.
- Think like a manual tester walking the feature end to end.
- Do not invent unrelated modules or user journeys.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.scenarioPromptLines.map((line) => `- ${line}`).join("\n")}`,
    userParts: [
      {
        type: "text",
        text: [
          `Requirement:`,
          requirement,
          ``,
          formatRequirementInsights(requirementInsights),
          ``,
          `Create a scenario map that a senior QA would use before writing detailed testcases.`
        ].join("\n")
      }
    ],
    output: {
      name: "return_scenario_map",
      description: "Return a structured scenario map.",
      schema: scenarioMapSchema
    },
    reviewThreshold: generationProfile.reviewThreshold,
    reviewFocusLines: [
      "Check whether the primary, alternate, negative, and edge flows are complete and requirement-driven.",
      "Check whether high-risk intersections and regression focus areas reflect senior-QA thinking.",
      "Check whether the scenario map is practical to convert into detailed testcase design later."
    ],
    correctionReminder: "Make the scenario map more complete, more risk-aware, and more useful as a senior-QA pre-testcase artifact."
  });
  setCachedRequest(cacheKey, parsed);
  return parsed;
}
async function handleClarificationQuestions(body) {
  const requirement = String(body.requirement ?? "").trim();
  const aiSettings = body.aiSettings;
  if (!requirement) {
    throw { ok: false, status: 400, errorText: "Missing requirement" };
  }
  const generationMode = getGenerationMode(aiSettings);
  const generationProfile = getGenerationModeProfile(generationMode);
  const cacheKey = await computeRequestCacheKey("clarification-questions", aiSettings, { requirement });
  const cached = getCachedRequest(cacheKey);
  if (cached) {
    return cached;
  }
  const requirementInsights = await analyzeRequirementText(aiSettings, requirement, "clarification-questions-analysis");
  const parsed = await generateReviewedStructuredData({
    aiSettings,
    artifactLabel: "clarification question set",
    featureName: "clarification-questions",
    systemPrompt: `You are a senior QA analyst preparing clarification questions before test execution begins.

Your job:
- Identify ambiguity, missing rules, and assumptions in the requirement.
- Ask practical stakeholder-ready questions.
- Explain why each question matters.
- Highlight the risk if the point stays unanswered.
- Separate blocking questions from lower-priority clarifications.

STRICT RULES:
- Do not ask unnecessary filler questions.
- Focus on real ambiguity that can affect testing, coverage, or defect leakage.
- Keep assumptions and safe testing assumptions practical and requirement-driven.

GENERATION STYLE MODE: ${generationProfile.label}
${generationProfile.clarificationPromptLines.map((line) => `- ${line}`).join("\n")}`,
    userParts: [
      {
        type: "text",
        text: [
          `Requirement:`,
          requirement,
          ``,
          formatRequirementInsights(requirementInsights),
          ``,
          `Return the clarification questions and assumptions a senior QA should raise before testing.`
        ].join("\n")
      }
    ],
    output: {
      name: "return_clarification_questions",
      description: "Return structured clarification questions and assumptions.",
      schema: clarificationQuestionsSchema
    },
    reviewThreshold: generationProfile.reviewThreshold,
    reviewFocusLines: [
      "Check whether the questions expose real ambiguity instead of filler.",
      "Check whether blocking level, risk, and ownership are practical for stakeholder follow-up.",
      "Check whether the assumptions are safe, realistic, and useful for QA planning."
    ],
    correctionReminder: "Strengthen the question set so it surfaces the most important ambiguity, risk, and stakeholder decisions before testing starts."
  });
  setCachedRequest(cacheKey, parsed);
  return parsed;
}
function toProviderFailure(error) {
  if (typeof error === "object" && error && "ok" in error && error.ok === false) {
    const providerError = error;
    if (providerError.status === 429) {
      return { ok: false, status: 429, errorText: "Rate limit exceeded. Please try again in a moment." };
    }
    if (providerError.status === 402) {
      return { ok: false, status: 402, errorText: "AI credits exhausted. Please add credits to continue." };
    }
    return providerError;
  }
  return null;
}
export {
  handleHostedFunctionRequest,
  isKnownAiFunction,
  toProviderFailure
};

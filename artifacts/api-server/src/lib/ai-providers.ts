import { logger } from "./logger";
import type { AiVendor } from "./ai-settings";

const AI_TIMEOUT_MS = 120_000;

type FailureClass = "timeout" | "upstream_http" | "network" | "parse" | "unknown_model";
type EndpointFamily = "responses" | "chat_completions" | "messages" | "generate_content";

type ProcessTextInput = {
  plainText: string;
  model: string;
  apiKey: string;
  systemPrompt: string;
  vendor: AiVendor;
  signal?: AbortSignal;
};

type ProcessImageInput = ProcessTextInput & {
  imageBase64: string;
  imageMimeType: string;
};

export class AiVisionNotSupportedError extends Error {
  constructor(message = "This AI model does not support image analysis.") {
    super(message);
    this.name = "AiVisionNotSupportedError";
  }
}

type TransportAttempt = {
  kind: "openai-responses" | "chat-completions" | "anthropic-messages" | "google-generate-content";
  url: string;
  endpointFamily: EndpointFamily;
};

type TransportResult =
  | { ok: true; text: string }
  | {
      ok: false;
      message: string;
      retryable: boolean;
      failureClass: FailureClass;
      transportKind: TransportAttempt["kind"];
      endpointFamily: EndpointFamily;
      url: string;
      upstreamStatus?: number;
    };

export class AiProviderError extends Error {
  statusCode: number;
  retryable: boolean;
  failureClass: FailureClass;
  transportKind?: TransportAttempt["kind"];
  endpointFamily?: EndpointFamily;
  url?: string;
  upstreamStatus?: number;

  constructor(
    message: string,
    input: {
      statusCode?: number;
      retryable?: boolean;
      failureClass?: FailureClass;
      transportKind?: TransportAttempt["kind"];
      endpointFamily?: EndpointFamily;
      url?: string;
      upstreamStatus?: number;
    } = {},
  ) {
    super(message);
    this.name = "AiProviderError";
    this.statusCode = input.statusCode ?? 502;
    this.retryable = input.retryable ?? false;
    this.failureClass = input.failureClass ?? "network";
    this.transportKind = input.transportKind;
    this.endpointFamily = input.endpointFamily;
    this.url = input.url;
    this.upstreamStatus = input.upstreamStatus;
  }
}

export async function processTextWithProvider(input: ProcessTextInput): Promise<string> {
  const normalizedInput = {
    ...input,
    model: normalizeModelForProvider(input.vendor, input.model),
  };
  const attempts = getTransportAttempts(normalizedInput);
  let lastFailure: TransportResult | null = null;

  for (const attempt of attempts) {
    const result = await runAttempt(attempt, normalizedInput);
    if (result.ok) {
      return result.text;
    }

    lastFailure = result;

    if (!shouldTryNextAttempt(result.upstreamStatus ?? 0)) {
      break;
    }
  }

  logger.warn(
    {
      vendor: input.vendor,
      model: normalizedInput.model,
      transportKind: lastFailure?.ok ? undefined : lastFailure?.transportKind,
      endpointFamily: lastFailure?.ok ? undefined : lastFailure?.endpointFamily,
      failureClass: lastFailure?.ok ? undefined : lastFailure?.failureClass,
      url: lastFailure?.ok ? undefined : lastFailure?.url,
      upstreamStatus: lastFailure?.ok ? undefined : lastFailure?.upstreamStatus,
      retryable: lastFailure?.ok ? undefined : lastFailure?.retryable,
    },
    "AI provider request failed",
  );

  throw new AiProviderError(
    lastFailure?.message || "AI provider request failed",
    {
      statusCode: mapFailureToApiStatus(lastFailure),
      retryable: lastFailure?.ok ? false : lastFailure?.retryable,
      failureClass: lastFailure?.ok ? "network" : lastFailure?.failureClass,
      transportKind: lastFailure?.ok ? undefined : lastFailure?.transportKind,
      endpointFamily: lastFailure?.ok ? undefined : lastFailure?.endpointFamily,
      url: lastFailure?.ok ? undefined : lastFailure?.url,
      upstreamStatus: lastFailure?.ok ? undefined : lastFailure?.upstreamStatus,
    },
  );
}

const VISION_NOT_SUPPORTED_PATTERNS = [
  "vision",
  "image",
  "multimodal",
  "does not support",
  "not supported",
  "unsupported",
  "cannot process",
  "can't process",
];

function isVisionNotSupportedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return VISION_NOT_SUPPORTED_PATTERNS.some((p) => lower.includes(p));
}

export async function processImageWithProvider(input: ProcessImageInput): Promise<string> {
  const normalizedInput = {
    ...input,
    model: normalizeModelForProvider(input.vendor, input.model),
  };
  const attempts = getTransportAttempts(normalizedInput);
  let lastFailure: TransportResult | null = null;

  for (const attempt of attempts) {
    const result = await runImageAttempt(attempt, normalizedInput);
    if (result.ok) {
      return result.text;
    }

    if (!result.ok && isVisionNotSupportedMessage(result.message)) {
      throw new AiVisionNotSupportedError();
    }

    lastFailure = result;

    if (!shouldTryNextAttempt(result.upstreamStatus ?? 0)) {
      break;
    }
  }

  logger.warn(
    {
      vendor: input.vendor,
      model: normalizedInput.model,
      transportKind: lastFailure?.ok ? undefined : lastFailure?.transportKind,
      failureClass: lastFailure?.ok ? undefined : lastFailure?.failureClass,
    },
    "AI image provider request failed",
  );

  throw new AiProviderError(
    lastFailure?.message || "AI provider request failed",
    {
      statusCode: mapFailureToApiStatus(lastFailure),
      retryable: lastFailure?.ok ? false : lastFailure?.retryable,
      failureClass: lastFailure?.ok ? "network" : lastFailure?.failureClass,
      transportKind: lastFailure?.ok ? undefined : lastFailure?.transportKind,
      endpointFamily: lastFailure?.ok ? undefined : lastFailure?.endpointFamily,
      url: lastFailure?.ok ? undefined : lastFailure?.url,
      upstreamStatus: lastFailure?.ok ? undefined : lastFailure?.upstreamStatus,
    },
  );
}

async function runImageAttempt(attempt: TransportAttempt, input: ProcessImageInput): Promise<TransportResult> {
  const dataUrl = `data:${input.imageMimeType};base64,${input.imageBase64}`;

  switch (attempt.kind) {
    case "anthropic-messages":
      return postJson(attempt.url, {
        transportKind: "anthropic-messages",
        endpointFamily: "messages",
        signal: input.signal,
        headers: {
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: {
          model: input.model,
          max_tokens: 256,
          system: input.systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: input.imageMimeType, data: input.imageBase64 },
                },
                { type: "text", text: input.plainText },
              ],
            },
          ],
        },
      }).then((r) => r.ok ? { ok: true as const, text: extractAnthropicText(r.json) ?? "" } : r);

    case "chat-completions":
      return postJson(attempt.url, {
        transportKind: "chat-completions",
        endpointFamily: "chat_completions",
        signal: input.signal,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          ...(input.vendor === "openrouter"
            ? {
                ...(process.env.PUBLIC_SITE_URL?.trim() ? { "HTTP-Referer": process.env.PUBLIC_SITE_URL.trim() } : {}),
                ...(process.env.SITE_TITLE?.trim() ? { "X-OpenRouter-Title": process.env.SITE_TITLE.trim() } : {}),
              }
            : {}),
        },
        body: {
          model: input.model,
          max_tokens: 256,
          messages: [
            { role: "system", content: input.systemPrompt },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrl } },
                { type: "text", text: input.plainText },
              ],
            },
          ],
        },
      }).then((r) => r.ok ? { ok: true as const, text: extractChatCompletionText(r.json) ?? "" } : r);

    case "google-generate-content": {
      const modelPath = input.model.startsWith("models/") ? input.model : `models/${input.model}`;
      const endpoint = `${attempt.url}/${modelPath.replace(/^models\//, "")}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
      return postJson(endpoint, {
        transportKind: "google-generate-content",
        endpointFamily: "generate_content",
        signal: input.signal,
        body: {
          systemInstruction: { parts: [{ text: input.systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: input.imageMimeType, data: input.imageBase64 } },
                { text: input.plainText },
              ],
            },
          ],
          generationConfig: { maxOutputTokens: 256 },
        },
      }).then((r) => r.ok ? { ok: true as const, text: extractGoogleText(r.json) ?? "" } : r);
    }

    case "openai-responses":
      return postJson(attempt.url, {
        transportKind: "openai-responses",
        endpointFamily: "responses",
        signal: input.signal,
        headers: { Authorization: `Bearer ${input.apiKey}` },
        body: {
          model: input.model,
          instructions: input.systemPrompt,
          input: [
            {
              role: "user",
              content: [
                { type: "input_image", image_url: dataUrl },
                { type: "input_text", text: input.plainText },
              ],
            },
          ],
        },
      }).then((r) => r.ok ? { ok: true as const, text: extractOpenAiResponsesText(r.json) ?? "" } : r);
  }
}

function getTransportAttempts(input: ProcessTextInput): TransportAttempt[] {
  switch (input.vendor) {
    case "openrouter":
      return [
        {
          kind: "chat-completions",
          url: "https://openrouter.ai/api/v1/chat/completions",
          endpointFamily: "chat_completions",
        },
      ];
    case "google":
      return [
        {
          kind: "google-generate-content",
          url: "https://generativelanguage.googleapis.com/v1beta/models",
          endpointFamily: "generate_content",
        },
      ];
    case "opencode-zen":
      return getOpencodeZenTransportAttempt(input.model);
    case "opencode-go":
      return getOpencodeGoTransportAttempt(input.model);
    case "mistral":
    case "mistral-vibe":
      return [
        {
          kind: "chat-completions",
          url: "https://api.mistral.ai/v1/chat/completions",
          endpointFamily: "chat_completions",
        },
      ];
  }
}

function getOpencodeZenTransportAttempt(model: string): TransportAttempt[] {
  if (isOpencodeZenResponsesModel(model)) {
    return [
      {
        kind: "openai-responses",
        url: "https://opencode.ai/zen/v1/responses",
        endpointFamily: "responses",
      },
    ];
  }

  if (isOpencodeZenAnthropicModel(model)) {
    return [
      {
        kind: "anthropic-messages",
        url: "https://opencode.ai/zen/v1/messages",
        endpointFamily: "messages",
      },
    ];
  }

  if (isOpencodeZenGoogleModel(model)) {
    return [
      {
        kind: "google-generate-content",
        url: "https://opencode.ai/zen/v1/models",
        endpointFamily: "generate_content",
      },
    ];
  }

  if (isOpencodeZenChatCompletionsModel(model)) {
    return [
      {
        kind: "chat-completions",
        url: "https://opencode.ai/zen/v1/chat/completions",
        endpointFamily: "chat_completions",
      },
    ];
  }

  throw new AiProviderError(
    `Unknown OpenCode Zen model slug "${model}". Pick a documented Zen model and try again.`,
    {
      statusCode: 400,
      retryable: false,
      failureClass: "unknown_model",
    },
  );
}

function isOpencodeZenResponsesModel(model: string): boolean {
  return model.startsWith("gpt-");
}

function isOpencodeZenAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

function isOpencodeZenGoogleModel(model: string): boolean {
  return model.startsWith("gemini-");
}

function isOpencodeZenChatCompletionsModel(model: string): boolean {
  return [
    "minimax-",
    "glm-",
    "kimi-",
    "big-pickle",
    "qwen",
    "nemotron-",
  ].some((prefix) => model.startsWith(prefix));
}

function getOpencodeGoTransportAttempt(model: string): TransportAttempt[] {
  if (isOpencodeGoChatCompletionsModel(model)) {
    return [
      {
        kind: "chat-completions",
        url: "https://opencode.ai/zen/go/v1/chat/completions",
        endpointFamily: "chat_completions",
      },
    ];
  }

  if (isOpencodeGoAnthropicModel(model)) {
    return [
      {
        kind: "anthropic-messages",
        url: "https://opencode.ai/zen/go/v1/messages",
        endpointFamily: "messages",
      },
    ];
  }

  throw new AiProviderError(
    `Unknown OpenCode Go model slug "${model}". Pick a documented OpenCode Go model and try again.`,
    {
      statusCode: 400,
      retryable: false,
      failureClass: "unknown_model",
    },
  );
}

function normalizeOpencodeGoModel(model: string): string {
  return model.startsWith("opencode-go/") ? model.slice("opencode-go/".length) : model;
}

function normalizeModelForProvider(vendor: AiVendor, model: string): string {
  switch (vendor) {
    case "opencode-go":
      return normalizeOpencodeGoModel(model);
    default:
      return model;
  }
}

function isOpencodeGoChatCompletionsModel(model: string): boolean {
  return new Set([
    "glm-5.1",
    "glm-5",
    "kimi-k2.6",
    "kimi-k2.5",
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "mimo-v2-pro",
    "mimo-v2-omni",
    "mimo-v2.5-pro",
    "mimo-v2.5",
    "qwen3.6-plus",
    "qwen3.5-plus",
  ]).has(model);
}

function isOpencodeGoAnthropicModel(model: string): boolean {
  return new Set([
    "minimax-m2.7",
    "minimax-m2.5",
  ]).has(model);
}

async function runAttempt(attempt: TransportAttempt, input: ProcessTextInput): Promise<TransportResult> {
  switch (attempt.kind) {
    case "openai-responses":
      return postOpenAiResponses(attempt.url, input);
    case "chat-completions":
      return postChatCompletions(attempt.url, input);
    case "anthropic-messages":
      return postAnthropicMessages(attempt.url, input);
    case "google-generate-content":
      return postGoogleGenerateContent(attempt.url, input);
  }
}

async function postOpenAiResponses(url: string, input: ProcessTextInput): Promise<TransportResult> {
  const result = await postJson(url, {
    transportKind: "openai-responses",
    endpointFamily: "responses",
    signal: input.signal,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: {
      model: input.model,
      instructions: input.systemPrompt,
      input: input.plainText,
    },
  });

  if (!result.ok) {
    return result;
  }

  const outputText = extractOpenAiResponsesText(result.json);
  if (!outputText) {
    return {
      ok: false,
      message: "The AI provider returned an unusable response. Try a different model or try again.",
      retryable: false,
      failureClass: "parse",
      transportKind: "openai-responses",
      endpointFamily: "responses",
      url,
    };
  }

  return { ok: true, text: outputText };
}

async function postChatCompletions(url: string, input: ProcessTextInput): Promise<TransportResult> {
  const result = await postJson(url, {
    transportKind: "chat-completions",
    endpointFamily: "chat_completions",
    signal: input.signal,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      ...(input.vendor === "openrouter"
        ? {
            ...(process.env.PUBLIC_SITE_URL?.trim()
              ? { "HTTP-Referer": process.env.PUBLIC_SITE_URL.trim() }
              : {}),
            ...(process.env.SITE_TITLE?.trim()
              ? { "X-OpenRouter-Title": process.env.SITE_TITLE.trim() }
              : {}),
          }
        : {}),
    },
    body: {
      model: input.model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.plainText },
      ],
    },
  });

  if (!result.ok) {
    return result;
  }

  const text = extractChatCompletionText(result.json);
  if (!text) {
    return {
      ok: false,
      message: "The AI provider returned an unusable response. Try a different model or try again.",
      retryable: false,
      failureClass: "parse",
      transportKind: "chat-completions",
      endpointFamily: "chat_completions",
      url,
    };
  }

  return { ok: true, text };
}

async function postAnthropicMessages(url: string, input: ProcessTextInput): Promise<TransportResult> {
  const result = await postJson(url, {
    transportKind: "anthropic-messages",
    endpointFamily: "messages",
    signal: input.signal,
    headers: {
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: input.model,
      max_tokens: 4096,
      system: input.systemPrompt,
      messages: [
        { role: "user", content: input.plainText },
      ],
    },
  });

  if (!result.ok) {
    return result;
  }

  const text = extractAnthropicText(result.json);
  if (!text) {
    return {
      ok: false,
      message: "The AI provider returned an unusable response. Try a different model or try again.",
      retryable: false,
      failureClass: "parse",
      transportKind: "anthropic-messages",
      endpointFamily: "messages",
      url,
    };
  }

  return { ok: true, text };
}

async function postGoogleGenerateContent(url: string, input: ProcessTextInput): Promise<TransportResult> {
  const modelPath = input.model.startsWith("models/") ? input.model : `models/${input.model}`;
  const endpoint = `${url}/${modelPath.replace(/^models\//, "")}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
  const result = await postJson(endpoint, {
    transportKind: "google-generate-content",
    endpointFamily: "generate_content",
    signal: input.signal,
    body: {
      systemInstruction: {
        parts: [{ text: input.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: input.plainText }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 4096,
      },
    },
  });

  if (!result.ok) {
    return result;
  }

  const text = extractGoogleText(result.json);
  if (!text) {
    return {
      ok: false,
      message: "The AI provider returned an unusable response. Try a different model or try again.",
      retryable: false,
      failureClass: "parse",
      transportKind: "google-generate-content",
      endpointFamily: "generate_content",
      url: endpoint,
    };
  }

  return { ok: true, text };
}

async function postJson(
  url: string,
  input: {
    transportKind: TransportAttempt["kind"];
    endpointFamily: EndpointFamily;
    headers?: Record<string, string>;
    body: unknown;
    signal?: AbortSignal;
  },
): Promise<
  | { ok: true; json: unknown }
  | Extract<TransportResult, { ok: false }>
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const abortListener = () => controller.abort();
  input.signal?.addEventListener("abort", abortListener);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...input.headers,
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });

    const text = await response.text();
    const json = tryParseJson(text);

    if (!response.ok) {
      return {
        ok: false,
        transportKind: input.transportKind,
        endpointFamily: input.endpointFamily,
        url,
        message: readErrorMessage(json) || `Provider request failed with status ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
        failureClass: "upstream_http",
        upstreamStatus: response.status,
      };
    }

    return { ok: true, json };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (input.signal?.aborted) {
        return {
          ok: false,
          transportKind: input.transportKind,
          endpointFamily: input.endpointFamily,
          url,
          message: "The AI request was cancelled.",
          retryable: false,
          failureClass: "network",
        };
      }
      return {
        ok: false,
        transportKind: input.transportKind,
        endpointFamily: input.endpointFamily,
        url,
        message: "The AI provider timed out. Try again.",
        retryable: true,
        failureClass: "timeout",
      };
    }

    return {
      ok: false,
      transportKind: input.transportKind,
      endpointFamily: input.endpointFamily,
      url,
      message: "Provider request failed",
      retryable: true,
      failureClass: "network",
    };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abortListener);
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function shouldTryNextAttempt(status: number): boolean {
  return status === 400 || status === 404 || status === 415 || status === 422;
}

function mapFailureToApiStatus(
  failure:
    | Extract<TransportResult, { ok: false }>
    | null,
): number {
  if (!failure) {
    return 502;
  }

  if (failure.failureClass === "timeout" || failure.failureClass === "network" || failure.failureClass === "parse") {
    return 502;
  }

  if (failure.failureClass === "unknown_model") {
    return 400;
  }

  const status = failure.upstreamStatus ?? 502;
  if (status === 401 || status === 403) {
    return 400;
  }
  if (status === 429) {
    return 429;
  }
  if (status >= 500) {
    return 502;
  }
  return 400;
}

function readErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.error === "string") {
    return record.error;
  }

  if (record.error && typeof record.error === "object") {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string") {
      return nested.message;
    }
  }

  if (typeof record.message === "string") {
    return record.message;
  }

  return null;
}

function extractOpenAiResponsesText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  const output = Array.isArray(record.output) ? record.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const itemRecord = item as Record<string, unknown>;
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : [];
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const contentRecord = contentItem as Record<string, unknown>;
      if (contentRecord.type === "output_text" && typeof contentRecord.text === "string") {
        parts.push(contentRecord.text);
      }
    }
  }

  return joinTextParts(parts);
}

function extractChatCompletionText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const choices = Array.isArray((payload as Record<string, unknown>).choices)
    ? (payload as Record<string, unknown>).choices as unknown[]
    : [];
  const first = choices[0];
  if (!first || typeof first !== "object") {
    return null;
  }

  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") {
    return normalizeOutput(content);
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const text = (item as Record<string, unknown>).text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
    return joinTextParts(parts);
  }

  return null;
}

function extractAnthropicText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const content = Array.isArray((payload as Record<string, unknown>).content)
    ? (payload as Record<string, unknown>).content as unknown[]
    : [];
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
    }
  }

  return joinTextParts(parts);
}

function extractGoogleText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidates = Array.isArray((payload as Record<string, unknown>).candidates)
    ? (payload as Record<string, unknown>).candidates as unknown[]
    : [];
  const first = candidates[0];
  if (!first || typeof first !== "object") {
    return null;
  }

  const content = (first as Record<string, unknown>).content;
  if (!content || typeof content !== "object") {
    return null;
  }

  const parts = Array.isArray((content as Record<string, unknown>).parts)
    ? (content as Record<string, unknown>).parts as unknown[]
    : [];
  const texts: string[] = [];
  for (const item of parts) {
    if (!item || typeof item !== "object") continue;
    const text = (item as Record<string, unknown>).text;
    if (typeof text === "string") {
      texts.push(text);
    }
  }

  return joinTextParts(texts);
}

function joinTextParts(parts: string[]): string | null {
  return normalizeOutput(parts.join("\n").trim());
}

function normalizeOutput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderError, processTextWithProvider } from "./ai-providers";
import { logger } from "./logger";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("processTextWithProvider", () => {
  it("uses the OpenAI-compatible chat completions shape for OpenRouter", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "anthropic/claude-sonnet-4.5",
        messages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Hello world" },
        ],
      });
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        Authorization: "Bearer sk-openrouter",
      });

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Expanded via OpenRouter",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await processTextWithProvider({
      vendor: "openrouter",
      model: "anthropic/claude-sonnet-4.5",
      apiKey: "sk-openrouter",
      plainText: "Hello world",
      systemPrompt: "System prompt",
    });

    expect(result).toBe("Expanded via OpenRouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses DeepSeek's OpenAI-compatible chat completions endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "deepseek-v4-flash",
        max_tokens: 4096,
        messages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Hello world" },
        ],
      });
      expect(body.thinking).toBeUndefined();
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        Authorization: "Bearer sk-deepseek",
      });

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Expanded via DeepSeek",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await processTextWithProvider({
      vendor: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "sk-deepseek",
      plainText: "Hello world",
      systemPrompt: "System prompt",
    });

    expect(result).toBe("Expanded via DeepSeek");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disables DeepSeek thinking and expands token budget for art-piece generation", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "deepseek-v4-pro",
        max_tokens: 12000,
        thinking: { type: "disabled" },
        messages: [
          { role: "system", content: "Piece system prompt" },
          { role: "user", content: "Make a p5 page flip animation" },
        ],
      });

      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "```html\n<div id=\"canvas-container\"></div>\n```\n```css\n#canvas-container{height:100%;}\n```\n```javascript\nwindow.sketch = (p) => {};\n```",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await processTextWithProvider({
      vendor: "deepseek",
      model: "deepseek-v4-pro",
      apiKey: "sk-deepseek",
      plainText: "Make a p5 page flip animation",
      systemPrompt: "Piece system prompt",
      intent: "art-piece",
    });

    expect(result).toContain("window.sketch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("diagnoses DeepSeek reasoning-only chat-completions responses", async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "",
                reasoning_content: "I should produce code blocks, but no final answer was emitted.",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    await expect(
      processTextWithProvider({
        vendor: "deepseek",
        model: "deepseek-v4-flash",
        apiKey: "sk-deepseek",
        plainText: "Make a p5 sketch",
        systemPrompt: "System prompt",
        intent: "art-piece",
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      statusCode: 502,
      retryable: true,
      failureClass: "parse",
      finishReason: "stop",
      reasoningContentLength: expect.any(Number),
      rawResponsePreview: expect.stringContaining("reasoning_content"),
      message:
        "The AI provider returned reasoning but no usable final answer. Try again or use a non-thinking/code-generation model setting.",
    } satisfies Partial<AiProviderError>);
  });

  it("diagnoses truncated chat-completions responses", async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: { content: "" },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    await expect(
      processTextWithProvider({
        vendor: "deepseek",
        model: "deepseek-v4-pro",
        apiKey: "sk-deepseek",
        plainText: "Make a Three.js sketch",
        systemPrompt: "System prompt",
        intent: "art-piece",
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      statusCode: 502,
      retryable: true,
      failureClass: "parse",
      finishReason: "length",
      message: expect.stringContaining("truncated"),
    } satisfies Partial<AiProviderError>);
  });

  it("uses the Google generateContent shape for Google", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=sk-google",
      );
      const body = JSON.parse(String(init?.body));
      expect(body.systemInstruction.parts[0].text).toBe("System prompt");
      expect(body.contents[0].parts[0].text).toBe("Hello world");

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Expanded Gemini text" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await processTextWithProvider({
      vendor: "google",
      model: "gemini-2.5-pro",
      apiKey: "sk-google",
      plainText: "Hello world",
      systemPrompt: "System prompt",
    });

    expect(result).toBe("Expanded Gemini text");
  });

  it("routes Big Pickle directly to the Zen chat-completions endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://opencode.ai/zen/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "big-pickle",
        messages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Hello world" },
        ],
      });
      expect(body.thinking).toBeUndefined();

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Expanded via Big Pickle",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await processTextWithProvider({
      vendor: "opencode-zen",
      model: "big-pickle",
      apiKey: "sk-zen",
      plainText: "Hello world",
      systemPrompt: "System prompt",
    });

    expect(result).toBe("Expanded via Big Pickle");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("routes Opencode Zen MiniMax art-piece requests to chat completions with the art-piece timeout budget", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://opencode.ai/zen/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "minimax-m3-free",
        max_tokens: 4096,
        thinking: { type: "disabled" },
      });
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toContain("Piece system prompt");
      expect(body.messages[0].content).toContain("Do not output <think>");
      expect(body.messages[0].content).toContain("Output only the required fenced HTML, CSS, and JavaScript code blocks");
      expect(body.messages[1]).toMatchObject({ role: "user", content: "Make a Three.js sculpture" });

      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "```html\n<div id=\"container\"></div>\n```\n```css\n#container{height:100%;}\n```\n```javascript\nwindow.sketch = (runtime) => {};\n```",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await processTextWithProvider({
      vendor: "opencode-zen",
      model: "minimax-m3-free",
      apiKey: "sk-zen",
      plainText: "Make a Three.js sculpture",
      systemPrompt: "Piece system prompt",
      intent: "art-piece",
    });

    expect(result).toContain("window.sketch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 1_200_000)).toBe(true);
  });

  it("routes documented OpenCode Go chat-completions models to the Go chat endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "kimi-k2.5",
        messages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Hello world" },
        ],
      });
      expect(body.thinking).toBeUndefined();

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Expanded via OpenCode Go chat endpoint",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await processTextWithProvider({
      vendor: "opencode-go",
      model: "opencode-go/kimi-k2.5",
      apiKey: "sk-go",
      plainText: "Hello world",
      systemPrompt: "System prompt",
    });

    expect(result).toBe("Expanded via OpenCode Go chat endpoint");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("routes OpenCode Go minimax-m3 art-piece requests to chat completions with the art-piece timeout budget", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "minimax-m3",
        max_tokens: 4096,
        thinking: { type: "disabled" },
      });
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toContain("Piece system prompt");
      expect(body.messages[0].content).toContain("Do not output <think>");
      expect(body.messages[0].content).toContain("Output only the required fenced HTML, CSS, and JavaScript code blocks");
      expect(body.messages[1]).toMatchObject({ role: "user", content: "Make a p5 kinetic sketch" });

      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "```html\n<div id=\"canvas-container\"></div>\n```\n```css\n#canvas-container{height:100%;}\n```\n```javascript\nwindow.sketch = (p) => {};\n```",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await processTextWithProvider({
      vendor: "opencode-go",
      model: "opencode-go/minimax-m3",
      apiKey: "sk-go",
      plainText: "Make a p5 kinetic sketch",
      systemPrompt: "Piece system prompt",
      intent: "art-piece",
    });

    expect(result).toContain("window.sketch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 1_200_000)).toBe(true);
  });

  it("routes documented OpenCode Go MiniMax models to the Go messages endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://opencode.ai/zen/go/v1/messages");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "minimax-m2.5",
        system: "System prompt",
        messages: [{ role: "user", content: "Hello world" }],
      });

      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Expanded via OpenCode Go messages endpoint" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await processTextWithProvider({
      vendor: "opencode-go",
      model: "minimax-m2.5",
      apiKey: "sk-go",
      plainText: "Hello world",
      systemPrompt: "System prompt",
    });

    expect(result).toBe("Expanded via OpenCode Go messages endpoint");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast for unknown OpenCode Go model slugs", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(
      processTextWithProvider({
        vendor: "opencode-go",
        model: "not-a-documented-go-model",
        apiKey: "sk-go",
        plainText: "Hello world",
        systemPrompt: "System prompt",
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      statusCode: 400,
      message:
        'Unknown OpenCode Go model slug "not-a-documented-go-model". Set an Endpoint Kind in Admin → AI to override auto-detection, or pick a documented OpenCode Go model.',
    } satisfies Partial<AiProviderError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes Claude-family Zen models directly to the Zen messages endpoint", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://opencode.ai/zen/v1/messages");
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Expanded via Zen Anthropic endpoint" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await processTextWithProvider({
      vendor: "opencode-zen",
      model: "claude-3-5-haiku",
      apiKey: "sk-zen",
      plainText: "Hello world",
      systemPrompt: "System prompt",
    });

    expect(result).toBe("Expanded via Zen Anthropic endpoint");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast for unknown Zen model slugs", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(
      processTextWithProvider({
        vendor: "opencode-zen",
        model: "not-a-documented-zen-model",
        apiKey: "sk-zen",
        plainText: "Hello world",
        systemPrompt: "System prompt",
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      statusCode: 400,
      message:
        'Unknown OpenCode Zen model slug "not-a-documented-zen-model". Pick a documented Zen model and try again.',
    } satisfies Partial<AiProviderError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps provider failures to a stable error", async () => {
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: "Bad API key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await expect(
      processTextWithProvider({
        vendor: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        apiKey: "bad-key",
        plainText: "Hello world",
        systemPrompt: "System prompt",
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      statusCode: 400,
      failureClass: "upstream_http",
    } satisfies Partial<AiProviderError>);
  });

  it("classifies local timeouts separately from upstream http failures", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    global.fetch = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as typeof fetch;

    await expect(
      processTextWithProvider({
        vendor: "opencode-zen",
        model: "big-pickle",
        apiKey: "sk-zen",
        plainText: "Hello world",
        systemPrompt: "System prompt",
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      statusCode: 502,
      retryable: true,
      failureClass: "timeout",
      transportKind: "chat-completions",
      endpointFamily: "chat_completions",
      url: "https://opencode.ai/zen/v1/chat/completions",
      message: "The AI provider timed out. Try again.",
    } satisfies Partial<AiProviderError>);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor: "opencode-zen",
        model: "big-pickle",
        failureClass: "timeout",
        transportKind: "chat-completions",
        endpointFamily: "chat_completions",
        upstreamStatus: undefined,
      }),
      "AI provider request failed",
    );
  });

  it("classifies unusable success payloads as parse failures", async () => {
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await expect(
      processTextWithProvider({
        vendor: "opencode-zen",
        model: "big-pickle",
        apiKey: "sk-zen",
        plainText: "Hello world",
        systemPrompt: "System prompt",
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      statusCode: 502,
      retryable: false,
      failureClass: "parse",
      message: "The AI provider returned an unusable response. Try a different model or try again.",
    } satisfies Partial<AiProviderError>);
  });
});

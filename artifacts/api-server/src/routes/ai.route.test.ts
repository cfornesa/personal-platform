import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.AI_SETTINGS_ENCRYPTION_KEY = "12345678901234567890123456789012";

type AuthShape = {
  session: { user: { id: string } } | null;
  user:
    | {
        id: string;
        status: "active" | "blocked";
        role: "owner" | "member";
        preferredArtPieceVendor?: string | null;
        preferredVendorTextImprove?: string | null;
        preferredVendorAltText?: string | null;
      }
    | null;
};

type AiSettingsRow = {
  userId: string;
  vendor: string;
  enabled: number;
  model: string | null;
  encryptedApiKey: string | null;
};

type MockResponse = {
  statusCode: number;
  body: unknown;
  finished: boolean;
  headers: Record<string, string>;
  status: (code: number) => MockResponse;
  setHeader: (name: string, value: string) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

let authState: AuthShape = {
  session: { user: { id: "user-1" } },
  user: { id: "user-1", status: "active", role: "owner" },
};

let aiSettingsRows: AiSettingsRow[] = [];

const processTextWithProvider = vi.fn();
const processImageWithProvider = vi.fn();
const mysqlPoolQuery = vi.fn();

vi.mock("../lib/current-user", () => ({
  loadCurrentUser: async () => authState,
  loadAuthSession: async () => authState.session,
}));

vi.mock("../lib/ai-providers", () => ({
  AiVisionNotSupportedError: class AiVisionNotSupportedError extends Error {
    constructor(message = "This AI model does not support image analysis.") {
      super(message);
      this.name = "AiVisionNotSupportedError";
    }
  },
  AiProviderError: class AiProviderError extends Error {
    statusCode: number;
    retryable: boolean;
    failureClass: string;

    constructor(
      message: string,
      input:
        | number
        | {
            statusCode?: number;
            retryable?: boolean;
            failureClass?: string;
          } = {},
      retryable = false,
    ) {
      super(message);
      this.name = "AiProviderError";
      if (typeof input === "number") {
        this.statusCode = input;
        this.retryable = retryable;
        this.failureClass = "network";
      } else {
        this.statusCode = input.statusCode ?? 502;
        this.retryable = input.retryable ?? false;
        this.failureClass = input.failureClass ?? "network";
      }
    }
  },
  processTextWithProvider,
  processImageWithProvider,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => aiSettingsRows,
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (authState.user) {
            if (Object.prototype.hasOwnProperty.call(values, "preferredArtPieceVendor")) {
              authState.user.preferredArtPieceVendor =
                typeof values.preferredArtPieceVendor === "string" || values.preferredArtPieceVendor === null
                  ? (values.preferredArtPieceVendor as string | null)
                  : authState.user.preferredArtPieceVendor ?? null;
            }
            if (Object.prototype.hasOwnProperty.call(values, "preferredVendorTextImprove")) {
              authState.user.preferredVendorTextImprove =
                typeof values.preferredVendorTextImprove === "string" || values.preferredVendorTextImprove === null
                  ? (values.preferredVendorTextImprove as string | null)
                  : authState.user.preferredVendorTextImprove ?? null;
            }
            if (Object.prototype.hasOwnProperty.call(values, "preferredVendorAltText")) {
              authState.user.preferredVendorAltText =
                typeof values.preferredVendorAltText === "string" || values.preferredVendorAltText === null
                  ? (values.preferredVendorAltText as string | null)
                  : authState.user.preferredVendorAltText ?? null;
            }
          }
        },
      }),
    }),
  },
  eq: () => ({}),
  and: () => ({}),
  mysqlPool: {
    query: mysqlPoolQuery,
  },
  userAiVendorSettingsTable: {
    userId: "user_id",
    vendor: "vendor",
  },
  usersTable: {
    id: "id",
    preferredArtPieceVendor: "preferred_art_piece_vendor",
    preferredVendorTextImprove: "preferred_vendor_text_improve",
    preferredVendorAltText: "preferred_vendor_alt_text",
  },
}));

const { encryptAiApiKey } = await import("../lib/ai-settings");
const { default: aiRouter } = await import("./ai");

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    finished: false,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.finished = true;
      return this;
    },
  };
}

function findRoute(path: string, method: "get" | "patch" | "post") {
  const stack = (aiRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: any, res: any, next: (err?: unknown) => void) => unknown }>;
      };
    }>;
  }).stack;

  const layer = stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer?.route) {
    throw new Error(`Missing route ${method.toUpperCase()} ${path}`);
  }

  return layer.route.stack.map((entry) => entry.handle);
}

async function runRoute(
  path: string,
  method: "get" | "patch" | "post",
  input: { body?: unknown } = {},
) {
  const handlers = findRoute(path, method);
  const req: Record<string, unknown> = {
    body: input.body ?? {},
    params: {},
    query: {},
    headers: {},
  };
  const res = createResponse();

  for (const handler of handlers) {
    let nextCalled = false;
    let nextError: unknown;
    await handler(req, res, (err?: unknown) => {
      nextCalled = true;
      nextError = err;
    });
    if (nextError) {
      throw nextError;
    }
    if (res.finished || !nextCalled) {
      break;
    }
  }

  return { req, res };
}

beforeEach(() => {
  authState = {
    session: { user: { id: "user-1" } },
    user: { id: "user-1", status: "active", role: "owner" },
  };
  aiSettingsRows = [];
  processTextWithProvider.mockReset();
  processImageWithProvider.mockReset();
  mysqlPoolQuery.mockReset();
  mysqlPoolQuery.mockImplementation(async (_sql: string, params?: unknown[]) => {
    const nextRow: AiSettingsRow = {
      userId: String(params?.[0] ?? "user-1"),
      vendor: String(params?.[1] ?? "opencode-zen"),
      enabled: Number(params?.[2] ?? 0),
      model: (params?.[3] as string | null) ?? null,
      encryptedApiKey: (params?.[4] as string | null) ?? null,
    };
    const existingIndex = aiSettingsRows.findIndex(
      (row) => row.userId === nextRow.userId && row.vendor === nextRow.vendor,
    );
    if (existingIndex >= 0) {
      aiSettingsRows[existingIndex] = nextRow;
    } else {
      aiSettingsRows.push(nextRow);
    }
    return [];
  });
});

describe("AI routes", () => {
  it("rejects unauthenticated users", async () => {
    authState = { session: null, user: null };

    const { res } = await runRoute("/ai/process", "post", {
      body: { content: "<p>Hello</p>", vendor: "opencode-zen" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("rejects non-owners from reading AI settings", async () => {
    authState = {
      session: { user: { id: "user-1" } },
      user: { id: "user-1", status: "active", role: "member" },
    };

    const { res } = await runRoute("/users/me/ai-settings", "get");

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden" });
  });

  it("returns no-store cache headers for AI settings reads", async () => {
    const { res } = await runRoute("/users/me/ai-settings", "get");

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store, max-age=0");
  });

  it("requires an api key before enabling a vendor", async () => {
    const { res } = await runRoute("/users/me/ai-settings", "patch", {
      body: {
        settings: [
          {
            vendor: "opencode-zen",
            enabled: true,
            model: "big-pickle",
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "Opencode Zen requires an API key before it can be enabled",
    });
  });

  it("saves per-vendor AI settings without returning API keys", async () => {
    const { res } = await runRoute("/users/me/ai-settings", "patch", {
      body: {
        settings: [
          {
            vendor: "opencode-zen",
            enabled: true,
            model: "big-pickle",
            apiKey: "sk-secret",
          },
          {
            vendor: "google",
            enabled: false,
            model: "gemini-2.5-flash",
            apiKey: "sk-google",
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(res.body).toMatchObject({
      availableVendors: expect.any(Array),
      preferredArtPieceVendor: null,
      settings: expect.arrayContaining([
        expect.objectContaining({
          vendor: "opencode-zen",
          vendorLabel: "Opencode Zen",
          enabled: true,
          configured: true,
          model: "big-pickle",
        }),
        expect.objectContaining({
          vendor: "google",
          vendorLabel: "Google",
          enabled: false,
          configured: true,
          model: "gemini-2.5-flash",
        }),
      ]),
    });
    expect(res.body).not.toHaveProperty("apiKey");
    expect(aiSettingsRows[0]?.encryptedApiKey).toBeTruthy();
    expect(aiSettingsRows[0]?.encryptedApiKey).not.toContain("sk-secret");
  });

  it("persists the preferred art piece vendor on the owner account", async () => {
    const { res } = await runRoute("/users/me/ai-settings", "patch", {
      body: {
        settings: [],
        preferredArtPieceVendor: "google",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      preferredArtPieceVendor: "google",
    });
    expect(authState.user?.preferredArtPieceVendor).toBe("google");
  });

  it("accepts DeepSeek for text and art piece preferences but not image descriptions", async () => {
    const { res } = await runRoute("/users/me/ai-settings", "patch", {
      body: {
        settings: [
          {
            vendor: "deepseek",
            enabled: true,
            model: "deepseek-v4-flash",
            apiKey: "sk-deepseek",
          },
        ],
        preferredVendorTextImprove: "deepseek",
        preferredArtPieceVendor: "deepseek",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      preferredVendorTextImprove: "deepseek",
      preferredArtPieceVendor: "deepseek",
      preferredVendorAltText: null,
      settings: expect.arrayContaining([
        expect.objectContaining({
          vendor: "deepseek",
          vendorLabel: "DeepSeek",
          enabled: true,
          configured: true,
          model: "deepseek-v4-flash",
        }),
      ]),
    });
  });

  it("rejects DeepSeek as an image description preference", async () => {
    const { res } = await runRoute("/users/me/ai-settings", "patch", {
      body: {
        settings: [],
        preferredVendorAltText: "deepseek",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'Unsupported image description AI vendor "deepseek"',
    });
  });

  it("allows re-enabling a saved vendor without re-sending the api key", async () => {
    aiSettingsRows = [
      {
        userId: "user-1",
        vendor: "openrouter",
        enabled: 0,
        model: "anthropic/claude-sonnet-4.5",
        encryptedApiKey: encryptAiApiKey("sk-secret"),
      },
    ];

    const { res } = await runRoute("/users/me/ai-settings", "patch", {
      body: {
        settings: [
          {
            vendor: "openrouter",
            enabled: true,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      settings: expect.arrayContaining([
        expect.objectContaining({
          vendor: "openrouter",
          enabled: true,
          configured: true,
          model: "anthropic/claude-sonnet-4.5",
        }),
      ]),
    });
  });

  it("processes text with the selected vendor settings", async () => {
    aiSettingsRows = [
      {
        userId: "user-1",
        vendor: "opencode-zen",
        enabled: 1,
        model: "big-pickle",
        encryptedApiKey: encryptAiApiKey("sk-zen"),
      },
      {
        userId: "user-1",
        vendor: "google",
        enabled: 1,
        model: "gemini-2.5-flash",
        encryptedApiKey: encryptAiApiKey("sk-google"),
      },
    ];
    processTextWithProvider.mockResolvedValue("Improved plain text");

    const { res } = await runRoute("/ai/process", "post", {
      body: {
        content: "<p>Hello <strong>world</strong></p><img src='x' /><iframe src='y'></iframe>",
        vendor: "google",
      },
    });

    expect(processTextWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor: "google",
        model: "gemini-2.5-flash",
        apiKey: "sk-google",
        plainText: "Hello world",
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(res.body).toEqual({
      text: "Improved plain text",
      vendor: "google",
      vendorLabel: "Google",
      model: "gemini-2.5-flash",
    });
  });

  it("rejects a selected vendor that is disabled or incomplete", async () => {
    aiSettingsRows = [
      {
        userId: "user-1",
        vendor: "opencode-zen",
        enabled: 0,
        model: "big-pickle",
        encryptedApiKey: encryptAiApiKey("sk-zen"),
      },
    ];

    const { res } = await runRoute("/ai/process", "post", {
      body: { content: "<p>Hello world</p>", vendor: "opencode-zen" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: "Opencode Zen is not enabled and configured for this user",
    });
  });

  it("rejects DeepSeek for image alt text because API image input is not verified", async () => {
    const { res } = await runRoute("/ai/describe-image", "post", {
      body: {
        imageUrl: "/api/media/example.png",
        vendor: "deepseek",
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      error: "DeepSeek is not supported for image alt text generation.",
      code: "vision_not_supported",
    });
    expect(processImageWithProvider).not.toHaveBeenCalled();
  });

  it("returns stable JSON for provider failures", async () => {
    aiSettingsRows = [
      {
        userId: "user-1",
        vendor: "opencode-zen",
        enabled: 1,
        model: "big-pickle",
        encryptedApiKey: encryptAiApiKey("sk-zen"),
      },
    ];
    processTextWithProvider.mockRejectedValue(
      new (await import("../lib/ai-providers")).AiProviderError(
        "The AI provider timed out. Try again.",
        { statusCode: 502, retryable: true, failureClass: "timeout" },
      ),
    );

    const { res } = await runRoute("/ai/process", "post", {
      body: { content: "<p>Hello world</p>", vendor: "opencode-zen" },
    });

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: "The AI provider timed out. Try again." });
  });
});

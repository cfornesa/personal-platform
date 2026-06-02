import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.AI_SETTINGS_ENCRYPTION_KEY = "12345678901234567890123456789012";

type AuthShape = {
  session: { user: { id: string } } | null;
  user:
    | {
        id: string;
        status: "active" | "blocked";
        role: "owner" | "member";
        preferredArtPieceProfileId?: number | null;
        preferredTextImproveProfileId?: number | null;
        preferredAltTextProfileId?: number | null;
      }
    | null;
};

type AiProfileRow = {
  id: number;
  userId: string;
  vendor: string;
  profileName: string;
  endpointKind: string | null;
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

let authState: AuthShape = { session: null, user: null };
let aiProfileRows: AiProfileRow[] = [];
let nextProfileId = 100;

const processTextWithProvider = vi.fn();
const processImageWithProvider = vi.fn();
const mysqlPoolQuery = vi.fn();
const mysqlPoolQueryInsert = vi.fn();

vi.mock("@/middlewares/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => {
    const req = _req as Record<string, unknown>;
    const res = _res as MockResponse;
    if (!authState.session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.currentUser = authState.user;
    next();
  },
  requireOwner: (_req: unknown, _res: unknown, next: () => void) => {
    const req = _req as Record<string, unknown>;
    const res = _res as MockResponse;
    if (!req.currentUser || (req.currentUser as { role: string }).role !== "owner") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
}));

vi.mock("../lib/ai-providers", async () => {
  const actual = await vi.importActual("../lib/ai-providers");
  return { ...actual, processTextWithProvider, processImageWithProvider };
});

vi.mock("../lib/media", () => ({
  getMediaBuffer: vi.fn(),
}));

vi.mock("file-type", () => ({
  fileTypeFromBuffer: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async (_condition: unknown) => {
          // For simplicity, return all profile rows for the user
          // (tests set up aiProfileRows appropriately)
          return aiProfileRows;
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (authState.user) {
            if (Object.prototype.hasOwnProperty.call(values, "preferredArtPieceProfileId")) {
              authState.user.preferredArtPieceProfileId =
                typeof values.preferredArtPieceProfileId === "number" || values.preferredArtPieceProfileId === null
                  ? (values.preferredArtPieceProfileId as number | null)
                  : authState.user.preferredArtPieceProfileId ?? null;
            }
            if (Object.prototype.hasOwnProperty.call(values, "preferredTextImproveProfileId")) {
              authState.user.preferredTextImproveProfileId =
                typeof values.preferredTextImproveProfileId === "number" || values.preferredTextImproveProfileId === null
                  ? (values.preferredTextImproveProfileId as number | null)
                  : authState.user.preferredTextImproveProfileId ?? null;
            }
            if (Object.prototype.hasOwnProperty.call(values, "preferredAltTextProfileId")) {
              authState.user.preferredAltTextProfileId =
                typeof values.preferredAltTextProfileId === "number" || values.preferredAltTextProfileId === null
                  ? (values.preferredAltTextProfileId as number | null)
                  : authState.user.preferredAltTextProfileId ?? null;
            }
          }
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        // Deletion handled via mysqlPool mock below
      },
    }),
  },
  eq: () => ({}),
  and: () => ({}),
  inArray: () => ({}),
  mysqlPool: {
    query: mysqlPoolQuery,
  },
  userAiVendorSettingsTable: {
    id: "id",
    userId: "user_id",
    vendor: "vendor",
    profileName: "profile_name",
    endpointKind: "endpoint_kind",
  },
  usersTable: {
    id: "id",
    preferredArtPieceProfileId: "preferred_art_piece_profile_id",
    preferredTextImproveProfileId: "preferred_text_improve_profile_id",
    preferredAltTextProfileId: "preferred_alt_text_profile_id",
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
        stack: Array<{ handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown }>;
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
  aiProfileRows = [];
  nextProfileId = 100;
  processTextWithProvider.mockReset();
  processImageWithProvider.mockReset();
  mysqlPoolQuery.mockReset();
  mysqlPoolQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const isUpdate = sql.trim().toUpperCase().startsWith("UPDATE");
    const isInsert = sql.trim().toUpperCase().startsWith("INSERT");

    if (isInsert) {
      const id = nextProfileId++;
      const newRow: AiProfileRow = {
        id,
        userId: String(params?.[0] ?? "user-1"),
        vendor: String(params?.[1] ?? "opencode-zen"),
        profileName: String(params?.[2] ?? "Default"),
        endpointKind: (params?.[3] as string | null) ?? null,
        enabled: Number(params?.[4] ?? 0),
        model: (params?.[5] as string | null) ?? null,
        encryptedApiKey: (params?.[6] as string | null) ?? null,
      };
      aiProfileRows.push(newRow);
      return [{ insertId: id }];
    }

    if (isUpdate) {
      // UPDATE ... WHERE id = ? AND user_id = ?
      const id = params?.[params.length - 2] as number;
      const idx = aiProfileRows.findIndex((r) => r.id === id);
      if (idx >= 0) {
        aiProfileRows[idx] = {
          ...aiProfileRows[idx]!,
          profileName: String(params?.[0] ?? aiProfileRows[idx]!.profileName),
          endpointKind: (params?.[1] as string | null) ?? aiProfileRows[idx]!.endpointKind,
          enabled: Number(params?.[2] ?? aiProfileRows[idx]!.enabled),
          model: (params?.[3] as string | null) ?? aiProfileRows[idx]!.model,
          encryptedApiKey: (params?.[4] as string | null) ?? aiProfileRows[idx]!.encryptedApiKey,
        };
      }
      return [];
    }

    return [];
  });
});

describe("AI routes", () => {
  it("rejects unauthenticated users", async () => {
    authState = { session: null, user: null };

    const { res } = await runRoute("/ai/process", "post", {
      body: { content: "<p>Hello</p>", profileId: 1 },
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

  it("returns empty profile list when no profiles exist", async () => {
    const { res } = await runRoute("/users/me/ai-settings", "get");

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      availableVendors: expect.any(Array),
      profiles: [],
      preferredArtPieceProfileId: null,
      preferredTextImproveProfileId: null,
      preferredAltTextProfileId: null,
    });
  });

  it("requires an api key before enabling a new profile", async () => {
    const { res } = await runRoute("/users/me/ai-settings", "patch", {
      body: {
        profiles: [
          {
            vendor: "opencode-zen",
            profileName: "Opencode Zen - big-pickle",
            enabled: true,
            model: "big-pickle",
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringContaining("requires an API key"),
    });
  });

  it("creates a new profile and returns it without exposing the API key", async () => {
    const { res } = await runRoute("/users/me/ai-settings", "patch", {
      body: {
        profiles: [
          {
            vendor: "opencode-zen",
            profileName: "Opencode Zen - big-pickle",
            enabled: true,
            model: "big-pickle",
            apiKey: "sk-secret",
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(res.body).toMatchObject({
      availableVendors: expect.any(Array),
      profiles: expect.arrayContaining([
        expect.objectContaining({
          vendor: "opencode-zen",
          vendorLabel: "Opencode Zen",
          profileName: "Opencode Zen - big-pickle",
          enabled: true,
          configured: true,
          model: "big-pickle",
        }),
      ]),
    });
    expect(res.body).not.toHaveProperty("apiKey");
    expect(aiProfileRows[0]?.encryptedApiKey).toBeTruthy();
    expect(aiProfileRows[0]?.encryptedApiKey).not.toContain("sk-secret");
  });

  it("processes text using a profile ID", async () => {
    aiProfileRows = [
      {
        id: 42,
        userId: "user-1",
        vendor: "google",
        profileName: "Google - gemini-2.5-flash",
        endpointKind: null,
        enabled: 1,
        model: "gemini-2.5-flash",
        encryptedApiKey: encryptAiApiKey("sk-google"),
      },
    ];
    processTextWithProvider.mockResolvedValue("Improved plain text");

    const { res } = await runRoute("/ai/process", "post", {
      body: {
        content: "<p>Hello <strong>world</strong></p><img src='x' /><iframe src='y'></iframe>",
        profileId: 42,
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
      profileName: "Google - gemini-2.5-flash",
      model: "gemini-2.5-flash",
    });
  });

  it("rejects a profile that is disabled", async () => {
    aiProfileRows = [
      {
        id: 7,
        userId: "user-1",
        vendor: "opencode-zen",
        profileName: "Opencode Zen - big-pickle",
        endpointKind: null,
        enabled: 0,
        model: "big-pickle",
        encryptedApiKey: encryptAiApiKey("sk-zen"),
      },
    ];

    const { res } = await runRoute("/ai/process", "post", {
      body: { content: "<p>Hello world</p>", profileId: 7 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringContaining("not enabled") });
  });

  it("returns 404 for an unknown profile ID", async () => {
    const { res } = await runRoute("/ai/process", "post", {
      body: { content: "<p>Hello world</p>", profileId: 9999 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "AI profile not found" });
  });

  it("returns stable JSON for provider failures", async () => {
    aiProfileRows = [
      {
        id: 3,
        userId: "user-1",
        vendor: "opencode-zen",
        profileName: "Opencode Zen - big-pickle",
        endpointKind: null,
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
      body: { content: "<p>Hello world</p>", profileId: 3 },
    });

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: "The AI provider timed out. Try again." });
  });

  it("passes endpointKind from the profile to the provider", async () => {
    aiProfileRows = [
      {
        id: 55,
        userId: "user-1",
        vendor: "opencode-go",
        profileName: "Opencode Go - minimax-m3",
        endpointKind: "anthropic-messages",
        enabled: 1,
        model: "minimax-m3",
        encryptedApiKey: encryptAiApiKey("sk-go"),
      },
    ];
    processTextWithProvider.mockResolvedValue("Generated code");

    await runRoute("/ai/process", "post", {
      body: { content: "Create a particle effect", profileId: 55 },
    });

    expect(processTextWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor: "opencode-go",
        model: "minimax-m3",
        endpointKind: "anthropic-messages",
      }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

const processTextWithProvider = vi.fn();

vi.mock("@/middlewares/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireOwner: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middlewares/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireOwner: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/ai-providers", async () => {
  const actual = await vi.importActual("../lib/ai-providers");
  return { ...actual, processTextWithProvider };
});

vi.mock("@workspace/db", () => ({
  artPieceEngineSchema: z.enum(["p5", "c2", "three"]),
  artPieceStatusSchema: z.enum(["active", "archived"]),
  artPiecesTable: {},
  artPieceVersionsTable: {},
  db: {},
  desc: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  mysqlPool: {},
  userAiVendorSettingsTable: {},
  userAiVendorKeysTable: {},
}));

const { AiProviderError } = await import("../lib/ai-providers");
const { generateValidatedDraft } = await import("./art-pieces");

describe("generateValidatedDraft provider retries", () => {
  it("retries retryable Opencode provider failures without classifying them as validation failures", async () => {
    processTextWithProvider
      .mockRejectedValueOnce(
        new AiProviderError("Internal server error", {
          statusCode: 502,
          retryable: true,
          failureClass: "upstream_http",
          transportKind: "chat-completions",
          endpointFamily: "chat_completions",
          upstreamStatus: 500,
          rawResponsePreview: '{"error":"Internal server error"}',
        }),
      )
      .mockResolvedValueOnce(
        [
          "```html",
          '<div id="canvas-container"></div>',
          "```",
          "```css",
          "#canvas-container{width:100%;height:100%;}",
          "```",
          "```javascript",
          "window.sketch = (p) => {",
          "  p.setup = () => { p.createCanvas(p.windowWidth, p.windowHeight); };",
          "  p.draw = () => { p.background(255); p.circle(p.width / 2, p.height / 2, 80); };",
          "};",
          "```",
        ].join("\n"),
      );

    const draft = await generateValidatedDraft({
      ownerUserId: "owner-1",
      prompt: "Make a looping p5 circle",
      engine: "p5",
      vendor: "opencode-zen",
      model: "minimax-m3-free",
      apiKey: "sk-zen",
      endpointKind: "chat-completions",
      signal: new AbortController().signal,
    });

    expect(draft.validationStatus).toBe("validated");
    expect(draft.attemptCount).toBe(2);
    expect(draft.wasRepaired).toBe(true);
    expect(processTextWithProvider).toHaveBeenCalledTimes(2);
    expect(processTextWithProvider.mock.calls[1]?.[0]).toMatchObject({
      vendor: "opencode-zen",
      model: "minimax-m3-free",
      endpointKind: "chat-completions",
      intent: "art-piece",
    });
  });
});

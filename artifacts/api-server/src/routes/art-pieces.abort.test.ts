import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

vi.mock("@/middlewares/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireOwner: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middlewares/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireOwner: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@workspace/db", () => ({
  artPieceEngineSchema: z.enum(["p5", "c2", "three"]),
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

const { createGenerationAbortController } = await import("./art-pieces");

function createReq() {
  return new EventEmitter() as EventEmitter & {
    off: EventEmitter["off"];
  };
}

function createRes(writableEnded = false) {
  const res = new EventEmitter() as EventEmitter & {
    writableEnded: boolean;
    off: EventEmitter["off"];
  };
  res.writableEnded = writableEnded;
  return res;
}

describe("createGenerationAbortController", () => {
  it("does not cancel generation when the request stream closes after the body is read", () => {
    const req = createReq();
    const res = createRes(false);
    const generation = createGenerationAbortController(req as never, res as never);

    req.emit("close");

    expect(generation.signal.aborted).toBe(false);
    generation.cleanup();
  });

  it("cancels generation when the request is actually aborted", () => {
    const req = createReq();
    const res = createRes(false);
    const generation = createGenerationAbortController(req as never, res as never);

    req.emit("aborted");

    expect(generation.signal.aborted).toBe(true);
    expect(generation.signal.reason).toBe("cancelled");
    generation.cleanup();
  });

  it("cancels generation when the response closes before a normal response end", () => {
    const req = createReq();
    const res = createRes(false);
    const generation = createGenerationAbortController(req as never, res as never);

    res.emit("close");

    expect(generation.signal.aborted).toBe(true);
    expect(generation.signal.reason).toBe("cancelled");
    generation.cleanup();
  });

  it("does not cancel generation when the response closes after a normal response end", () => {
    const req = createReq();
    const res = createRes(true);
    const generation = createGenerationAbortController(req as never, res as never);

    res.emit("close");

    expect(generation.signal.aborted).toBe(false);
    generation.cleanup();
  });
});

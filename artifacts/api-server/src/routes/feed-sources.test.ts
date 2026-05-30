import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    selectDistinct: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  feedSourcesTable: {},
  feedItemsSeenTable: {},
  postsTable: {},
  usersTable: {},
  mediaAssetsTable: {},
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  ne: vi.fn(),
  or: vi.fn(),
  formatMysqlDateTime: vi.fn((value?: Date) => (value ?? new Date()).toISOString()),
}));

vi.mock("../middlewares/auth", () => ({
  requireAuth: vi.fn((_req, _res, next) => next()),
  requireOwner: vi.fn((_req, _res, next) => next()),
}));

import {
  ingestOneItem,
  isDuplicateKeyError,
  enqueueBackgroundRefresh,
  isRefreshInFlight,
  _resetInFlightRefreshesForTest,
  type IngestDb,
} from "./feed-sources";
import { normalizeFeedItem } from "../lib/feed-ingest";

const envPath = path.resolve(import.meta.dirname, "../../../../.env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const baseSource = { id: 7, name: "Some Blog" };
const normalized = normalizeFeedItem(
  {
    guid: "https://example.com/x",
    link: "https://example.com/x",
    title: "T",
    contentEncoded: "<p>body</p>",
    isoDate: "2026-01-01T00:00:00.000Z",
  },
  baseSource.name,
);

function makeOps(overrides: Partial<IngestDb> = {}): IngestDb {
  return {
    isAlreadySeen: vi.fn().mockResolvedValue(false),
    insertPost: vi.fn().mockResolvedValue(101),
    insertDedupRow: vi.fn().mockResolvedValue(undefined),
    deletePost: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("isDuplicateKeyError", () => {
  it("recognizes mysql2 ER_DUP_ENTRY (errno 1062)", () => {
    expect(isDuplicateKeyError({ errno: 1062, code: "ER_DUP_ENTRY" })).toBe(true);
    expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
    expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY" })).toBe(true);
  });
  it("returns false for unrelated errors", () => {
    expect(isDuplicateKeyError(new Error("network"))).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
    expect(isDuplicateKeyError({ code: "ETIMEDOUT" })).toBe(false);
  });
});

describe("ingestOneItem — happy path", () => {
  it("inserts post, then dedup row carrying postId", async () => {
    const ops = makeOps();
    const outcome = await ingestOneItem(ops, baseSource, normalized);

    expect(outcome).toBe("imported");
    expect(ops.isAlreadySeen).toHaveBeenCalledWith(7, normalized.guidHash);
    expect(ops.insertPost).toHaveBeenCalledTimes(1);
    expect(ops.insertDedupRow).toHaveBeenCalledTimes(1);
    expect(ops.insertDedupRow).toHaveBeenCalledWith({
      sourceId: 7,
      guidHash: normalized.guidHash,
      postId: 101,
    });
    expect(ops.deletePost).not.toHaveBeenCalled();
  });

  it("uses originalAuthor when present, source name otherwise", async () => {
    const insertPost = vi.fn().mockResolvedValue(102);
    const ops = makeOps({ insertPost });
    const withAuthor = normalizeFeedItem(
      {
        guid: "https://example.com/y",
        link: "https://example.com/y",
        title: "T",
        creator: "Jane Doe",
        contentEncoded: "<p>body</p>",
      },
      baseSource.name,
    );
    await ingestOneItem(ops, baseSource, withAuthor);
    expect(insertPost.mock.calls[0]?.[0].authorName).toBe("Jane Doe");

    const noAuthor = makeOps();
    await ingestOneItem(noAuthor, baseSource, normalized);
    expect((noAuthor.insertPost as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].authorName).toBe(
      "Some Blog",
    );
  });
});

describe("ingestOneItem — already-seen short circuit", () => {
  it("skips both inserts when the item is already in the ledger", async () => {
    const ops = makeOps({
      isAlreadySeen: vi.fn().mockResolvedValue(true),
    });
    const outcome = await ingestOneItem(ops, baseSource, normalized);

    expect(outcome).toBe("skipped");
    expect(ops.insertPost).not.toHaveBeenCalled();
    expect(ops.insertDedupRow).not.toHaveBeenCalled();
    expect(ops.deletePost).not.toHaveBeenCalled();
  });
});

describe("ingestOneItem — atomicity", () => {
  it("does NOT write dedup ledger when post insert fails", async () => {
    // Regression: dedup-first ordering would mark seen on failure.
    const insertPost = vi.fn().mockRejectedValue(new Error("transient db failure"));
    const insertDedupRow = vi.fn();
    const deletePost = vi.fn();

    const ops = makeOps({ insertPost, insertDedupRow, deletePost });

    await expect(ingestOneItem(ops, baseSource, normalized)).rejects.toThrow(
      "transient db failure",
    );
    expect(insertDedupRow).not.toHaveBeenCalled();
    expect(deletePost).not.toHaveBeenCalled();
  });

  it("retries successfully on the next refresh", async () => {
    const failingOps = makeOps({
      insertPost: vi.fn().mockRejectedValue(new Error("boom")),
    });
    await expect(ingestOneItem(failingOps, baseSource, normalized)).rejects.toThrow();
    expect(failingOps.insertDedupRow).not.toHaveBeenCalled();

    const successOps = makeOps();
    const outcome = await ingestOneItem(successOps, baseSource, normalized);
    expect(outcome).toBe("imported");
    expect(successOps.insertPost).toHaveBeenCalledTimes(1);
    expect(successOps.insertDedupRow).toHaveBeenCalledTimes(1);
  });
});

// Build a minimal FeedSourceRow-compatible object. The queue helper
// only forwards the row to its runner, so the runtime shape doesn't
// matter for these tests — we cast through `unknown` to keep the
// production type narrow.
function makeSourceRow(overrides: { id: number; name?: string }) {
  const row = {
    id: overrides.id,
    name: overrides.name ?? "Some Blog",
    feedUrl: "https://example.com/feed.xml",
    siteUrl: null,
    cadence: "daily",
    enabled: 1,
    lastFetchedAt: null,
    nextFetchAt: null,
    lastStatus: null,
    lastError: null,
    itemsImported: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return row as unknown as Parameters<typeof enqueueBackgroundRefresh>[0];
}

describe("enqueueBackgroundRefresh", () => {
  beforeEach(() => {
    _resetInFlightRefreshesForTest();
  });

  it("returns immediately and runs the refresh on a later tick", async () => {
    let runnerStarted = false;
    let runnerResolve: (() => void) | null = null;
    const runner = vi.fn(async () => {
      runnerStarted = true;
      await new Promise<void>((resolve) => {
        runnerResolve = resolve;
      });
      return {
        sourceId: 1,
        fetched: 0,
        imported: 0,
        skipped: 0,
        status: "ok" as const,
        error: null,
      };
    });

    const queued = enqueueBackgroundRefresh(makeSourceRow({ id: 1 }), runner);

    // Synchronous return path: the runner has not been awaited and the
    // microtask queueing means it has not even started yet.
    expect(queued).toBe(true);
    expect(runnerStarted).toBe(false);
    expect(isRefreshInFlight(1)).toBe(true);

    // Drain microtasks so the queued .then() schedules the runner.
    await Promise.resolve();
    await Promise.resolve();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runnerStarted).toBe(true);

    // Until the runner finishes, the source remains marked in-flight
    // so a parallel call short-circuits.
    expect(isRefreshInFlight(1)).toBe(true);
    runnerResolve!();
    // Let the .finally() handler run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(isRefreshInFlight(1)).toBe(false);
  });

  it("skips queueing when a refresh for the same source is already running", async () => {
    let release: (() => void) | null = null;
    const runner = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        sourceId: 5,
        fetched: 0,
        imported: 0,
        skipped: 0,
        status: "ok" as const,
        error: null,
      };
    });

    const first = enqueueBackgroundRefresh(makeSourceRow({ id: 5 }), runner);
    const second = enqueueBackgroundRefresh(makeSourceRow({ id: 5 }), runner);

    expect(first).toBe(true);
    expect(second).toBe(false);
    // Drain microtasks to let the first runner start.
    await Promise.resolve();
    await Promise.resolve();
    expect(runner).toHaveBeenCalledTimes(1);

    release!();
    await new Promise((resolve) => setImmediate(resolve));
    expect(isRefreshInFlight(5)).toBe(false);

    // Once the first run is done, a fresh call queues normally.
    const third = enqueueBackgroundRefresh(makeSourceRow({ id: 5 }), runner);
    expect(third).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight slot even when the background runner throws", async () => {
    const runner = vi.fn(async () => {
      throw new Error("upstream blew up");
    });

    enqueueBackgroundRefresh(makeSourceRow({ id: 9 }), runner);
    expect(isRefreshInFlight(9)).toBe(true);

    // Drain enough of the microtask queue for the .catch() and
    // .finally() handlers to run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(runner).toHaveBeenCalledTimes(1);
    expect(isRefreshInFlight(9)).toBe(false);

    // A subsequent enqueue should succeed.
    const requeued = enqueueBackgroundRefresh(makeSourceRow({ id: 9 }), runner);
    expect(requeued).toBe(true);
  });
});

describe("ingestOneItem — concurrent-write race", () => {
  it("deletes orphan post when dedup insert hits ER_DUP_ENTRY", async () => {
    const dupErr = Object.assign(new Error("Duplicate"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    });
    const insertPost = vi.fn().mockResolvedValue(202);
    const insertDedupRow = vi.fn().mockRejectedValue(dupErr);
    const deletePost = vi.fn().mockResolvedValue(undefined);

    const ops = makeOps({ insertPost, insertDedupRow, deletePost });
    const outcome = await ingestOneItem(ops, baseSource, normalized);

    expect(outcome).toBe("skipped");
    expect(insertPost).toHaveBeenCalledTimes(1);
    expect(insertDedupRow).toHaveBeenCalledTimes(1);
    expect(deletePost).toHaveBeenCalledTimes(1);
    expect(deletePost).toHaveBeenCalledWith(202);
  });

  it("re-throws non-duplicate dedup-insert errors", async () => {
    const insertPost = vi.fn().mockResolvedValue(303);
    const insertDedupRow = vi.fn().mockRejectedValue(new Error("disk full"));
    const deletePost = vi.fn();

    const ops = makeOps({ insertPost, insertDedupRow, deletePost });
    await expect(ingestOneItem(ops, baseSource, normalized)).rejects.toThrow("disk full");
    expect(deletePost).not.toHaveBeenCalled();
  });
});

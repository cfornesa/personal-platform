import path from "node:path";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import multer from "multer";
import {
  db,
  feedSourcesTable,
  feedItemsSeenTable,
  postsTable,
  usersTable,
  mediaAssetsTable,
  eq,
  desc,
  and,
  ne,
  or,
  formatMysqlDateTime,
} from "@workspace/db";
import { requireAuth, requireOwner } from "../middlewares/auth";
import {
  cadenceIntervalMs,
  computeNextFetchAt,
  fetchFeed,
  isSourceDue,
  normalizeFeedItem,
} from "../lib/feed-ingest";
import { computeContentText } from "../lib/html";
import { logger } from "../lib/logger";
import {
  CreateFeedSourceBody,
  UpdateFeedSourceBody,
  UpdateFeedSourceParams,
  DeleteFeedSourceParams,
  RefreshFeedSourceParams,
} from "@workspace/api-zod";
import {
  deriveMediaTitle,
  MAX_MEDIA_BYTES,
  MAX_MEDIA_MB,
  storeUploadedImage,
} from "../lib/media";
import { createRateLimitMiddleware } from "../lib/ratelimit";

const router: IRouter = Router();

type FeedSourceRow = typeof feedSourcesTable.$inferSelect;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_MEDIA_BYTES,
    files: 1,
  },
});

function uploadSingleFeedSourcePhoto(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: `Image uploads must be ${MAX_MEDIA_MB} MB or smaller.` });
        return;
      }
      res.status(400).json({ error: error.message || "Invalid upload" });
      return;
    }

    next(error);
  });
}

function serialize(row: FeedSourceRow) {
  return {
    id: row.id,
    name: row.name,
    username: row.username ?? null,
    bio: row.bio ?? null,
    authorName: row.authorName ?? null,
    imageUrl: row.imageUrl ?? null,
    feedUrl: row.feedUrl,
    siteUrl: row.siteUrl,
    cadence: row.cadence,
    enabled: row.enabled === 1,
    lastFetchedAt: row.lastFetchedAt,
    nextFetchAt: row.nextFetchAt,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    itemsImported: row.itemsImported,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assertImageLibraryUrl(imageUrl: string) {
  const trimmed = imageUrl.trim();
  if (!trimmed.startsWith("/api/media/")) {
    throw new Error("Profile photo must be an existing Image Library URL.");
  }

  const fileName = path.basename(trimmed);
  if (!fileName || trimmed !== `/api/media/${fileName}`) {
    throw new Error("Profile photo must be an existing Image Library URL.");
  }

  const [asset] = await db
    .select({ url: mediaAssetsTable.url })
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.url, trimmed))
    .limit(1);

  if (!asset) {
    throw new Error("Profile photo must be an existing Image Library URL.");
  }

  return asset.url;
}

async function updateFeedSourceImage(sourceId: number, imageUrl: string | null) {
  await db
    .update(feedSourcesTable)
    .set({
      imageUrl,
      updatedAt: formatMysqlDateTime(),
    })
    .where(eq(feedSourcesTable.id, sourceId));

  await db
    .update(postsTable)
    .set({ authorImageUrl: imageUrl })
    .where(eq(postsTable.sourceFeedId, sourceId));
}

// Owner cookie session, or X-Cron-Secret matching CRON_SECRET (constant-time).
function authorizeRefresh(req: Request, res: Response, next: NextFunction): void {
  const headerSecret = req.header("x-cron-secret");
  const expected = process.env.CRON_SECRET?.trim() || "";

  if (expected.length > 0 && typeof headerSecret === "string" && headerSecret.length === expected.length) {
    const a = Buffer.from(headerSecret);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      next();
      return;
    }
  }

  requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    requireOwner(req, res, next);
  });
}

async function loadSourceById(id: number) {
  const rows = await db.select().from(feedSourcesTable).where(eq(feedSourcesTable.id, id)).limit(1);
  return rows[0] ?? null;
}

type RefreshResult = {
  sourceId: number;
  fetched: number;
  imported: number;
  skipped: number;
  status: "ok" | "error";
  error: string | null;
  // Optional flag set by the per-source refresh endpoint when a
  // background fetch for this source was already running and the new
  // request was a no-op. Omitted from sweep results because the cron
  // path runs sources serially and never collides with itself.
  alreadyInProgress?: boolean;
};

// Sources whose refresh is currently running on the background queue.
// Lets the create + manual-refresh endpoints stay fire-and-forget without
// stacking concurrent fetches against the same upstream feed (which would
// just race on the dedup ledger).
const inFlightRefreshes = new Set<number>();

export function _resetInFlightRefreshesForTest(): void {
  inFlightRefreshes.clear();
}

export function isRefreshInFlight(sourceId: number): boolean {
  return inFlightRefreshes.has(sourceId);
}

/**
 * Schedule a feed refresh on the next tick and return immediately.
 *
 * The HTTP layer (POST /feed-sources, POST /feed-sources/:id/refresh)
 * uses this so the admin form / refresh button never block on the
 * upstream fetch. Errors from the background fetch still land in the
 * source row's `last_status` / `last_error` columns via
 * `refreshOneSource`, so the admin UI surfaces them on the next list
 * reload.
 *
 * Returns `false` if a refresh for this source is already running, so
 * callers can report "already in progress" without queueing duplicate
 * work.
 */
export function enqueueBackgroundRefresh(
  source: FeedSourceRow,
  runner: (s: FeedSourceRow) => Promise<RefreshResult> = refreshOneSource,
): boolean {
  if (inFlightRefreshes.has(source.id)) {
    return false;
  }
  inFlightRefreshes.add(source.id);

  // Detach from the request lifecycle. `refreshOneSource` already
  // catches its own errors and writes them to the source row, so the
  // outer .catch is a process-safety net for anything that escapes
  // (e.g. an unexpected throw from the DB driver itself).
  void Promise.resolve()
    .then(() => runner(source))
    .catch((err: unknown) => {
      logger.error(
        { sourceId: source.id, err: err instanceof Error ? err.message : String(err) },
        "Background feed refresh threw unexpectedly",
      );
    })
    .finally(() => {
      inFlightRefreshes.delete(source.id);
    });

  return true;
}

// MySQL duplicate-key (1062) signals a lost (source_id, guid_hash) race.
export function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number };
  return e.code === "ER_DUP_ENTRY" || e.errno === 1062;
}

// IngestDb is a thin contract over the four SQL ops the per-item ingest
// issues, kept separate so the ordering rule is testable without MySQL.
export type IngestDb = {
  isAlreadySeen(sourceId: number, guidHash: string): Promise<boolean>;
  insertPost(values: {
    sourceId: number;
    guidHash: string;
    authorName: string;
    authorImageUrl?: string | null;
    content: string;
    contentFormat: "plain" | "html";
    sourceGuid: string | null;
    sourceCanonicalUrl: string | null;
    publishedAt: string;
  }): Promise<number>;
  insertDedupRow(values: {
    sourceId: number;
    guidHash: string;
    postId: number;
  }): Promise<void>;
  deletePost(postId: number): Promise<void>;
};

// Post-first, dedup-second: if insertPost throws, the ledger is never
// written so the item stays retriable. On a concurrent insert race the
// loser's insertDedupRow throws ER_DUP_ENTRY and we delete the orphan post.
export async function ingestOneItem(
  ops: IngestDb,
  source: { id: number; name: string; authorName?: string | null },
  normalized: ReturnType<typeof normalizeFeedItem>,
): Promise<"imported" | "skipped"> {
  if (await ops.isAlreadySeen(source.id, normalized.guidHash)) {
    return "skipped";
  }

  const displayAuthor = source.authorName || normalized.originalAuthor || source.name;

  const newPostId = await ops.insertPost({
    sourceId: source.id,
    guidHash: normalized.guidHash,
    authorName: displayAuthor,
    authorImageUrl: (source as { imageUrl?: string | null }).imageUrl ?? null,
    content: normalized.content,
    contentFormat: normalized.contentFormat,
    sourceGuid: normalized.guid,
    sourceCanonicalUrl: normalized.canonicalUrl,
    publishedAt: normalized.publishedAt,
  });

  try {
    await ops.insertDedupRow({
      sourceId: source.id,
      guidHash: normalized.guidHash,
      postId: newPostId,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      await ops.deletePost(newPostId);
      return "skipped";
    }
    throw err;
  }

  return "imported";
}

function makeProductionIngestDb(): IngestDb {
  return {
    async isAlreadySeen(sourceId, guidHash) {
      const rows = await db
        .select({ id: feedItemsSeenTable.id })
        .from(feedItemsSeenTable)
        .where(
          and(
            eq(feedItemsSeenTable.sourceId, sourceId),
            eq(feedItemsSeenTable.guidHash, guidHash),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    async insertPost(values) {
      const inserted = await db
        .insert(postsTable)
        .values({
          authorId: `feed:${values.sourceId}`,
          authorUserId: null,
          authorName: values.authorName,
          authorImageUrl: values.authorImageUrl ?? null,
          content: values.content,
          // Same shadow-column derivation as the manual create/update
          // paths so search hits the words a reader sees regardless of
          // origin (owner-authored vs feed-imported).
          contentText: computeContentText(values.content, values.contentFormat),
          contentFormat: values.contentFormat,
          status: "pending",
          sourceFeedId: values.sourceId,
          sourceGuid: values.sourceGuid,
          sourceCanonicalUrl: values.sourceCanonicalUrl,
          createdAt: values.publishedAt,
        })
        .$returningId();
      const newId = inserted[0]?.id;
      if (typeof newId !== "number") {
        throw new Error("Post insert did not return an id");
      }
      return newId;
    },
    async insertDedupRow(values) {
      await db.insert(feedItemsSeenTable).values({
        sourceId: values.sourceId,
        guidHash: values.guidHash,
        postId: values.postId,
      });
    },
    async deletePost(postId) {
      await db.delete(postsTable).where(eq(postsTable.id, postId));
    },
  };
}

/**
 * Pull a single source. Idempotent: every item is keyed by
 * `(source_id, sha256(guid))` in `feed_items_seen`, so a re-fetch
 * never duplicates rows. Items go in with `status='pending'` so the
 * moderator sees them in the queue before they hit the public
 * timeline.
 *
 * The per-item ordering rule (post-first, dedup-second) lives in
 * `ingestOneItem`; this function is just the per-source wrapper that
 * fetches the feed, loops over items, and updates the source row's
 * cadence/status fields.
 */
async function refreshOneSource(source: FeedSourceRow): Promise<RefreshResult> {
  const result: RefreshResult = {
    sourceId: source.id,
    fetched: 0,
    imported: 0,
    skipped: 0,
    status: "ok",
    error: null,
  };

  const ops = makeProductionIngestDb();

  try {
    const items = await fetchFeed(source.feedUrl);
    result.fetched = items.length;

    for (const raw of items) {
      const normalized = normalizeFeedItem(raw, source.name, source.siteUrl ?? null);
      const outcome = await ingestOneItem(ops, source, normalized);
      if (outcome === "imported") {
        result.imported += 1;
      } else {
        result.skipped += 1;
      }
    }

    const now = new Date();
    await db
      .update(feedSourcesTable)
      .set({
        lastFetchedAt: formatMysqlDateTime(now),
        nextFetchAt: computeNextFetchAt(now, source.cadence),
        lastStatus: "ok",
        lastError: null,
        itemsImported: source.itemsImported + result.imported,
        updatedAt: formatMysqlDateTime(now),
      })
      .where(eq(feedSourcesTable.id, source.id));
  } catch (err) {
    result.status = "error";
    result.error = err instanceof Error ? err.message : String(err);
    logger.warn({ sourceId: source.id, err: result.error }, "Feed refresh failed");
    const now = new Date();
    await db
      .update(feedSourcesTable)
      .set({
        lastFetchedAt: formatMysqlDateTime(now),
        // On failure, retry on the cadence schedule rather than
        // hammering a broken endpoint every sweep.
        nextFetchAt: computeNextFetchAt(now, source.cadence),
        lastStatus: "error",
        lastError: result.error.slice(0, 1000),
        updatedAt: formatMysqlDateTime(now),
      })
      .where(eq(feedSourcesTable.id, source.id));
  }

  return result;
}

// GET /feed-sources/public — anonymous-safe digest of feed sources
// that have at least one published post on this site. Returns only
// the id and display name (no feed URL, no fetch state) so the
// search filter sidebar can offer "filter by source" to every
// visitor without leaking internal subscription metadata.
router.get("/feed-sources/public", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .selectDistinct({
        id: feedSourcesTable.id,
        name: feedSourcesTable.name,
      })
      .from(feedSourcesTable)
      .innerJoin(postsTable, eq(postsTable.sourceFeedId, feedSourcesTable.id))
      .where(eq(postsTable.status, "published"))
      .orderBy(feedSourcesTable.name);
    return res.json({ sources: rows });
  } catch (err) {
    logger.error({ err }, "Failed to list public feed sources");
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /feed-sources — owner only. Lists every configured feed.
router.get("/feed-sources", requireAuth, requireOwner, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(feedSourcesTable)
      .orderBy(desc(feedSourcesTable.createdAt));
    return res.json({ sources: rows.map(serialize) });
  } catch (err) {
    logger.error({ err }, "Failed to list feed sources");
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /feed-sources — owner only. Create a new subscription.
router.post("/feed-sources", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const body = CreateFeedSourceBody.parse(req.body);

    const insert = await db
      .insert(feedSourcesTable)
      .values({
        name: body.name,
        bio: body.bio ?? null,
        authorName: body.authorName ?? null,
        imageUrl: body.imageUrl ? await assertImageLibraryUrl(body.imageUrl) : null,
        feedUrl: body.feedUrl,
        siteUrl: body.siteUrl ?? null,
        cadence: body.cadence,
        enabled: body.enabled ? 1 : 0,
        nextFetchAt: null,
        createdAt: formatMysqlDateTime(),
        updatedAt: formatMysqlDateTime(),
      })
      .$returningId();

    const newId = insert[0]?.id;
    if (!newId) {
      return res.status(500).json({ error: "Failed to create feed source" });
    }

    const created = await loadSourceById(newId);
    if (!created) {
      return res.status(500).json({ error: "Failed to load created feed source" });
    }

    // Kick off the first fetch on the background queue so the admin
    // form returns immediately. Errors will land in last_status /
    // last_error and surface on the next list reload. Skipped if the
    // source was created in a disabled state — the cron sweep skips
    // disabled sources anyway, so an immediate fetch would be wasted.
    if (created.enabled === 1) {
      enqueueBackgroundRefresh(created);
    }

    return res.status(201).json(serialize(created));
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// PATCH /feed-sources/:id — owner only. Update an existing subscription.
router.patch("/feed-sources/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = UpdateFeedSourceParams.parse(req.params);
    const body = UpdateFeedSourceBody.parse(req.body);

    const existing = await loadSourceById(id);
    if (!existing) {
      return res.status(404).json({ error: "Feed source not found" });
    }

    // Validate username uniqueness across both users and feed_sources.
    if (body.username) {
      const slug = body.username;
      const [humanConflict] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, slug))
        .limit(1);
      if (humanConflict) {
        return res.status(400).json({ error: "Username is already taken" });
      }
      const [feedConflict] = await db
        .select({ id: feedSourcesTable.id })
        .from(feedSourcesTable)
        .where(and(eq(feedSourcesTable.username, slug), ne(feedSourcesTable.id, id)))
        .limit(1);
      if (feedConflict) {
        return res.status(400).json({ error: "Username is already taken" });
      }
    }

    const updates: Partial<typeof feedSourcesTable.$inferInsert> = {
      updatedAt: formatMysqlDateTime(),
    };
    if (body.name !== undefined) updates.name = body.name;
    if (body.username !== undefined) updates.username = body.username ?? null;
    if (body.bio !== undefined) updates.bio = body.bio ?? null;
    if (body.authorName !== undefined) updates.authorName = body.authorName ?? null;
    let selectedImageUrl: string | null | undefined;
    if (body.imageUrl !== undefined) {
      selectedImageUrl = body.imageUrl ? await assertImageLibraryUrl(body.imageUrl) : null;
    }
    if (body.feedUrl !== undefined) updates.feedUrl = body.feedUrl;
    if (body.siteUrl !== undefined) updates.siteUrl = body.siteUrl ?? null;
    if (body.cadence !== undefined) {
      updates.cadence = body.cadence;
      // Recompute next-fetch off lastFetchedAt with the new interval.
      if (existing.lastFetchedAt) {
        const last = new Date(existing.lastFetchedAt);
        if (!Number.isNaN(last.getTime())) {
          updates.nextFetchAt = formatMysqlDateTime(new Date(last.getTime() + cadenceIntervalMs(body.cadence)));
        }
      } else {
        updates.nextFetchAt = null;
      }
    }
    if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;

    await db.update(feedSourcesTable).set(updates).where(eq(feedSourcesTable.id, id));
    if (selectedImageUrl !== undefined) {
      await updateFeedSourceImage(id, selectedImageUrl);
    }

    const refreshed = await loadSourceById(id);
    return res.json(serialize(refreshed!));
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

router.post(
  "/feed-sources/:id/profile-photo",
  createRateLimitMiddleware({ windowMs: 60_000, max: 20 }),
  requireAuth,
  requireOwner,
  uploadSingleFeedSourcePhoto,
  async (req: Request, res: Response) => {
    try {
      const { id } = UpdateFeedSourceParams.parse(req.params);
      const existing = await loadSourceById(id);
      if (!existing) {
        return res.status(404).json({ error: "Feed source not found" });
      }
      if (!req.file?.buffer) {
        return res.status(400).json({ error: "File upload is required" });
      }

      const uploaded = await storeUploadedImage(req.file.buffer, deriveMediaTitle(req.file.originalname));
      await updateFeedSourceImage(id, uploaded.url);

      const refreshed = await loadSourceById(id);
      return res.status(201).json(serialize(refreshed!));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid upload";
      return res.status(400).json({ error: message });
    }
  },
);

// DELETE /feed-sources/:id — removes source + ledger; imported posts kept.
router.delete("/feed-sources/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = DeleteFeedSourceParams.parse(req.params);
    const existing = await loadSourceById(id);
    if (!existing) {
      return res.status(404).json({ error: "Feed source not found" });
    }
    await db.delete(feedSourcesTable).where(eq(feedSourcesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// POST /feed-sources/:id/refresh — owner only. Queue this source on the
// background fetch worker and return immediately so the admin UI never
// blocks on a slow upstream feed. Outcome of the actual fetch lands in
// the source row's last_status / last_error columns; the FE re-reads
// the list to surface it.
router.post(
  "/feed-sources/:id/refresh",
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    try {
      const { id } = RefreshFeedSourceParams.parse(req.params);
      const source = await loadSourceById(id);
      if (!source) {
        return res.status(404).json({ error: "Feed source not found" });
      }
      const queued = enqueueBackgroundRefresh(source);
      // Response shape stays compatible with the existing
      // FeedRefreshResult contract (status enum is `ok | error`).
      // `imported` / `fetched` are 0 because the work is queued, not
      // finished — the FE reflects this by phrasing the toast as
      // "Refresh queued" instead of "imported N items". When `queued`
      // is false, an earlier background fetch for this source is
      // still running; we surface that via `alreadyInProgress` so the
      // FE can show "already in progress" instead of "queued".
      return res.json({
        sourceId: id,
        fetched: 0,
        imported: 0,
        skipped: 0,
        status: "ok",
        error: null,
        alreadyInProgress: !queued,
      } satisfies RefreshResult);
    } catch (err) {
      return res.status(400).json({ error: "Invalid request" });
    }
  },
);

// POST /feed-sources/:id/approve-all — bulk-approve all pending from a source.
router.post(
  "/feed-sources/:id/approve-all",
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    try {
      const { id } = RefreshFeedSourceParams.parse(req.params);
      const source = await loadSourceById(id);
      if (!source) {
        return res.status(404).json({ error: "Feed source not found" });
      }

      const pendingRows = await db
        .select({ id: postsTable.id })
        .from(postsTable)
        .where(
          and(
            eq(postsTable.sourceFeedId, id),
            eq(postsTable.status, "pending"),
          ),
        );
      const approvedCount = pendingRows.length;

      if (approvedCount > 0) {
        await db
          .update(postsTable)
          .set({ status: "published" })
          .where(
            and(
              eq(postsTable.sourceFeedId, id),
              eq(postsTable.status, "pending"),
            ),
          );
      }

      return res.json({ sourceId: id, approved: approvedCount });
    } catch (err) {
      logger.error({ err }, "approve-all failed");
      return res.status(400).json({ error: "Invalid request" });
    }
  },
);

// POST /feed-sources/refresh — refresh all enabled, due sources.
// Auth: owner cookie OR X-Cron-Secret header. ?force=1 bypasses cadence.
router.post(
  "/feed-sources/refresh",
  authorizeRefresh,
  async (req: Request, res: Response) => {
    try {
      const force = req.query.force === "1" || req.query.force === "true";

      const sources = await db
        .select()
        .from(feedSourcesTable)
        .where(eq(feedSourcesTable.enabled, 1));

      const results: RefreshResult[] = [];
      for (const source of sources) {
        if (!force && !isSourceDue(source.nextFetchAt)) {
          continue;
        }
        results.push(await refreshOneSource(source));
      }

      return res.json({
        ranAt: new Date().toISOString(),
        attempted: results.length,
        totalFetched: results.reduce((acc, r) => acc + r.fetched, 0),
        totalImported: results.reduce((acc, r) => acc + r.imported, 0),
        results,
      });
    } catch (err) {
      logger.error({ err }, "Bulk feed refresh failed");
      return res.status(500).json({ error: "Server error" });
    }
  },
);

export default router;

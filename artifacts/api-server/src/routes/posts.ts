import { Router, type IRouter, type Request, type Response } from "express";
import { db, mysqlPool, postsTable, commentsTable, feedSourcesTable, categoriesTable, postCategoriesTable, eq, desc, count, and, or, isNull, inArray, notExists, sql, gte, lte, formatMysqlDateTime, formatMysqlDateTimeUtc } from "@workspace/db";
import {
  attachCategoriesToPosts,
  hydratePostCategories,
  replacePostCategories,
  validateCategoryIds,
  resolveCategorySlugsToIds,
} from "../lib/post-categories";
import {
  CreatePostBody,
  ListPostsQueryParams,
  GetPostParams,
  DeletePostParams,
  UpdatePostBody,
  GetPostsByUserParams,
  GetPostsByUserQueryParams,
} from "@workspace/api-zod";
import { requireAuth, requireOwner } from "../middlewares/auth";
import { sanitizeRichHtml, computeContentText } from "../lib/html";
import { generatePostOgImage } from "../lib/og";
import { loadCurrentUser } from "../lib/current-user";
import { isPostVisibleToReader } from "../lib/post-visibility";
import {
  buildSearchSnippet,
  parseSearchQuery,
  validateSearchInput,
  MAX_SEARCH_QUERY_LENGTH,
  type SearchQuery,
} from "../lib/post-search";
import { enqueueSyndication } from "../lib/syndication/index";
import { getOrigin } from "./feeds";
import type { RowDataPacket } from "mysql2/promise";

// Convert a naive MySQL DATETIME string ("YYYY-MM-DD HH:mm:ss.mmm" stored as UTC)
// to a proper UTC ISO 8601 string so browser parseISO treats it correctly.
function toUtcIso(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(" ", "T") + "Z";
}

// Attach successful syndication badges to a list of posts in-place.
async function attachSyndications<T extends { id: number }>(
  posts: T[],
): Promise<(T & { syndications: { platform: string; externalUrl: string | null }[] })[]> {
  if (posts.length === 0) return posts.map((p) => ({ ...p, syndications: [] }));
  const ids = posts.map((p) => p.id);
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    `SELECT ps.post_id, pc.platform, ps.external_url
     FROM post_syndications ps
     JOIN platform_connections pc ON pc.id = ps.platform_connection_id
     WHERE ps.post_id IN (?) AND ps.status = 'success'`,
    [ids],
  );
  const map = new Map<number, { platform: string; externalUrl: string | null }[]>();
  for (const row of rows) {
    const pid = row.post_id as number;
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid)!.push({ platform: row.platform as string, externalUrl: (row.external_url as string | null) ?? null });
  }
  return posts.map((p) => ({ ...p, syndications: map.get(p.id) ?? [] }));
}

const router: IRouter = Router();

// GET /og/posts/:id — generate dynamic OG image
router.get("/og/posts/:id", async (req: Request, res: Response) => {
  try {
    const { id } = GetPostParams.parse(req.params);

    const post = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!post[0]) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (post[0].status === "pending") {
      const { user } = await loadCurrentUser(req);
      if (!isPostVisibleToReader(post[0].status, user)) {
        return res.status(404).json({ error: "Post not found" });
      }
    }

    const pngBuffer = await generatePostOgImage({
      content: post[0].content,
      authorName: post[0].authorName,
      authorImageUrl: post[0].authorImageUrl,
      createdAt: post[0].createdAt,
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
    return res.send(pngBuffer);
  } catch (err) {
    console.error("OG Image generation failed:", err);
    return res.status(500).json({ error: "Failed to generate image" });
  }
});

// GET /feed/stats — must be registered before parameterized routes
router.get("/feed/stats", async (_req: Request, res: Response) => {
  try {
    const totalPostsResult = await db.select({ count: count() }).from(postsTable);
    const totalCommentsResult = await db.select({ count: count() }).from(commentsTable);

    return res.json({
      totalPosts: totalPostsResult[0]?.count ?? 0,
      totalComments: totalCommentsResult[0]?.count ?? 0,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /posts/drafts — owner's draft posts (no date), sorted newest-first
router.get("/posts/drafts", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const posts = await db
      .select({
        id: postsTable.id,
        authorId: postsTable.authorId,
        authorName: postsTable.authorName,
        authorImageUrl: postsTable.authorImageUrl,
        title: postsTable.title,
        content: postsTable.content,
        contentFormat: postsTable.contentFormat,
        status: postsTable.status,
        scheduledAt: postsTable.scheduledAt,
        pendingPlatformIds: postsTable.pendingPlatformIds,
        featuredImageUrl: postsTable.featuredImageUrl,
        socialPostDrafts: postsTable.socialPostDrafts,
        sourceFeedId: postsTable.sourceFeedId,
        sourceFeedName: feedSourcesTable.name,
        sourceCanonicalUrl: postsTable.sourceCanonicalUrl,
        createdAt: postsTable.createdAt,
        commentCount: count(commentsTable.id),
      })
      .from(postsTable)
      .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
      .leftJoin(feedSourcesTable, eq(feedSourcesTable.id, postsTable.sourceFeedId))
      .where(eq(postsTable.status, "draft"))
      .groupBy(postsTable.id)
      .orderBy(desc(postsTable.createdAt));

    const hydrated = await attachCategoriesToPosts(posts);
    return res.json({
      posts: hydrated.map((p) => ({
        ...p,
        scheduledAt: toUtcIso(p.scheduledAt),
        pendingPlatformIds: p.pendingPlatformIds ? (JSON.parse(p.pendingPlatformIds) as number[]) : null,
        socialPostDrafts: p.socialPostDrafts ? JSON.parse(p.socialPostDrafts) : null,
        syndications: [],
      })),
      total: hydrated.length,
    });
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// GET /posts/user/:userId — must be registered before /posts/:id
router.get("/posts/user/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = GetPostsByUserParams.parse(req.params);
    const query = GetPostsByUserQueryParams.parse(req.query);
    const { page, limit } = query;
    const offset = (page - 1) * limit;

    const posts = await db
      .select({
        id: postsTable.id,
        authorId: postsTable.authorId,
        authorName: postsTable.authorName,
        authorImageUrl: postsTable.authorImageUrl,
        title: postsTable.title,
        content: postsTable.content,
        contentFormat: postsTable.contentFormat,
        featuredImageUrl: postsTable.featuredImageUrl,
        sourceFeedId: postsTable.sourceFeedId,
        sourceFeedName: feedSourcesTable.name,
        sourceCanonicalUrl: postsTable.sourceCanonicalUrl,
        createdAt: postsTable.createdAt,
        commentCount: count(commentsTable.id),
      })
      .from(postsTable)
      .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
      .leftJoin(feedSourcesTable, eq(feedSourcesTable.id, postsTable.sourceFeedId))
      .where(and(eq(postsTable.authorId, userId), eq(postsTable.status, "published")))
      .groupBy(postsTable.id)
      .orderBy(desc(postsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db
      .select({ count: count() })
      .from(postsTable)
      .where(and(eq(postsTable.authorId, userId), eq(postsTable.status, "published")));
    const total = totalResult[0]?.count ?? 0;

    const hydrated = await attachCategoriesToPosts(posts);
    const withSyndications = await attachSyndications(hydrated);
    return res.json({ posts: withSyndications, total, page, limit });
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// GET /posts/search — relevance-ranked + filtered post search.
//
// Always restricted to `status = 'published'` — search is semantically
// "what's publicly visible," even for the owner. Pending feed-imports
// only surface in the moderation queue.
//
// Filters round-trip in the URL so /search?... is shareable. The
// endpoint is the only place that does highlighting so the client just
// renders the (server-sanitized) `<mark>...</mark>` snippet.
router.get("/posts/search", async (req: Request, res: Response) => {
  // Two-tier input handling:
  //   - Strict for `page` / `limit` / `format`: malformed values get a
  //     400 with the offending field, because they're almost always a
  //     client bug or a tampered URL we want surfaced.
  //   - Permissive for filters that just narrow the result set
  //     (`from`, `to`, `sources`, `author`): garbage collapses to "no
  //     filter," because there's no useful 400 to return for a
  //     misspelled date range.
  // Anything that throws below the validation gate is a server-side
  // fault — the catch returns 500 so the client knows it's safe to
  // retry rather than to "fix" their query.
  const validated = validateSearchInput(req.query);
  if (!validated.ok) {
    return res.status(400).json({
      error: validated.error.message,
      field: validated.error.field,
    });
  }
  const { page, limit, formats } = validated.value;
  const offset = (page - 1) * limit;

  // Clamp `q` up front: the parser also truncates defensively, but
  // bounding it here keeps the JSON echo (`query: rawQ` below) and the
  // error log payload from carrying a multi-megabyte string back out.
  const rawQRaw = typeof req.query.q === "string" ? req.query.q : "";
  const rawQ =
    rawQRaw.length > MAX_SEARCH_QUERY_LENGTH
      ? rawQRaw.slice(0, MAX_SEARCH_QUERY_LENGTH)
      : rawQRaw;
  const rawFrom = typeof req.query.from === "string" ? req.query.from : "";
  const rawTo = typeof req.query.to === "string" ? req.query.to : "";
  const rawSources = typeof req.query.sources === "string" ? req.query.sources : "";
  const rawCategories = typeof req.query.categories === "string" ? req.query.categories : "";
  const rawAuthor = typeof req.query.author === "string" ? req.query.author : "";

  const search: SearchQuery | null = parseSearchQuery(rawQ);

  try {
    // WHERE clause built up as parameterized fragments. We use raw SQL
    // because Drizzle's query builder doesn't have a `MATCH ... AGAINST`
    // primitive and we want a single round-trip with the FULLTEXT
    // expression both in SELECT (for the score) and in WHERE.
    const whereParts: string[] = ["p.status = ?"];
    const whereParams: unknown[] = ["published"];

    if (search) {
      // Compose the q-predicate as an OR of the FULLTEXT branch and
      // any short-token LIKE branches. Either may be absent: a query
      // like `js` is LIKE-only, a query like `react` is FULLTEXT-only,
      // and `js react` is both. The boolean-mode expression already
      // carries the per-token `+` so phrases and unquoted words are
      // required from inside MATCH; the LIKE branches stay OR'd to
      // preserve the existing short-token findability behavior.
      const orParts: string[] = [];
      if (search.booleanExpression) {
        orParts.push("MATCH(p.content_text) AGAINST(? IN BOOLEAN MODE)");
        whereParams.push(search.booleanExpression);
      }
      for (const term of search.likeTerms) {
        orParts.push("LOWER(p.content_text) LIKE LOWER(?)");
        whereParams.push(`%${term}%`);
      }
      // `parseSearchQuery` guarantees orParts is non-empty whenever
      // it returns a non-null result, so the wrap is always safe.
      whereParts.push(`(${orParts.join(" OR ")})`);
    }

    if (rawFrom) {
      const fromDate = new Date(rawFrom);
      if (!Number.isNaN(fromDate.getTime())) {
        whereParts.push("p.created_at >= ?");
        whereParams.push(fromDate.toISOString().slice(0, 19).replace("T", " "));
      }
    }
    if (rawTo) {
      const toDate = new Date(rawTo);
      if (!Number.isNaN(toDate.getTime())) {
        // Inclusive upper bound: bump by one day so `to=2026-01-01`
        // includes everything published on Jan 1.
        const inclusive = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
        whereParts.push("p.created_at < ?");
        whereParams.push(inclusive.toISOString().slice(0, 19).replace("T", " "));
      }
    }

    if (rawSources) {
      const tokens = rawSources
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const sourceIds: number[] = [];
      let includeNative = false;
      for (const token of tokens) {
        if (token === "native") {
          includeNative = true;
          continue;
        }
        const n = Number.parseInt(token, 10);
        if (Number.isFinite(n) && n > 0) {
          sourceIds.push(n);
        }
      }
      // Only narrow when at least one usable token survived parsing —
      // an all-junk `sources=` should behave like no filter, not an
      // impossible `WHERE FALSE`.
      if (includeNative || sourceIds.length > 0) {
        const orParts: string[] = [];
        if (includeNative) {
          orParts.push("p.source_feed_id IS NULL");
        }
        if (sourceIds.length > 0) {
          orParts.push(
            `p.source_feed_id IN (${sourceIds.map(() => "?").join(",")})`,
          );
          whereParams.push(...sourceIds);
        }
        whereParts.push(`(${orParts.join(" OR ")})`);
      }
    }

    if (rawCategories) {
      // Resolve slugs → ids permissively (mirrors `sources`): an
      // all-junk filter collapses to "no narrow" rather than `WHERE FALSE`.
      const ids = await resolveCategorySlugsToIds(rawCategories);
      if (ids && ids.length > 0) {
        whereParts.push(
          `p.id IN (SELECT pc.post_id FROM post_categories pc WHERE pc.category_id IN (${ids
            .map(() => "?")
            .join(",")}))`,
        );
        whereParams.push(...ids);
      }
    }

    if (rawAuthor) {
      // Case-insensitive substring; `LOWER(...) LIKE LOWER(?)` is
      // portable and the post volume here doesn't justify a generated
      // column for it.
      whereParts.push("LOWER(p.author_name) LIKE LOWER(?)");
      whereParams.push(`%${rawAuthor}%`);
    }

    // `formats` was already normalized by validateSearchInput: it's
    // either null (no filter) or a single-element list. The "both
    // formats checked" case collapses to null in the validator, so
    // the route doesn't waste a predicate on it.
    if (formats && formats.length === 1) {
      whereParts.push("p.content_format = ?");
      whereParams.push(formats[0]);
    }

    const whereSql = whereParts.join(" AND ");

    // Score column only when we have a FULLTEXT branch to score
    // against; LIKE-only searches sort by recency so the result set
    // is at least stable.
    const hasFulltext = !!search?.booleanExpression;
    const selectScore = hasFulltext
      ? ", MATCH(p.content_text) AGAINST(? IN BOOLEAN MODE) AS score"
      : "";
    const orderBy = hasFulltext
      ? "ORDER BY score DESC, p.created_at DESC"
      : "ORDER BY p.created_at DESC";

    const queryParams: unknown[] = [];
    if (hasFulltext) queryParams.push(search!.booleanExpression);
    queryParams.push(...whereParams, limit, offset);

    const sqlText = `
      SELECT
        p.id              AS id,
        p.author_id       AS authorId,
        p.author_name     AS authorName,
        p.author_image_url AS authorImageUrl,
        p.content         AS content,
        p.content_text    AS contentText,
        p.content_format  AS contentFormat,
        p.source_feed_id  AS sourceFeedId,
        fs.name           AS sourceFeedName,
        p.source_canonical_url AS sourceCanonicalUrl,
        p.created_at      AS createdAt,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS commentCount
        ${selectScore}
      FROM posts p
      LEFT JOIN feed_sources fs ON fs.id = p.source_feed_id
      WHERE ${whereSql}
      ${orderBy}
      LIMIT ? OFFSET ?
    `;
    const [rows] = await mysqlPool.query<RowDataPacket[]>(sqlText, queryParams);

    const totalSql = `SELECT COUNT(*) AS total FROM posts p WHERE ${whereSql}`;
    const [totalRows] = await mysqlPool.query<RowDataPacket[]>(totalSql, whereParams);
    const total = Number(totalRows[0]?.total ?? 0);

    const terms = search?.terms ?? [];
    const ids = rows.map((r) => Number(r.id));
    const categoriesMap = await hydratePostCategories(ids);
    const posts = rows.map((row) => {
      const snippet = buildSearchSnippet(row.contentText as string | null, terms);
      const result: Record<string, unknown> = {
        id: row.id,
        authorId: row.authorId,
        authorName: row.authorName,
        authorImageUrl: row.authorImageUrl,
        content: row.content,
        contentFormat: row.contentFormat,
        commentCount: Number(row.commentCount ?? 0),
        sourceFeedId: row.sourceFeedId,
        sourceFeedName: row.sourceFeedName,
        sourceCanonicalUrl: row.sourceCanonicalUrl,
        categories: categoriesMap.get(Number(row.id)) ?? [],
        createdAt: row.createdAt,
        snippet,
      };
      if (hasFulltext && row.score !== undefined) {
        result.score = Number(row.score);
      }
      return result;
    });

    return res.json({ posts, total, page, limit, query: rawQ });
  } catch (err) {
    // We've already validated/normalized inputs above, so anything
    // that throws here is a server-side fault (DB outage, malformed
    // SQL after a refactor, etc.). Log with the request id so we can
    // correlate with `pino-http` access logs, and return 5xx so the
    // client knows it's safe to retry rather than to "fix" their
    // query.
    req.log?.error(
      { err, q: rawQ, page, limit },
      "GET /api/posts/search failed",
    );
    return res.status(500).json({ error: "Search failed" });
  }
});

// GET /posts — list paginated posts (public) or owner calendar view (?view=owner)
router.get("/posts", async (req: Request, res: Response) => {
  try {
    const query = ListPostsQueryParams.parse(req.query);

    // Owner calendar view: returns all statuses + date range filter.
    if (query.view === "owner") {
      const { user } = await loadCurrentUser(req);
      if (!user || user.role !== "owner") {
        return res.status(401).json({ error: "Unauthorized" });
      }
      type Condition = Parameters<typeof and>[0];
      const calendarConditions: Condition[] = [
        // Owner-authored posts of any non-draft status (draft = separate endpoint)
        or(
          and(
            eq(postsTable.authorId, user.id),
            inArray(postsTable.status, ["published", "scheduled"] as const),
          ),
          // RSS-imported published posts
          and(
            isNull(postsTable.authorUserId),
            eq(postsTable.status, "published"),
          ),
        ),
      ];
      if (query.from) {
        calendarConditions.push(
          or(
            gte(postsTable.scheduledAt, query.from),
            gte(postsTable.createdAt, query.from),
          ),
        );
      }
      if (query.to) {
        const toEnd = `${query.to} 23:59:59.999`;
        calendarConditions.push(
          or(
            lte(postsTable.scheduledAt, toEnd),
            lte(postsTable.createdAt, toEnd),
          ),
        );
      }
      const calendarPosts = await db
        .select({
          id: postsTable.id,
          authorId: postsTable.authorId,
          authorName: postsTable.authorName,
          authorImageUrl: postsTable.authorImageUrl,
          title: postsTable.title,
          content: postsTable.content,
          contentFormat: postsTable.contentFormat,
          status: postsTable.status,
          scheduledAt: postsTable.scheduledAt,
          pendingPlatformIds: postsTable.pendingPlatformIds,
          featuredImageUrl: postsTable.featuredImageUrl,
          socialPostDrafts: postsTable.socialPostDrafts,
          sourceFeedId: postsTable.sourceFeedId,
          sourceFeedName: feedSourcesTable.name,
          sourceCanonicalUrl: postsTable.sourceCanonicalUrl,
          createdAt: postsTable.createdAt,
          commentCount: count(commentsTable.id),
        })
        .from(postsTable)
        .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
        .leftJoin(feedSourcesTable, eq(feedSourcesTable.id, postsTable.sourceFeedId))
        .where(and(...calendarConditions))
        .groupBy(postsTable.id)
        .orderBy(desc(postsTable.createdAt));
      const hydrated = await attachCategoriesToPosts(calendarPosts);
      const withSyndications = await attachSyndications(hydrated);
      return res.json({
        posts: withSyndications.map((p) => ({
          ...p,
          scheduledAt: toUtcIso((p as { scheduledAt?: string | null }).scheduledAt),
          pendingPlatformIds: (p as { pendingPlatformIds?: string | null }).pendingPlatformIds
            ? (JSON.parse((p as { pendingPlatformIds: string }).pendingPlatformIds) as number[])
            : null,
          socialPostDrafts: (p as { socialPostDrafts?: string | null }).socialPostDrafts
            ? JSON.parse((p as { socialPostDrafts: string }).socialPostDrafts)
            : null,
        })),
        total: withSyndications.length,
        page: 1,
        limit: withSyndications.length,
      });
    }

    const { page, limit } = query;
    const offset = (page - 1) * limit;

    // Build filter conditions — start with the mandatory status check.
    type Condition = Parameters<typeof and>[0];
    const conditions: Condition[] = [eq(postsTable.status, "published")];

    // Category filter: a slug → posts in that category; "uncategorized" → posts with no category.
    const categoryParam = typeof query.category === "string" ? query.category.trim() : "";
    if (categoryParam && categoryParam !== "all") {
      if (categoryParam === "uncategorized") {
        conditions.push(
          notExists(
            db.select({ _: sql`1` })
              .from(postCategoriesTable)
              .where(eq(postCategoriesTable.postId, postsTable.id)),
          ),
        );
      } else {
        conditions.push(
          inArray(
            postsTable.id,
            db.select({ postId: postCategoriesTable.postId })
              .from(postCategoriesTable)
              .innerJoin(categoriesTable, eq(postCategoriesTable.categoryId, categoriesTable.id))
              .where(eq(categoriesTable.slug, categoryParam)),
          ),
        );
      }
    }

    // Source filter: "original" → source_feed_id IS NULL; a numeric ID → that specific source.
    const sourceParam = typeof query.source === "string" ? query.source.trim() : "";
    if (sourceParam && sourceParam !== "all") {
      if (sourceParam === "original") {
        conditions.push(isNull(postsTable.sourceFeedId));
      } else {
        const sourceId = Number.parseInt(sourceParam, 10);
        if (Number.isFinite(sourceId) && sourceId > 0) {
          conditions.push(eq(postsTable.sourceFeedId, sourceId));
        }
      }
    }

    const whereClause = and(...conditions);

    const posts = await db
      .select({
        id: postsTable.id,
        authorId: postsTable.authorId,
        authorName: postsTable.authorName,
        authorImageUrl: postsTable.authorImageUrl,
        title: postsTable.title,
        content: postsTable.content,
        contentFormat: postsTable.contentFormat,
        featuredImageUrl: postsTable.featuredImageUrl,
        sourceFeedId: postsTable.sourceFeedId,
        sourceFeedName: feedSourcesTable.name,
        sourceCanonicalUrl: postsTable.sourceCanonicalUrl,
        createdAt: postsTable.createdAt,
        commentCount: count(commentsTable.id),
      })
      .from(postsTable)
      .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
      .leftJoin(feedSourcesTable, eq(feedSourcesTable.id, postsTable.sourceFeedId))
      .where(whereClause)
      .groupBy(postsTable.id)
      .orderBy(desc(postsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db
      .select({ count: count() })
      .from(postsTable)
      .where(whereClause);
    const total = totalResult[0]?.count ?? 0;

    const hydrated = await attachCategoriesToPosts(posts);
    const withSyndications = await attachSyndications(hydrated);
    return res.json({ posts: withSyndications, total, page, limit });
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// POST /posts — create a post (published, draft, or scheduled)
router.post("/posts", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const rawPlatformIds = Array.isArray(req.body.platformIds)
      ? (req.body.platformIds as unknown[])
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0)
      : [];

    const body = CreatePostBody.parse(req.body);
    const postStatus = body.status ?? "published";

    // Validate scheduledAt when scheduling.
    if (postStatus === "scheduled") {
      if (!body.scheduledAt) {
        return res.status(400).json({ error: "scheduledAt is required when status is 'scheduled'" });
      }
      const scheduledMs = (body.scheduledAt as Date).getTime();
      if (scheduledMs < Date.now() + 1_800_000) {
        return res.status(400).json({ error: "scheduledAt must be at least 30 minutes in the future" });
      }
    }

    const currentUser = req.currentUser!;
    const authorName = currentUser.name || currentUser.email || "Anonymous";
    const normalizedContent =
      body.contentFormat === "html" ? sanitizeRichHtml(body.content) : body.content.trim();

    if (Array.isArray(body.categoryIds) && body.categoryIds.length > 0) {
      try {
        await validateCategoryIds(body.categoryIds);
      } catch (err) {
        const unknownIds = (err as { unknownIds?: number[] })?.unknownIds;
        if (Array.isArray(unknownIds) && unknownIds.length > 0) {
          return res
            .status(400)
            .json({ error: (err as Error).message, unknownIds });
        }
        throw err;
      }
    }

    const insertedId = await db.transaction(async (tx) => {
      const insertResult = await tx
        .insert(postsTable)
        .values({
          authorId: currentUser.id,
          authorUserId: currentUser.id,
          authorName,
          authorImageUrl: currentUser.image,
          title: (body as { title?: string }).title?.trim() || null,
          content: normalizedContent,
          contentText: computeContentText(normalizedContent, body.contentFormat),
          contentFormat: body.contentFormat,
          status: postStatus,
          scheduledAt: postStatus === "scheduled" && body.scheduledAt
            ? formatMysqlDateTimeUtc(body.scheduledAt as Date)
            : null,
          // Store platform IDs for later dispatch if not publishing immediately.
          pendingPlatformIds: postStatus !== "published" && rawPlatformIds.length > 0
            ? JSON.stringify(rawPlatformIds)
            : null,
          featuredImageUrl: (body as { featuredImageUrl?: string | null }).featuredImageUrl ?? null,
          socialPostDrafts: (body as { socialPostDrafts?: object | null }).socialPostDrafts
            ? JSON.stringify((body as { socialPostDrafts: object }).socialPostDrafts)
            : null,
          createdAt: formatMysqlDateTime(),
        })
        .$returningId();
      const newId = insertResult[0]?.id;
      if (!newId) throw new Error("Failed to create post");
      if (Array.isArray(body.categoryIds) && body.categoryIds.length > 0) {
        await replacePostCategories(newId, body.categoryIds, tx);
      }
      return newId;
    });

    const post = await db.select().from(postsTable).where(eq(postsTable.id, insertedId)).limit(1);
    if (!post[0]) {
      return res.status(500).json({ error: "Failed to load created post" });
    }

    const categoriesMap = await hydratePostCategories([insertedId]);

    // Only syndicate immediately when publishing now.
    if (postStatus === "published" && rawPlatformIds.length > 0) {
      enqueueSyndication(insertedId, rawPlatformIds, currentUser.id, getOrigin(req), {
        substackSendNewsletter: body.substackSendNewsletter === true,
      });
    }

    return res.status(201).json({
      ...post[0],
      scheduledAt: toUtcIso(post[0].scheduledAt),
      pendingPlatformIds: post[0].pendingPlatformIds
        ? (JSON.parse(post[0].pendingPlatformIds) as number[])
        : null,
      socialPostDrafts: post[0].socialPostDrafts
        ? JSON.parse(post[0].socialPostDrafts)
        : null,
      commentCount: 0,
      categories: categoriesMap.get(insertedId) ?? [],
      syndications: [],
    });
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// GET /posts/:id — get post with comments
router.get("/posts/:id", async (req: Request, res: Response) => {
  try {
    const { id } = GetPostParams.parse(req.params);

    const postRows = await db
      .select({
        id: postsTable.id,
        authorId: postsTable.authorId,
        authorName: postsTable.authorName,
        authorImageUrl: postsTable.authorImageUrl,
        title: postsTable.title,
        content: postsTable.content,
        contentFormat: postsTable.contentFormat,
        status: postsTable.status,
        scheduledAt: postsTable.scheduledAt,
        pendingPlatformIds: postsTable.pendingPlatformIds,
        featuredImageUrl: postsTable.featuredImageUrl,
        socialPostDrafts: postsTable.socialPostDrafts,
        sourceFeedId: postsTable.sourceFeedId,
        sourceFeedName: feedSourcesTable.name,
        sourceCanonicalUrl: postsTable.sourceCanonicalUrl,
        createdAt: postsTable.createdAt,
        commentCount: count(commentsTable.id),
      })
      .from(postsTable)
      .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
      .leftJoin(feedSourcesTable, eq(feedSourcesTable.id, postsTable.sourceFeedId))
      .where(eq(postsTable.id, id))
      .groupBy(postsTable.id);

    const post = postRows[0];
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }
    if (post.status !== "published") {
      const { user } = await loadCurrentUser(req);
      if (!isPostVisibleToReader(post.status, user)) {
        return res.status(404).json({ error: "Post not found" });
      }
    }

    const comments = await db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.postId, id))
      .orderBy(desc(commentsTable.createdAt));

    const categoriesMap = await hydratePostCategories([id]);
    const [withSyndication] = await attachSyndications([{ ...post, categories: categoriesMap.get(id) ?? [] }]);
    return res.json({
      post: {
        ...withSyndication,
        scheduledAt: toUtcIso((withSyndication as { scheduledAt?: string | null }).scheduledAt),
        pendingPlatformIds: (withSyndication as { pendingPlatformIds?: string | null }).pendingPlatformIds
          ? (JSON.parse((withSyndication as { pendingPlatformIds: string }).pendingPlatformIds) as number[])
          : null,
        socialPostDrafts: (withSyndication as { socialPostDrafts?: string | null }).socialPostDrafts
          ? JSON.parse((withSyndication as { socialPostDrafts: string }).socialPostDrafts)
          : null,
      },
      comments,
    });
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// PATCH /posts/:id — update owner-authored post (content, categories, and/or status)
router.patch("/posts/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = GetPostParams.parse(req.params);
    const body = UpdatePostBody.parse(req.body);
    const normalizedContent =
      body.contentFormat === "html" ? sanitizeRichHtml(body.content) : body.content.trim();

    const post = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!post[0]) {
      return res.status(404).json({ error: "Post not found" });
    }
    if (post[0].authorUserId && post[0].authorUserId !== req.currentUser!.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const currentUser = req.currentUser!;
    const newStatus = (body as { status?: string }).status as "published" | "draft" | "scheduled" | undefined;
    const newScheduledAt = (body as { scheduledAt?: Date | null }).scheduledAt;

    // Validate scheduling transitions.
    if (newStatus === "scheduled") {
      if (!newScheduledAt) {
        return res.status(400).json({ error: "scheduledAt is required when transitioning to 'scheduled'" });
      }
      if ((newScheduledAt as Date).getTime() < Date.now() + 1_800_000) {
        return res.status(400).json({ error: "scheduledAt must be at least 30 minutes in the future" });
      }
    }

    if (Array.isArray(body.categoryIds) && body.categoryIds.length > 0) {
      try {
        await validateCategoryIds(body.categoryIds);
      } catch (err) {
        const unknownIds = (err as { unknownIds?: number[] })?.unknownIds;
        if (Array.isArray(unknownIds) && unknownIds.length > 0) {
          return res
            .status(400)
            .json({ error: (err as Error).message, unknownIds });
        }
        throw err;
      }
    }

    // Resolve platform IDs for pending storage or immediate dispatch.
    const rawPlatformIds: number[] | undefined = Array.isArray((body as { platformIds?: unknown }).platformIds)
      ? ((body as { platformIds: unknown[] }).platformIds as unknown[])
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0)
      : undefined;

    const isTransitioningToPublished =
      newStatus === "published" && post[0].status !== "published";

    // Build the status/scheduling patch object.
    type StatusPatch = {
      status?: string;
      scheduledAt?: string | null;
      pendingPlatformIds?: string | null;
    };
    const statusPatch: StatusPatch = {};
    if (newStatus) {
      statusPatch.status = newStatus;
      if (newStatus === "scheduled" && newScheduledAt) {
        statusPatch.scheduledAt = formatMysqlDateTimeUtc(newScheduledAt as Date);
      } else if (newStatus === "published" || newStatus === "draft") {
        statusPatch.scheduledAt = null;
      }
    }
    if (rawPlatformIds !== undefined) {
      if (newStatus !== "published" && post[0].status !== "published") {
        statusPatch.pendingPlatformIds = rawPlatformIds.length > 0
          ? JSON.stringify(rawPlatformIds)
          : null;
      } else if (newStatus !== "published") {
        statusPatch.pendingPlatformIds = rawPlatformIds.length > 0
          ? JSON.stringify(rawPlatformIds)
          : null;
      }
    }
    if (isTransitioningToPublished) {
      // Clear pendingPlatformIds after dispatching.
      statusPatch.pendingPlatformIds = null;
    }

    const titlePatch = (body as { title?: string }).title !== undefined
      ? { title: (body as { title?: string }).title?.trim() || null }
      : {};

    const imagePatch = "featuredImageUrl" in body
      ? { featuredImageUrl: (body as { featuredImageUrl?: string | null }).featuredImageUrl ?? null }
      : {};

    const socialDraftsPatch = "socialPostDrafts" in body
      ? { socialPostDrafts: (body as { socialPostDrafts?: object | null }).socialPostDrafts
            ? JSON.stringify((body as { socialPostDrafts: object }).socialPostDrafts)
            : null }
      : {};

    await db.transaction(async (tx) => {
      await tx
        .update(postsTable)
        .set({
          ...titlePatch,
          ...imagePatch,
          ...socialDraftsPatch,
          ...statusPatch,
          content: normalizedContent,
          contentText: computeContentText(normalizedContent, body.contentFormat),
          contentFormat: body.contentFormat,
        })
        .where(eq(postsTable.id, id));
      if (Array.isArray(body.categoryIds)) {
        await replacePostCategories(id, body.categoryIds, tx);
      }
    });

    // Fire syndication when transitioning to published (draft→pub or scheduled→pub).
    if (isTransitioningToPublished) {
      const platformIds = rawPlatformIds && rawPlatformIds.length > 0
        ? rawPlatformIds
        : post[0].pendingPlatformIds
          ? (JSON.parse(post[0].pendingPlatformIds) as number[])
          : [];
      if (platformIds.length > 0) {
        enqueueSyndication(id, platformIds, currentUser.id, getOrigin(req), {
          substackSendNewsletter: false,
        });
      }
    }

    // Fire syndication when editing an already-published post with explicit platform IDs.
    // This matches the OpenAPI spec: "For already-published posts: triggers immediate syndication."
    if (
      !isTransitioningToPublished &&
      post[0].status === "published" &&
      !newStatus &&
      rawPlatformIds &&
      rawPlatformIds.length > 0
    ) {
      enqueueSyndication(id, rawPlatformIds, currentUser.id, getOrigin(req), {
        substackSendNewsletter: false,
      });
    }

    const updatedPost = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!updatedPost[0]) {
      return res.status(500).json({ error: "Failed to load updated post" });
    }

    const commentCountResult = await db
      .select({ count: count(commentsTable.id) })
      .from(commentsTable)
      .where(eq(commentsTable.postId, id));
    const categoriesMap = await hydratePostCategories([id]);
    const [withSyndication] = await attachSyndications([{
      ...updatedPost[0],
      categories: categoriesMap.get(id) ?? [],
    }]);

    return res.json({
      ...withSyndication,
      scheduledAt: toUtcIso(updatedPost[0].scheduledAt),
      commentCount: commentCountResult[0]?.count ?? 0,
      pendingPlatformIds: updatedPost[0].pendingPlatformIds
        ? (JSON.parse(updatedPost[0].pendingPlatformIds) as number[])
        : null,
      socialPostDrafts: updatedPost[0].socialPostDrafts
        ? JSON.parse(updatedPost[0].socialPostDrafts)
        : null,
    });
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /posts/:id — delete owner-authored post
router.delete("/posts/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = DeletePostParams.parse(req.params);

    const post = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!post[0]) {
      return res.status(404).json({ error: "Post not found" });
    }
    if (post[0].authorUserId && post[0].authorUserId !== req.currentUser!.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await db.delete(postsTable).where(eq(postsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

export default router;

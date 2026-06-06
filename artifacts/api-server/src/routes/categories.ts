import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  categoriesTable,
  postCategoriesTable,
  postsTable,
  commentsTable,
  feedSourcesTable,
  eq,
  desc,
  count,
  and,
  isNull,
  sql,
  formatMysqlDateTime,
} from "@workspace/db";
import { CreateCategoryBody, UpdateCategoryBody } from "@workspace/api-zod";
import { requireAuth, requireOwner } from "../middlewares/auth";
import { loadCurrentUser } from "../lib/current-user";
import {
  slugifyCategoryName,
  findAvailableSlug,
  attachCategoriesToPosts,
} from "../lib/post-categories";
import { isReservedSlug } from "@workspace/db";

const router: IRouter = Router();

function serializeCategory(row: {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /categories — public list with post counts (published only).
router.get("/categories", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: categoriesTable.id,
        slug: categoriesTable.slug,
        name: categoriesTable.name,
        description: categoriesTable.description,
        createdAt: categoriesTable.createdAt,
        updatedAt: categoriesTable.updatedAt,
        postCount: sql<number>`COALESCE(SUM(CASE WHEN ${postsTable.status} = 'published' THEN 1 ELSE 0 END), 0)`,
      })
      .from(categoriesTable)
      .leftJoin(
        postCategoriesTable,
        eq(postCategoriesTable.categoryId, categoriesTable.id),
      )
      .leftJoin(postsTable, eq(postsTable.id, postCategoriesTable.postId))
      .where(isNull(categoriesTable.deletedAt))
      .groupBy(categoriesTable.id)
      .orderBy(categoriesTable.name);

    return res.json({
      categories: rows.map((r) => ({
        ...serializeCategory(r),
        postCount: Number(r.postCount ?? 0),
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /categories — owner only.
router.post(
  "/categories",
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    try {
      const body = CreateCategoryBody.parse(req.body);
      const trimmedName = body.name.trim();
      if (trimmedName.length === 0) {
        return res.status(400).json({ error: "name is required" });
      }
      const desiredSlug = body.slug
        ? slugifyCategoryName(body.slug)
        : slugifyCategoryName(trimmedName);
      // Reserved slugs are off-limits to both categories and pages — a
      // shared check keeps the two route families aligned. We reject
      // explicit user input outright; auto-derived slugs from a category
      // *name* fall back to a deterministic suffixed candidate via
      // findAvailableSlug, so a name like "Feeds" still gets a category
      // (slug "feeds-2") without clobbering the system /feeds route.
      if (body.slug && isReservedSlug(desiredSlug)) {
        return res
          .status(400)
          .json({ error: `\`${desiredSlug}\` is a reserved route on this site`, slug: desiredSlug });
      }
      let baseSlug = desiredSlug;
      if (!body.slug && isReservedSlug(baseSlug)) {
        baseSlug = `${baseSlug}-category`;
      }
      const finalSlug = await findAvailableSlug(baseSlug);

      const insertResult = await db
        .insert(categoriesTable)
        .values({
          slug: finalSlug,
          name: trimmedName,
          description: body.description ?? null,
        })
        .$returningId();
      const id = insertResult[0]?.id;
      if (!id) {
        return res.status(500).json({ error: "Failed to create category" });
      }
      const rows = await db
        .select()
        .from(categoriesTable)
        .where(eq(categoriesTable.id, id))
        .limit(1);
      if (!rows[0]) {
        return res.status(500).json({ error: "Failed to load created category" });
      }
      return res.status(201).json(serializeCategory(rows[0]));
    } catch (err) {
      return res.status(400).json({ error: "Invalid request" });
    }
  },
);

// GET /categories/:slug — public single-category lookup with post count.
router.get("/categories/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").toLowerCase();
    if (!slug) return res.status(404).json({ error: "Not found" });
    const rows = await db
      .select()
      .from(categoriesTable)
      .where(and(eq(categoriesTable.slug, slug), isNull(categoriesTable.deletedAt)))
      .limit(1);
    const cat = rows[0];
    if (!cat) return res.status(404).json({ error: "Not found" });

    const countResult = await db
      .select({ count: count() })
      .from(postCategoriesTable)
      .innerJoin(postsTable, eq(postsTable.id, postCategoriesTable.postId))
      .where(
        and(
          eq(postCategoriesTable.categoryId, cat.id),
          eq(postsTable.status, "published"),
        ),
      );
    return res.json({
      ...serializeCategory(cat),
      postCount: Number(countResult[0]?.count ?? 0),
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH /categories/:id — owner only. Keyed by stable internal id.
// Method dispatch keeps this from clashing with `GET /categories/:slug`.
router.patch(
  "/categories/:id",
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(String(req.params.id || ""), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({ error: "Not found" });
      }
      const body = UpdateCategoryBody.parse(req.body);
      const rows = await db
        .select()
        .from(categoriesTable)
        .where(and(eq(categoriesTable.id, id), isNull(categoriesTable.deletedAt)))
        .limit(1);
      const cat = rows[0];
      if (!cat) return res.status(404).json({ error: "Not found" });

      const updates: {
        name?: string;
        slug?: string;
        description?: string | null;
        updatedAt: string;
      } = { updatedAt: formatMysqlDateTime() };

      if (typeof body.name === "string") {
        const trimmed = body.name.trim();
        if (trimmed.length === 0) {
          return res.status(400).json({ error: "name cannot be empty" });
        }
        updates.name = trimmed;
      }
      if (typeof body.slug === "string") {
        const desired = slugifyCategoryName(body.slug);
        if (desired !== cat.slug) {
          if (isReservedSlug(desired)) {
            return res
              .status(400)
              .json({ error: `\`${desired}\` is a reserved route on this site`, slug: desired });
          }
          // Reject explicit slug clashes with 409 rather than auto-suffixing
          // — the caller asked for that exact slug.
          const clash = await db
            .select({ id: categoriesTable.id })
            .from(categoriesTable)
            .where(eq(categoriesTable.slug, desired))
            .limit(1);
          if (clash[0]) {
            return res.status(409).json({ error: "Slug already exists" });
          }
          updates.slug = desired;
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, "description")) {
        updates.description = body.description ?? null;
      }

      await db.update(categoriesTable).set(updates).where(eq(categoriesTable.id, cat.id));
      const reloaded = await db
        .select()
        .from(categoriesTable)
        .where(eq(categoriesTable.id, cat.id))
        .limit(1);
      return res.json(serializeCategory(reloaded[0]!));
    } catch (err) {
      return res.status(400).json({ error: "Invalid request" });
    }
  },
);

// DELETE /categories/:id — soft-delete (moves to Recycle Bin).
// post_categories join rows are preserved so the category's post assignments
// are restored intact when the category is recovered.
router.delete(
  "/categories/:id",
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(String(req.params.id || ""), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({ error: "Not found" });
      }
      const rows = await db
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(and(eq(categoriesTable.id, id), isNull(categoriesTable.deletedAt)))
        .limit(1);
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      await db.update(categoriesTable).set({ deletedAt: sql`CURRENT_TIMESTAMP(3)` }).where(eq(categoriesTable.id, id));
      return res.status(204).send();
    } catch (err) {
      return res.status(400).json({ error: "Invalid request" });
    }
  },
);

// GET /categories/:slug/posts — paginated posts in a category.
// Only published posts by default; owners may pass `?includePending=1`
// to also include pending posts (useful for the management UI).
router.get("/categories/:slug/posts", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").toLowerCase();
    const rawPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const rawLimit = Number.parseInt(String(req.query.limit ?? "20"), 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
    const offset = (page - 1) * limit;

    const wantPending = String(req.query.includePending ?? "") === "1";
    let includePending = false;
    if (wantPending) {
      const { user } = await loadCurrentUser(req);
      if (user?.role === "owner") includePending = true;
    }

    const catRows = await db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.slug, slug))
      .limit(1);
    const cat = catRows[0];
    if (!cat) return res.status(404).json({ error: "Not found" });

    const statusWhere = includePending
      ? sql`${postsTable.status} IN ('published','pending')`
      : eq(postsTable.status, "published");

    const posts = await db
      .select({
        id: postsTable.id,
        authorId: postsTable.authorId,
        authorName: postsTable.authorName,
        authorImageUrl: postsTable.authorImageUrl,
        content: postsTable.content,
        contentFormat: postsTable.contentFormat,
        sourceFeedId: postsTable.sourceFeedId,
        sourceFeedName: feedSourcesTable.name,
        sourceCanonicalUrl: postsTable.sourceCanonicalUrl,
        createdAt: postsTable.createdAt,
        commentCount: count(commentsTable.id),
      })
      .from(postsTable)
      .innerJoin(
        postCategoriesTable,
        eq(postCategoriesTable.postId, postsTable.id),
      )
      .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
      .leftJoin(feedSourcesTable, eq(feedSourcesTable.id, postsTable.sourceFeedId))
      .where(and(eq(postCategoriesTable.categoryId, cat.id), statusWhere))
      .groupBy(postsTable.id)
      .orderBy(desc(postsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRow = await db
      .select({ count: count() })
      .from(postCategoriesTable)
      .innerJoin(postsTable, eq(postsTable.id, postCategoriesTable.postId))
      .where(and(eq(postCategoriesTable.categoryId, cat.id), statusWhere));
    const total = Number(totalRow[0]?.count ?? 0);

    const hydrated = await attachCategoriesToPosts(posts);
    return res.json({ posts: hydrated, total, page, limit });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;

// Standalone CMS pages. Reuses the post HTML sanitizer and keeps a
// matching nav_links row in sync (kind='page', FK cascade on delete).
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  pagesTable,
  navLinksTable,
  eq,
  and,
  isNull,
  desc,
  sql,
  formatMysqlDateTime,
} from "@workspace/db";
import { CreatePageBody, UpdatePageBody } from "@workspace/api-zod";
import { requireAuth, requireOwner } from "../middlewares/auth";
import { loadCurrentUser } from "../lib/current-user";
import { sanitizeRichHtml, computeContentText } from "../lib/html";
import { validatePageSlug, rejectionMessage, suggestAvailableSlug } from "../lib/page-slug";

const router: IRouter = Router();

type PageRow = typeof pagesTable.$inferSelect;

function serialize(row: PageRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    contentFormat: row.contentFormat,
    status: row.status,
    showInNav: Boolean(row.showInNav),
    authorUserId: row.authorUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findOrCreatePageNavRow(
  page: PageRow,
): Promise<void> {
  const existing = await db
    .select({ id: navLinksTable.id, visible: navLinksTable.visible })
    .from(navLinksTable)
    .where(eq(navLinksTable.pageId, page.id))
    .limit(1);

  const wantVisible = page.showInNav && page.status === "published";

  if (existing[0]) {
    await db
      .update(navLinksTable)
      .set({
        label: page.title.slice(0, 64),
        visible: wantVisible,
        updatedAt: formatMysqlDateTime(),
      })
      .where(eq(navLinksTable.id, existing[0].id));
    return;
  }

  if (page.status !== "published") {
    return;
  }

  const maxRow = await db
    .select({ max: sql<number>`COALESCE(MAX(${navLinksTable.sortOrder}), 0)` })
    .from(navLinksTable);
  const nextSort = Number(maxRow[0]?.max ?? 0) + 10;

  await db.insert(navLinksTable).values({
    label: page.title.slice(0, 64),
    url: `/p/${page.slug}`,
    openInNewTab: false,
    sortOrder: nextSort,
    kind: "page",
    pageId: page.id,
    visible: wantVisible,
  });
}

router.get("/pages", async (req: Request, res: Response) => {
  try {
    const wantDrafts = String(req.query.includeDrafts ?? "") === "1";
    let includeDrafts = false;
    if (wantDrafts) {
      const { user } = await loadCurrentUser(req);
      if (user?.role === "owner") includeDrafts = true;
    }

    const rows = await db
      .select()
      .from(pagesTable)
      .where(and(
        isNull(pagesTable.deletedAt),
        includeDrafts ? sql`1 = 1` : eq(pagesTable.status, "published"),
      ))
      .orderBy(desc(pagesTable.updatedAt));
    return res.json({ pages: rows.map(serialize) });
  } catch (err) {
    console.error("Failed to list pages:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/pages/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").toLowerCase();
    if (!slug) return res.status(404).json({ error: "Not found" });
    const rows = await db
      .select()
      .from(pagesTable)
      .where(and(eq(pagesTable.slug, slug), isNull(pagesTable.deletedAt)))
      .limit(1);
    const page = rows[0];
    if (!page) return res.status(404).json({ error: "Not found" });

    if (page.status !== "published") {
      const { user } = await loadCurrentUser(req);
      if (user?.role !== "owner") {
        return res.status(404).json({ error: "Not found" });
      }
    }
    return res.json(serialize(page));
  } catch (err) {
    console.error("Failed to get page:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post(
  "/pages",
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    try {
      const parsed = CreatePageBody.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid request body", details: parsed.error.format() });
      }
      const title = parsed.data.title.trim();
      if (title.length === 0) {
        return res.status(400).json({ error: "title is required" });
      }
      const slugCheck = await validatePageSlug(parsed.data.slug);
      if ("error" in slugCheck) {
        const suggestion =
          slugCheck.error.kind === "taken"
            ? await suggestAvailableSlug(slugCheck.error.slug)
            : null;
        return res.status(400).json({
          error: rejectionMessage(slugCheck.error),
          slug: parsed.data.slug,
          ...(suggestion ? { suggestion } : {}),
        });
      }

      const sanitizedContent = sanitizeRichHtml(parsed.data.content ?? "");
      const contentText = computeContentText(sanitizedContent, "html");

      const insertResult = await db
        .insert(pagesTable)
        .values({
          slug: slugCheck.slug,
          title,
          content: sanitizedContent,
          contentFormat: "html",
          contentText,
          status: parsed.data.status ?? "draft",
          showInNav: parsed.data.showInNav ?? true,
          authorUserId: req.currentUser?.id ?? null,
        })
        .$returningId();
      const id = insertResult[0]?.id;
      if (!id) return res.status(500).json({ error: "Failed to create page" });

      const rows = await db
        .select()
        .from(pagesTable)
        .where(eq(pagesTable.id, id))
        .limit(1);
      const page = rows[0]!;
      await findOrCreatePageNavRow(page);
      return res.status(201).json(serialize(page));
    } catch (err) {
      console.error("Failed to create page:", err);
      return res.status(400).json({ error: "Invalid request" });
    }
  },
);

router.patch(
  "/pages/:id",
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(String(req.params.id || ""), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({ error: "Not found" });
      }
      const parsed = UpdatePageBody.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid request body", details: parsed.error.format() });
      }
      const rows = await db
        .select()
        .from(pagesTable)
        .where(and(eq(pagesTable.id, id), isNull(pagesTable.deletedAt)))
        .limit(1);
      const page = rows[0];
      if (!page) return res.status(404).json({ error: "Not found" });

      const updates: Partial<{
        slug: string;
        title: string;
        content: string;
        contentText: string;
        status: string;
        showInNav: boolean;
        updatedAt: string;
      }> = { updatedAt: formatMysqlDateTime() };

      if (typeof parsed.data.slug === "string") {
        const slugCheck = await validatePageSlug(parsed.data.slug, {
          excludePageId: id,
        });
        if ("error" in slugCheck) {
          const suggestion =
            slugCheck.error.kind === "taken"
              ? await suggestAvailableSlug(slugCheck.error.slug)
              : null;
          return res.status(400).json({
            error: rejectionMessage(slugCheck.error),
            slug: parsed.data.slug,
            ...(suggestion ? { suggestion } : {}),
          });
        }
        updates.slug = slugCheck.slug;
      }
      if (typeof parsed.data.title === "string") {
        const trimmed = parsed.data.title.trim();
        if (trimmed.length === 0) {
          return res.status(400).json({ error: "title cannot be empty" });
        }
        updates.title = trimmed;
      }
      if (typeof parsed.data.content === "string") {
        const sanitized = sanitizeRichHtml(parsed.data.content);
        updates.content = sanitized;
        updates.contentText = computeContentText(sanitized, "html");
      }
      if (typeof parsed.data.status === "string") {
        updates.status = parsed.data.status;
      }
      if (typeof parsed.data.showInNav === "boolean") {
        updates.showInNav = parsed.data.showInNav;
      }

      await db.update(pagesTable).set(updates).where(eq(pagesTable.id, id));

      const reloaded = await db
        .select()
        .from(pagesTable)
        .where(eq(pagesTable.id, id))
        .limit(1);
      const updatedPage = reloaded[0]!;

      const existingNav = await db
        .select()
        .from(navLinksTable)
        .where(eq(navLinksTable.pageId, id))
        .limit(1);
      if (existingNav[0]) {
        const navUpdates: Partial<{
          label: string;
          url: string;
          visible: boolean;
          updatedAt: string;
        }> = {
          label: updatedPage.title.slice(0, 64),
          url: `/p/${updatedPage.slug}`,
          updatedAt: formatMysqlDateTime(),
        };
        const wasPublished = page.status === "published";
        const isPublished = updatedPage.status === "published";
        if (parsed.data.showInNav === false) {
          navUpdates.visible = false;
        } else if (parsed.data.showInNav === true && isPublished) {
          navUpdates.visible = true;
        } else if (!isPublished) {
          navUpdates.visible = false;
        } else if (!wasPublished && isPublished && updatedPage.showInNav) {
          navUpdates.visible = true;
        }
        await db
          .update(navLinksTable)
          .set(navUpdates)
          .where(eq(navLinksTable.id, existingNav[0].id));
      } else {
        await findOrCreatePageNavRow(updatedPage);
      }

      return res.json(serialize(updatedPage));
    } catch (err) {
      console.error("Failed to update page:", err);
      return res.status(400).json({ error: "Invalid request" });
    }
  },
);

router.delete(
  "/pages/:id",
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(String(req.params.id || ""), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({ error: "Not found" });
      }
      const rows = await db
        .select({ id: pagesTable.id })
        .from(pagesTable)
        .where(and(eq(pagesTable.id, id), isNull(pagesTable.deletedAt)))
        .limit(1);
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      await db.update(pagesTable).set({ deletedAt: sql`CURRENT_TIMESTAMP(3)` }).where(eq(pagesTable.id, id));
      // Hide the page's nav_link while it is in the Recycle Bin.
      await db.update(navLinksTable).set({ visible: false }).where(eq(navLinksTable.pageId, id));
      return res.status(204).send();
    } catch (err) {
      console.error("Failed to delete page:", err);
      return res.status(400).json({ error: "Invalid request" });
    }
  },
);

export default router;

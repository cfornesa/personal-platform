import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  postsTable,
  artPiecesTable,
  mediaAssetsTable,
  exhibitsTable,
  pagesTable,
  categoriesTable,
  navLinksTable,
  eq,
  and,
  isNull,
  isNotNull,
  desc,
  inArray,
  sql,
} from "@workspace/db";
import { requireAuth, requireOwner } from "../middlewares/auth";
import { z } from "zod/v4";

const router: IRouter = Router();

const IdParam = z.object({ id: z.coerce.number().int().positive() });

const BulkDeleteBody = z.object({
  postIds: z.array(z.number().int().positive()).optional(),
  pieceIds: z.array(z.number().int().positive()).optional(),
  mediaIds: z.array(z.number().int().positive()).optional(),
  exhibitIds: z.array(z.number().int().positive()).optional(),
  pageIds: z.array(z.number().int().positive()).optional(),
  categoryIds: z.array(z.number().int().positive()).optional(),
});

// GET /recycle-bin — list all soft-deleted items
router.get("/recycle-bin", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const userId = req.currentUser!.id;

    const [posts, pieces, media, exhibits, pages, categories] = await Promise.all([
      db
        .select({
          id: postsTable.id,
          title: postsTable.title,
          content: postsTable.content,
          contentFormat: postsTable.contentFormat,
          status: postsTable.status,
          createdAt: postsTable.createdAt,
          deletedAt: postsTable.deletedAt,
        })
        .from(postsTable)
        .where(and(eq(postsTable.authorUserId, userId), isNotNull(postsTable.deletedAt)))
        .orderBy(desc(postsTable.deletedAt)),

      db
        .select({
          id: artPiecesTable.id,
          title: artPiecesTable.title,
          engine: artPiecesTable.engine,
          thumbnailUrl: artPiecesTable.thumbnailUrl,
          createdAt: artPiecesTable.createdAt,
          deletedAt: artPiecesTable.deletedAt,
        })
        .from(artPiecesTable)
        .where(and(eq(artPiecesTable.ownerUserId, userId), isNotNull(artPiecesTable.deletedAt)))
        .orderBy(desc(artPiecesTable.deletedAt)),

      db
        .select({
          id: mediaAssetsTable.id,
          url: mediaAssetsTable.url,
          filename: mediaAssetsTable.filename,
          title: mediaAssetsTable.title,
          mimeType: mediaAssetsTable.mimeType,
          altText: mediaAssetsTable.altText,
          uploadedAt: mediaAssetsTable.uploadedAt,
          deletedAt: mediaAssetsTable.deletedAt,
        })
        .from(mediaAssetsTable)
        .where(isNotNull(mediaAssetsTable.deletedAt))
        .orderBy(desc(mediaAssetsTable.deletedAt)),

      db
        .select({
          id: exhibitsTable.id,
          name: exhibitsTable.name,
          slug: exhibitsTable.slug,
          description: exhibitsTable.description,
          createdAt: exhibitsTable.createdAt,
          deletedAt: exhibitsTable.deletedAt,
        })
        .from(exhibitsTable)
        .where(isNotNull(exhibitsTable.deletedAt))
        .orderBy(desc(exhibitsTable.deletedAt)),

      db
        .select({
          id: pagesTable.id,
          slug: pagesTable.slug,
          title: pagesTable.title,
          status: pagesTable.status,
          createdAt: pagesTable.createdAt,
          deletedAt: pagesTable.deletedAt,
        })
        .from(pagesTable)
        .where(isNotNull(pagesTable.deletedAt))
        .orderBy(desc(pagesTable.deletedAt)),

      db
        .select({
          id: categoriesTable.id,
          slug: categoriesTable.slug,
          name: categoriesTable.name,
          description: categoriesTable.description,
          createdAt: categoriesTable.createdAt,
          deletedAt: categoriesTable.deletedAt,
        })
        .from(categoriesTable)
        .where(isNotNull(categoriesTable.deletedAt))
        .orderBy(desc(categoriesTable.deletedAt)),
    ]);

    return res.json({ posts, pieces, media, exhibits, pages, categories });
  } catch (err) {
    console.error("GET /recycle-bin failed:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /recycle-bin/posts/:id/restore
router.post("/recycle-bin/posts/:id/restore", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);
    const userId = req.currentUser!.id;

    const [post] = await db
      .select({ id: postsTable.id })
      .from(postsTable)
      .where(and(eq(postsTable.id, id), eq(postsTable.authorUserId, userId), isNotNull(postsTable.deletedAt)))
      .limit(1);

    if (!post) return res.status(404).json({ error: "Not found in Recycle Bin" });

    await db.update(postsTable).set({ deletedAt: null }).where(eq(postsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// POST /recycle-bin/pieces/:id/restore
router.post("/recycle-bin/pieces/:id/restore", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);
    const userId = req.currentUser!.id;

    const [piece] = await db
      .select({ id: artPiecesTable.id })
      .from(artPiecesTable)
      .where(and(eq(artPiecesTable.id, id), eq(artPiecesTable.ownerUserId, userId), isNotNull(artPiecesTable.deletedAt)))
      .limit(1);

    if (!piece) return res.status(404).json({ error: "Not found in Recycle Bin" });

    await db.update(artPiecesTable).set({ deletedAt: null }).where(eq(artPiecesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// POST /recycle-bin/media/:id/restore
router.post("/recycle-bin/media/:id/restore", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);

    const [asset] = await db
      .select({ id: mediaAssetsTable.id })
      .from(mediaAssetsTable)
      .where(and(eq(mediaAssetsTable.id, id), isNotNull(mediaAssetsTable.deletedAt)))
      .limit(1);

    if (!asset) return res.status(404).json({ error: "Not found in Recycle Bin" });

    await db.update(mediaAssetsTable).set({ deletedAt: null }).where(eq(mediaAssetsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /recycle-bin/posts/:id — permanently delete a single trashed post
router.delete("/recycle-bin/posts/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);
    const userId = req.currentUser!.id;

    const [post] = await db
      .select({ id: postsTable.id })
      .from(postsTable)
      .where(and(eq(postsTable.id, id), eq(postsTable.authorUserId, userId), isNotNull(postsTable.deletedAt)))
      .limit(1);

    if (!post) return res.status(404).json({ error: "Not found in Recycle Bin" });

    await db.delete(postsTable).where(eq(postsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /recycle-bin/pieces/:id — permanently delete a single trashed piece
router.delete("/recycle-bin/pieces/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);
    const userId = req.currentUser!.id;

    const [piece] = await db
      .select({ id: artPiecesTable.id })
      .from(artPiecesTable)
      .where(and(eq(artPiecesTable.id, id), eq(artPiecesTable.ownerUserId, userId), isNotNull(artPiecesTable.deletedAt)))
      .limit(1);

    if (!piece) return res.status(404).json({ error: "Not found in Recycle Bin" });

    await db.delete(artPiecesTable).where(eq(artPiecesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /recycle-bin/media/:id — permanently delete a single trashed media asset
router.delete("/recycle-bin/media/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);

    const [asset] = await db
      .select({ id: mediaAssetsTable.id })
      .from(mediaAssetsTable)
      .where(and(eq(mediaAssetsTable.id, id), isNotNull(mediaAssetsTable.deletedAt)))
      .limit(1);

    if (!asset) return res.status(404).json({ error: "Not found in Recycle Bin" });

    await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /recycle-bin — bulk permanently delete
router.delete("/recycle-bin", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const body = BulkDeleteBody.parse(req.body);
    const userId = req.currentUser!.id;

    await Promise.all([
      body.postIds?.length
        ? db.delete(postsTable).where(
            and(
              inArray(postsTable.id, body.postIds),
              eq(postsTable.authorUserId, userId),
              isNotNull(postsTable.deletedAt),
            ),
          )
        : Promise.resolve(),

      body.pieceIds?.length
        ? db.delete(artPiecesTable).where(
            and(
              inArray(artPiecesTable.id, body.pieceIds),
              eq(artPiecesTable.ownerUserId, userId),
              isNotNull(artPiecesTable.deletedAt),
            ),
          )
        : Promise.resolve(),

      body.mediaIds?.length
        ? db.delete(mediaAssetsTable).where(
            and(
              inArray(mediaAssetsTable.id, body.mediaIds),
              isNotNull(mediaAssetsTable.deletedAt),
            ),
          )
        : Promise.resolve(),

      body.exhibitIds?.length
        ? db.delete(exhibitsTable).where(
            and(
              inArray(exhibitsTable.id, body.exhibitIds),
              isNotNull(exhibitsTable.deletedAt),
            ),
          )
        : Promise.resolve(),

      body.pageIds?.length
        ? db.delete(pagesTable).where(
            and(
              inArray(pagesTable.id, body.pageIds),
              isNotNull(pagesTable.deletedAt),
            ),
          )
        : Promise.resolve(),

      body.categoryIds?.length
        ? db.delete(categoriesTable).where(
            and(
              inArray(categoriesTable.id, body.categoryIds),
              isNotNull(categoriesTable.deletedAt),
            ),
          )
        : Promise.resolve(),
    ]);

    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// POST /recycle-bin/exhibits/:id/restore
router.post("/recycle-bin/exhibits/:id/restore", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [exhibit] = await db
      .select({ id: exhibitsTable.id })
      .from(exhibitsTable)
      .where(and(eq(exhibitsTable.id, id), isNotNull(exhibitsTable.deletedAt)))
      .limit(1);
    if (!exhibit) return res.status(404).json({ error: "Not found in Recycle Bin" });
    await db.update(exhibitsTable).set({ deletedAt: null }).where(eq(exhibitsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /recycle-bin/exhibits/:id
router.delete("/recycle-bin/exhibits/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [exhibit] = await db
      .select({ id: exhibitsTable.id })
      .from(exhibitsTable)
      .where(and(eq(exhibitsTable.id, id), isNotNull(exhibitsTable.deletedAt)))
      .limit(1);
    if (!exhibit) return res.status(404).json({ error: "Not found in Recycle Bin" });
    await db.delete(exhibitsTable).where(eq(exhibitsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// POST /recycle-bin/pages/:id/restore — also restores the nav_link visibility
router.post("/recycle-bin/pages/:id/restore", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [page] = await db
      .select({ id: pagesTable.id, showInNav: pagesTable.showInNav, status: pagesTable.status })
      .from(pagesTable)
      .where(and(eq(pagesTable.id, id), isNotNull(pagesTable.deletedAt)))
      .limit(1);
    if (!page) return res.status(404).json({ error: "Not found in Recycle Bin" });
    await db.update(pagesTable).set({ deletedAt: null }).where(eq(pagesTable.id, id));
    const navVisible = page.showInNav && page.status === "published";
    await db.update(navLinksTable).set({ visible: navVisible }).where(eq(navLinksTable.pageId, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /recycle-bin/pages/:id
router.delete("/recycle-bin/pages/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [page] = await db
      .select({ id: pagesTable.id })
      .from(pagesTable)
      .where(and(eq(pagesTable.id, id), isNotNull(pagesTable.deletedAt)))
      .limit(1);
    if (!page) return res.status(404).json({ error: "Not found in Recycle Bin" });
    await db.delete(pagesTable).where(eq(pagesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// POST /recycle-bin/categories/:id/restore
router.post("/recycle-bin/categories/:id/restore", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [cat] = await db
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(and(eq(categoriesTable.id, id), isNotNull(categoriesTable.deletedAt)))
      .limit(1);
    if (!cat) return res.status(404).json({ error: "Not found in Recycle Bin" });
    await db.update(categoriesTable).set({ deletedAt: null }).where(eq(categoriesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /recycle-bin/categories/:id
router.delete("/recycle-bin/categories/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [cat] = await db
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(and(eq(categoriesTable.id, id), isNotNull(categoriesTable.deletedAt)))
      .limit(1);
    if (!cat) return res.status(404).json({ error: "Not found in Recycle Bin" });
    await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

export default router;

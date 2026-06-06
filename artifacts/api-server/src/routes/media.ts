import path from "node:path";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { requireAuth, requireOwner } from "../middlewares/auth";
import { createRateLimitMiddleware } from "../lib/ratelimit";
import {
  deriveMediaTitle,
  fetchRemoteImageForImport,
  MAX_MEDIA_BYTES,
  MAX_MEDIA_MB,
  RemoteMediaImportError,
  storeUploadedImage,
} from "../lib/media";
import { loadExhibitMembershipMap } from "../lib/exhibit-memberships";
import { db, mediaAssetsTable, desc, eq, and, isNull, sql } from "@workspace/db";

const router: IRouter = Router();

async function attachMediaExhibitIds<T extends { id: number }>(
  items: T[],
): Promise<Array<T & { exhibitIds: number[] }>> {
  if (items.length === 0) return items.map((i) => ({ ...i, exhibitIds: [] }));
  const map = await loadExhibitMembershipMap({
    tableName: "media_asset_exhibits",
    ownerColumn: "media_asset_id",
    ownerIds: items.map((i) => i.id),
  });
  return items.map((i) => ({ ...i, exhibitIds: map.get(i.id) ?? [] }));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_MEDIA_BYTES,
    files: 1,
  },
});

function uploadSingleFile(req: Request, res: Response, next: NextFunction) {
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

router.post(
  "/media",
  createRateLimitMiddleware({ windowMs: 60_000, max: 20 }),
  requireAuth,
  requireOwner,
  uploadSingleFile,
  async (req: Request, res: Response) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ error: "File upload is required" });
      }

      const uploaded = await storeUploadedImage(req.file.buffer, deriveMediaTitle(req.file.originalname));

      return res.status(201).json({
        url: uploaded.url,
        title: uploaded.title,
        mimeType: uploaded.mimeType,
        width: null,
        height: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid upload";
      return res.status(400).json({ error: message });
    }
  },
);

router.post(
  "/media/import",
  createRateLimitMiddleware({ windowMs: 60_000, max: 20 }),
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    try {
      const { imageUrl, altText } = req.body as { imageUrl?: unknown; altText?: unknown };
      if (typeof imageUrl !== "string" || !imageUrl.trim()) {
        return res.status(400).json({ error: "imageUrl is required" });
      }
      if (altText !== null && altText !== undefined && typeof altText !== "string") {
        return res.status(400).json({ error: "altText must be a string or null" });
      }

      const buffer = await fetchRemoteImageForImport(imageUrl.trim());
      const uploaded = await storeUploadedImage(buffer, deriveMediaTitle(imageUrl));

      if (typeof altText === "string" && altText.trim()) {
        await db
          .update(mediaAssetsTable)
          .set({ altText: altText.trim().slice(0, 500) })
          .where(eq(mediaAssetsTable.filename, uploaded.fileName));
      }

      return res.status(201).json({
        url: uploaded.url,
        title: uploaded.title,
        mimeType: uploaded.mimeType,
        width: null,
        height: null,
      });
    } catch (error) {
      if (error instanceof RemoteMediaImportError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      const message = error instanceof Error ? error.message : "Invalid image URL";
      return res.status(400).json({ error: message });
    }
  },
);

router.get(
  "/media",
  createRateLimitMiddleware({ windowMs: 60_000, max: 120 }),
  requireAuth,
  requireOwner,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select({
        id: mediaAssetsTable.id,
        url: mediaAssetsTable.url,
        filename: mediaAssetsTable.filename,
        title: mediaAssetsTable.title,
        mimeType: mediaAssetsTable.mimeType,
        uploadedAt: mediaAssetsTable.uploadedAt,
        altText: mediaAssetsTable.altText,
      })
      .from(mediaAssetsTable)
      .where(isNull(mediaAssetsTable.deletedAt))
      .orderBy(desc(mediaAssetsTable.uploadedAt));
    const assets = await attachMediaExhibitIds(rows);
    return res.json(assets);
  },
);

router.patch(
  "/media/:fileName",
  createRateLimitMiddleware({ windowMs: 60_000, max: 60 }),
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    const rawFileName = Array.isArray(req.params.fileName) ? req.params.fileName[0] : req.params.fileName;
    const fileName = path.basename(rawFileName);

    const { altText, title } = req.body as { altText?: unknown; title?: unknown };
    if (altText !== null && altText !== undefined && typeof altText !== "string") {
      return res.status(400).json({ error: "altText must be a string or null" });
    }
    if (title !== null && title !== undefined && typeof title !== "string") {
      return res.status(400).json({ error: "title must be a string or null" });
    }
    const hasAltText = Object.prototype.hasOwnProperty.call(req.body, "altText");
    const hasTitle = Object.prototype.hasOwnProperty.call(req.body, "title");
    if (!hasAltText && !hasTitle) {
      return res.status(400).json({ error: "title or altText is required" });
    }

    const [asset] = await db
      .select({ id: mediaAssetsTable.id })
      .from(mediaAssetsTable)
      .where(eq(mediaAssetsTable.filename, fileName))
      .limit(1);

    if (!asset) {
      return res.status(404).json({ error: "Media not found" });
    }

    const [updated] = await db
      .update(mediaAssetsTable)
      .set({
        ...(hasAltText
          ? { altText: typeof altText === "string" ? altText.trim().slice(0, 500) || null : null }
          : {}),
        ...(hasTitle
          ? { title: typeof title === "string" ? title.trim().slice(0, 255) || null : null }
          : {}),
      })
      .where(eq(mediaAssetsTable.filename, fileName));

    void updated;

    const [freshRow] = await db
      .select({
        id: mediaAssetsTable.id,
        url: mediaAssetsTable.url,
        filename: mediaAssetsTable.filename,
        title: mediaAssetsTable.title,
        mimeType: mediaAssetsTable.mimeType,
        uploadedAt: mediaAssetsTable.uploadedAt,
        altText: mediaAssetsTable.altText,
      })
      .from(mediaAssetsTable)
      .where(eq(mediaAssetsTable.filename, fileName))
      .limit(1);

    const [fresh] = await attachMediaExhibitIds(freshRow ? [freshRow] : []);
    return res.json(fresh);
  },
);

router.delete(
  "/media/:fileName",
  createRateLimitMiddleware({ windowMs: 60_000, max: 60 }),
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    const rawFileName = Array.isArray(req.params.fileName) ? req.params.fileName[0] : req.params.fileName;
    const fileName = path.basename(rawFileName);
    const url = `/api/media/${fileName}`;

    const [asset] = await db
      .select({ id: mediaAssetsTable.id })
      .from(mediaAssetsTable)
      .where(and(eq(mediaAssetsTable.filename, fileName), isNull(mediaAssetsTable.deletedAt)))
      .limit(1);

    if (!asset) {
      return res.status(404).json({ error: "Media not found" });
    }

    await db.update(mediaAssetsTable).set({ deletedAt: sql`CURRENT_TIMESTAMP(3)` }).where(eq(mediaAssetsTable.url, url));

    return res.status(204).end();
  },
);

router.get(
  "/media/:fileName",
  createRateLimitMiddleware({ windowMs: 60_000, max: 120 }),
  async (req: Request, res: Response) => {
    const rawFileName = Array.isArray(req.params.fileName) ? req.params.fileName[0] : req.params.fileName;
    const fileName = path.basename(rawFileName);

    const [row] = await db
      .select({ mimeType: mediaAssetsTable.mimeType, fileData: mediaAssetsTable.fileData })
      .from(mediaAssetsTable)
      .where(eq(mediaAssetsTable.filename, fileName))
      .limit(1);

    if (!row?.fileData) {
      return res.status(404).json({ error: "Media not found" });
    }

    const buffer = Buffer.isBuffer(row.fileData) ? row.fileData : Buffer.from(row.fileData as ArrayBuffer);
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.end(buffer);
  },
);

export default router;

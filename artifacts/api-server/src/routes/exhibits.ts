import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  exhibitsTable,
  artPiecesTable,
  artPieceVersionsTable,
  mediaAssetsTable,
  eq,
  inArray,
  formatMysqlDateTime,
} from "@workspace/db";
import { z } from "zod/v4";
import { requireAuth, requireOwner } from "../middlewares/auth";
import {
  countMembershipsByExhibit,
  listOwnersForExhibit,
  replaceExhibitMemberships,
} from "../lib/exhibit-memberships";
import type { Exhibit } from "@workspace/db";

const router: IRouter = Router();

const CreateExhibitBody = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z.string().trim().max(191).optional(),
  description: z.string().nullable().optional(),
});

const UpdateExhibitBody = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  slug: z.string().trim().max(191).optional(),
  description: z.string().nullable().optional(),
  artistStatement: z.string().nullable().optional(),
  biography: z.string().nullable().optional(),
  rows: z.number().int().min(1).max(4).optional(),
  cols: z.number().int().min(1).max(8).optional(),
});

const SetExhibitMembershipsBody = z.object({
  exhibitIds: z.array(z.number().int().positive()),
});

const ExhibitIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

const SLUG_MAX_LEN = 191;

function slugifyExhibitName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LEN);
  return slug || "exhibit";
}

async function findAvailableExhibitSlug(base: string): Promise<string> {
  let candidate = base;
  let counter = 2;
  for (let i = 0; i < 1000; i += 1) {
    const existing = await db
      .select({ id: exhibitsTable.id })
      .from(exhibitsTable)
      .where(eq(exhibitsTable.slug, candidate))
      .limit(1);
    if (!existing[0]) return candidate;
    const suffix = `-${counter}`;
    const trimmedBase = base.slice(0, SLUG_MAX_LEN - suffix.length);
    candidate = `${trimmedBase}${suffix}`;
    counter += 1;
  }
  throw new Error("Could not find an available exhibit slug");
}

function serializeExhibit(row: Exhibit) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    artistStatement: row.artistStatement ?? null,
    biography: row.biography ?? null,
    rows: row.rows ?? 1,
    cols: row.cols ?? 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /exhibits — public list with item counts.
router.get("/exhibits", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(exhibitsTable).orderBy(exhibitsTable.name);
    const exhibitIds = rows.map((row) => row.id);
    const [pieceCounts, imageCounts] = await Promise.all([
      countMembershipsByExhibit({ tableName: "piece_exhibits", exhibitIds }),
      countMembershipsByExhibit({ tableName: "media_asset_exhibits", exhibitIds }),
    ]);

    return res.json({
      exhibits: rows.map((r) => ({
        ...serializeExhibit(r),
        pieceCount: pieceCounts.get(r.id) ?? 0,
        imageCount: imageCounts.get(r.id) ?? 0,
      })),
    });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /exhibits — owner only.
router.post("/exhibits", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const body = CreateExhibitBody.parse(req.body);
    const desiredSlug = body.slug
      ? slugifyExhibitName(body.slug)
      : slugifyExhibitName(body.name);

    if (body.slug) {
      const clash = await db
        .select({ id: exhibitsTable.id })
        .from(exhibitsTable)
        .where(eq(exhibitsTable.slug, desiredSlug))
        .limit(1);
      if (clash[0]) {
        return res.status(409).json({ error: "Slug already exists" });
      }
    }

    const finalSlug = body.slug ? desiredSlug : await findAvailableExhibitSlug(desiredSlug);

    const insertResult = await db
      .insert(exhibitsTable)
      .values({
        slug: finalSlug,
        name: body.name.trim(),
        description: body.description ?? null,
      })
      .$returningId();
    const id = insertResult[0]?.id;
    if (!id) {
      return res.status(500).json({ error: "Failed to create exhibit" });
    }
    const rows = await db
      .select()
      .from(exhibitsTable)
      .where(eq(exhibitsTable.id, id))
      .limit(1);
    if (!rows[0]) {
      return res.status(500).json({ error: "Failed to load created exhibit" });
    }
    return res.status(201).json(serializeExhibit(rows[0]));
  } catch {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// GET /exhibits/:slug — public single exhibit with counts.
router.get("/exhibits/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").toLowerCase();
    if (!slug) return res.status(404).json({ error: "Not found" });

    const rows = await db
      .select()
      .from(exhibitsTable)
      .where(eq(exhibitsTable.slug, slug))
      .limit(1);
    const exhibit = rows[0];
    if (!exhibit) return res.status(404).json({ error: "Not found" });

    const [pieceCounts, imageCounts] = await Promise.all([
      countMembershipsByExhibit({ tableName: "piece_exhibits", exhibitIds: [exhibit.id] }),
      countMembershipsByExhibit({ tableName: "media_asset_exhibits", exhibitIds: [exhibit.id] }),
    ]);

    return res.json({
      ...serializeExhibit(exhibit),
      pieceCount: pieceCounts.get(exhibit.id) ?? 0,
      imageCount: imageCounts.get(exhibit.id) ?? 0,
    });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH /exhibits/:id — owner only.
router.patch("/exhibits/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const params = ExhibitIdParams.safeParse(req.params);
    if (!params.success) return res.status(404).json({ error: "Not found" });
    const body = UpdateExhibitBody.parse(req.body);

    const rows = await db
      .select()
      .from(exhibitsTable)
      .where(eq(exhibitsTable.id, params.data.id))
      .limit(1);
    const exhibit = rows[0];
    if (!exhibit) return res.status(404).json({ error: "Not found" });

    const updates: {
      name?: string;
      slug?: string;
      description?: string | null;
      artistStatement?: string | null;
      biography?: string | null;
      rows?: number;
      cols?: number;
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
      const desired = slugifyExhibitName(body.slug);
      if (desired !== exhibit.slug) {
        const clash = await db
          .select({ id: exhibitsTable.id })
          .from(exhibitsTable)
          .where(eq(exhibitsTable.slug, desired))
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
    if (Object.prototype.hasOwnProperty.call(body, "artistStatement")) {
      updates.artistStatement = body.artistStatement ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "biography")) {
      updates.biography = body.biography ?? null;
    }
    if (typeof body.rows === "number") {
      updates.rows = body.rows;
    }
    if (typeof body.cols === "number") {
      updates.cols = body.cols;
    }

    await db.update(exhibitsTable).set(updates).where(eq(exhibitsTable.id, exhibit.id));
    const reloaded = await db
      .select()
      .from(exhibitsTable)
      .where(eq(exhibitsTable.id, exhibit.id))
      .limit(1);
    return res.json(serializeExhibit(reloaded[0]!));
  } catch {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /exhibits/:id — owner only.
router.delete("/exhibits/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const params = ExhibitIdParams.safeParse(req.params);
    if (!params.success) return res.status(404).json({ error: "Not found" });

    const rows = await db
      .select({ id: exhibitsTable.id })
      .from(exhibitsTable)
      .where(eq(exhibitsTable.id, params.data.id))
      .limit(1);
    if (!rows[0]) return res.status(404).json({ error: "Not found" });

    await db.delete(exhibitsTable).where(eq(exhibitsTable.id, params.data.id));
    return res.status(204).send();
  } catch {
    return res.status(400).json({ error: "Invalid request" });
  }
});

// GET /exhibits/:slug/items — exhibit wall payload (public).
router.get("/exhibits/:slug/items", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").toLowerCase();
    if (!slug) return res.status(404).json({ error: "Not found" });

    const exhibitRows = await db
      .select()
      .from(exhibitsTable)
      .where(eq(exhibitsTable.slug, slug))
      .limit(1);
    const exhibit = exhibitRows[0];
    if (!exhibit) return res.status(404).json({ error: "Not found" });

    // Load art pieces assigned to this exhibit, ordered by join creation time.
    const pieceIds = await listOwnersForExhibit({
      tableName: "piece_exhibits",
      ownerColumn: "art_piece_id",
      exhibitId: exhibit.id,
    });

    const pieces: Array<{
      id: number;
      title: string;
      engine: string;
      thumbnailUrl: string | null;
      generatedCode: string;
      htmlCode: string | null;
      cssCode: string | null;
      description: string | null;
    }> = [];

    if (pieceIds.length > 0) {
      const artPieceRows = await db
        .select()
        .from(artPiecesTable)
        .where(inArray(artPiecesTable.id, pieceIds));

      const versionIds = artPieceRows
        .map((p) => p.currentVersionId)
        .filter((v): v is number => typeof v === "number" && v > 0);

      const versionRows =
        versionIds.length > 0
          ? await db
              .select()
              .from(artPieceVersionsTable)
              .where(inArray(artPieceVersionsTable.id, versionIds))
          : [];

      const versionMap = new Map(versionRows.map((v) => [v.id, v]));
      const pieceMap = new Map(artPieceRows.map((p) => [p.id, p]));

      for (const artPieceId of pieceIds) {
        const piece = pieceMap.get(artPieceId);
        if (!piece) continue;
        const version = piece.currentVersionId ? versionMap.get(piece.currentVersionId) : undefined;
        if (!version) continue;
        pieces.push({
          id: piece.id,
          title: piece.title,
          engine: piece.engine,
          thumbnailUrl: piece.thumbnailUrl ?? null,
          generatedCode: version.generatedCode,
          htmlCode: version.htmlCode ?? null,
          cssCode: version.cssCode ?? null,
          description: piece.prompt ?? null,
        });
      }
    }

    // Load images assigned to this exhibit, ordered by join creation time.
    const mediaIds = await listOwnersForExhibit({
      tableName: "media_asset_exhibits",
      ownerColumn: "media_asset_id",
      exhibitId: exhibit.id,
    });

    const images: Array<{
      id: number;
      url: string;
      filename: string;
      altText: string | null;
      title: string | null;
    }> = [];

    if (mediaIds.length > 0) {
      const mediaRows = await db
        .select()
        .from(mediaAssetsTable)
        .where(inArray(mediaAssetsTable.id, mediaIds));

      const mediaMap = new Map(mediaRows.map((m) => [m.id, m]));
      for (const mediaAssetId of mediaIds) {
        const asset = mediaMap.get(mediaAssetId);
        if (!asset) continue;
        images.push({
          id: asset.id,
          url: asset.url,
          filename: asset.filename,
          altText: asset.altText ?? null,
          title: asset.title ?? null,
        });
      }
    }

    return res.json({ pieces, images, rows: exhibit.rows ?? 1, cols: exhibit.cols ?? 1 });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

// PUT /art-pieces/:id/exhibits — replace piece's exhibit memberships (owner only).
router.put("/art-pieces/:id/exhibits", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) return res.status(404).json({ error: "Not found" });

    const body = SetExhibitMembershipsBody.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    const pieceRows = await db
      .select({ id: artPiecesTable.id })
      .from(artPiecesTable)
      .where(eq(artPiecesTable.id, params.data.id))
      .limit(1);
    if (!pieceRows[0]) return res.status(404).json({ error: "Not found" });

    const uniqueIds = Array.from(new Set(body.data.exhibitIds));

    if (uniqueIds.length > 0) {
      const foundExhibits = await db
        .select({ id: exhibitsTable.id })
        .from(exhibitsTable)
        .where(inArray(exhibitsTable.id, uniqueIds));
      if (foundExhibits.length !== uniqueIds.length) {
        return res.status(400).json({ error: "One or more exhibit IDs do not exist" });
      }
    }

    await replaceExhibitMemberships({
      tableName: "piece_exhibits",
      ownerColumn: "art_piece_id",
      ownerId: params.data.id,
      exhibitIds: uniqueIds,
    });

    return res.json({ exhibitIds: uniqueIds });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

// PUT /media/:fileName/exhibits — replace image's exhibit memberships (owner only).
router.put("/media/:fileName/exhibits", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const fileName = String(req.params.fileName || "");
    if (!fileName) return res.status(404).json({ error: "Not found" });

    const body = SetExhibitMembershipsBody.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    const assetRows = await db
      .select({ id: mediaAssetsTable.id })
      .from(mediaAssetsTable)
      .where(eq(mediaAssetsTable.filename, fileName))
      .limit(1);
    if (!assetRows[0]) return res.status(404).json({ error: "Not found" });

    const mediaAssetId = assetRows[0].id;
    const uniqueIds = Array.from(new Set(body.data.exhibitIds));

    if (uniqueIds.length > 0) {
      const foundExhibits = await db
        .select({ id: exhibitsTable.id })
        .from(exhibitsTable)
        .where(inArray(exhibitsTable.id, uniqueIds));
      if (foundExhibits.length !== uniqueIds.length) {
        return res.status(400).json({ error: "One or more exhibit IDs do not exist" });
      }
    }

    await replaceExhibitMemberships({
      tableName: "media_asset_exhibits",
      ownerColumn: "media_asset_id",
      ownerId: mediaAssetId,
      exhibitIds: uniqueIds,
    });

    return res.json({ exhibitIds: uniqueIds });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;

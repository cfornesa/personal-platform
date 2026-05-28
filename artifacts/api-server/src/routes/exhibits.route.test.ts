import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

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

type FakeUser = { id: string; role: "owner" | "reader"; status: "active" } | null;

const userHolder: { current: FakeUser } = { current: null };

vi.mock("../lib/current-user", () => ({
  loadCurrentUser: async () => ({
    session: userHolder.current ? { user: { id: userHolder.current.id } } : null,
    user: userHolder.current,
  }),
  loadAuthSession: async () =>
    userHolder.current ? { user: { id: userHolder.current.id } } : null,
}));

const { mysqlPool } = await import("@workspace/db");
const { default: mediaRouter } = await import("./media");
const { default: artPiecesRouter } = await import("./art-pieces");
const { default: exhibitsRouter } = await import("./exhibits");

const RUN_ID = randomUUID();
const OWNER_ID = `e2e-exhibits-owner-${RUN_ID}`;
const OWNER: FakeUser = { id: OWNER_ID, role: "owner", status: "active" };
const EXHIBIT_SLUG = `e2e-exhibit-${RUN_ID.slice(0, 8)}`;
const MEDIA_FILENAME = `e2e-exhibit-${RUN_ID.slice(0, 8)}.png`;
const MEDIA_URL = `/api/media/${MEDIA_FILENAME}`;

let server: Server;
let baseUrl: string;
let exhibitId = 0;
let mediaId = 0;
let pieceId = 0;
let versionId = 0;
let pieceJoinColumn = "exhibit_id";
let mediaJoinColumn = "exhibit_id";

async function detectJoinColumn(tableName: "piece_exhibits" | "media_asset_exhibits") {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME IN ('exhibit_id', 'gallery_id')
      ORDER BY FIELD(COLUMN_NAME, 'exhibit_id', 'gallery_id')
      LIMIT 1
    `,
    [tableName],
  );
  return String(rows[0]?.["COLUMN_NAME"] ?? "gallery_id");
}

beforeAll(async () => {
  pieceJoinColumn = await detectJoinColumn("piece_exhibits");
  mediaJoinColumn = await detectJoinColumn("media_asset_exhibits");

  const app: Express = express();
  app.use(express.json());
  app.use("/api", mediaRouter);
  app.use("/api", artPiecesRouter);
  app.use("/api", exhibitsRouter);
  await new Promise<void>((resolve) => {
    server = http.createServer(app).listen(0, "127.0.0.1", () => resolve());
  });
  const { address, port } = server.address() as AddressInfo;
  baseUrl = `http://${address}:${port}`;

  await mysqlPool.query(
    `
      INSERT INTO users (id, name, role, status, created_at, updated_at)
      VALUES (?, 'Exhibit Test Owner', 'owner', 'active', NOW(3), NOW(3))
    `,
    [OWNER_ID],
  );

  const [exhibitResult] = await mysqlPool.query<ResultSetHeader>(
    `
      INSERT INTO exhibits
        (slug, name, description, artist_statement, biography, \`rows\`, \`cols\`, created_at, updated_at)
      VALUES
        (?, 'Compatibility Exhibit', 'Bridge test', 'Statement', 'Biography', 1, 2, NOW(3), NOW(3))
    `,
    [EXHIBIT_SLUG],
  );
  exhibitId = exhibitResult.insertId;

  const [mediaResult] = await mysqlPool.query<ResultSetHeader>(
    `
      INSERT INTO media_assets
        (url, filename, title, mime_type, alt_text, uploaded_at, file_data)
      VALUES
        (?, ?, 'Compatibility Image', 'image/png', 'Alt text', NOW(3), ?)
    `,
    [MEDIA_URL, MEDIA_FILENAME, Buffer.from("png")],
  );
  mediaId = mediaResult.insertId;

  const [pieceResult] = await mysqlPool.query<ResultSetHeader>(
    `
      INSERT INTO art_pieces
        (owner_user_id, title, prompt, engine, status, thumbnail_url, description, created_at, updated_at)
      VALUES
        (?, 'Compatibility Piece', 'Main exhibit description', 'p5', 'active', NULL, 'Dormant optional description', NOW(3), NOW(3))
    `,
    [OWNER_ID],
  );
  pieceId = pieceResult.insertId;

  const [versionResult] = await mysqlPool.query<ResultSetHeader>(
    `
      INSERT INTO art_piece_versions
        (art_piece_id, prompt, html_code, css_code, generated_code, engine, validation_status, generation_attempt_count, created_at)
      VALUES
        (?, 'Prompt', '<div id="canvas-container"></div>', 'body{margin:0;}', 'window.sketch = () => {};', 'p5', 'validated', 1, NOW(3))
    `,
    [pieceId],
  );
  versionId = versionResult.insertId;

  await mysqlPool.query(
    `UPDATE art_pieces SET current_version_id = ? WHERE id = ?`,
    [versionId, pieceId],
  );

  await mysqlPool.query(
    `INSERT INTO piece_exhibits (\`${pieceJoinColumn}\`, art_piece_id, created_at) VALUES (?, ?, NOW(3))`,
    [exhibitId, pieceId],
  );
  await mysqlPool.query(
    `INSERT INTO media_asset_exhibits (\`${mediaJoinColumn}\`, media_asset_id, created_at) VALUES (?, ?, NOW(3))`,
    [exhibitId, mediaId],
  );
}, 30_000);

afterAll(async () => {
  try {
    await mysqlPool.query(`DELETE FROM piece_exhibits WHERE art_piece_id = ?`, [pieceId]);
  } catch {}
  try {
    await mysqlPool.query(`DELETE FROM media_asset_exhibits WHERE media_asset_id = ?`, [mediaId]);
  } catch {}
  try {
    await mysqlPool.query(`DELETE FROM art_piece_versions WHERE id = ?`, [versionId]);
  } catch {}
  try {
    await mysqlPool.query(`DELETE FROM art_pieces WHERE id = ?`, [pieceId]);
  } catch {}
  try {
    await mysqlPool.query(`DELETE FROM media_assets WHERE id = ?`, [mediaId]);
  } catch {}
  try {
    await mysqlPool.query(`DELETE FROM exhibits WHERE id = ?`, [exhibitId]);
  } catch {}
  try {
    await mysqlPool.query(`DELETE FROM users WHERE id = ?`, [OWNER_ID]);
  } catch {}

  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
  await mysqlPool.end().catch(() => undefined);
}, 20_000);

describe("exhibit compatibility routes", () => {
  it("loads media and pieces with exhibitIds", async () => {
    userHolder.current = OWNER;

    const mediaRes = await fetch(`${baseUrl}/api/media`);
    expect(mediaRes.status).toBe(200);
    const mediaBody = (await mediaRes.json()) as Array<{ id: number; exhibitIds: number[] }>;
    const media = mediaBody.find((asset) => asset.id === mediaId);
    expect(media?.exhibitIds).toContain(exhibitId);

    const piecesRes = await fetch(`${baseUrl}/api/art-pieces`);
    expect(piecesRes.status).toBe(200);
    const piecesBody = (await piecesRes.json()) as { pieces: Array<{ id: number; exhibitIds: number[] }> };
    const piece = piecesBody.pieces.find((row) => row.id === pieceId);
    expect(piece?.exhibitIds).toContain(exhibitId);

    const pieceDetailRes = await fetch(`${baseUrl}/api/art-pieces/${pieceId}`);
    expect(pieceDetailRes.status).toBe(200);
    const pieceDetail = (await pieceDetailRes.json()) as { id: number; exhibitIds: number[] };
    expect(pieceDetail.id).toBe(pieceId);
    expect(pieceDetail.exhibitIds).toContain(exhibitId);
  });

  it("returns exhibit counts and exhibit wall items", async () => {
    const listRes = await fetch(`${baseUrl}/api/exhibits`);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      exhibits: Array<{ id: number; pieceCount: number; imageCount: number }>;
    };
    const exhibit = listBody.exhibits.find((row) => row.id === exhibitId);
    expect(exhibit?.pieceCount).toBe(1);
    expect(exhibit?.imageCount).toBe(1);

    const detailRes = await fetch(`${baseUrl}/api/exhibits/${EXHIBIT_SLUG}`);
    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as { pieceCount: number; imageCount: number };
    expect(detailBody.pieceCount).toBe(1);
    expect(detailBody.imageCount).toBe(1);

    const itemsRes = await fetch(`${baseUrl}/api/exhibits/${EXHIBIT_SLUG}/items`);
    expect(itemsRes.status).toBe(200);
    const itemsBody = (await itemsRes.json()) as {
      pieces: Array<{ id: number; description: string | null; title: string; engine: string }>;
      images: Array<{ id: number; altText: string | null; title: string | null; filename: string }>;
    };
    const piece = itemsBody.pieces.find((row) => row.id === pieceId);
    const image = itemsBody.images.find((row) => row.id === mediaId);
    expect(piece).toMatchObject({
      id: pieceId,
      title: "Compatibility Piece",
      engine: "p5",
      description: "Main exhibit description",
    });
    expect(image).toMatchObject({
      id: mediaId,
      title: "Compatibility Image",
      filename: MEDIA_FILENAME,
      altText: "Alt text",
    });
  });

  it("replaces exhibit memberships for pieces and media", async () => {
    userHolder.current = OWNER;

    const piecePut = await fetch(`${baseUrl}/api/art-pieces/${pieceId}/exhibits`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exhibitIds: [] }),
    });
    expect(piecePut.status).toBe(200);
    expect(await piecePut.json()).toEqual({ exhibitIds: [] });

    const mediaPut = await fetch(`${baseUrl}/api/media/${MEDIA_FILENAME}/exhibits`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exhibitIds: [] }),
    });
    expect(mediaPut.status).toBe(200);
    expect(await mediaPut.json()).toEqual({ exhibitIds: [] });

    const pieceRestore = await fetch(`${baseUrl}/api/art-pieces/${pieceId}/exhibits`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exhibitIds: [exhibitId] }),
    });
    expect(pieceRestore.status).toBe(200);

    const mediaRestore = await fetch(`${baseUrl}/api/media/${MEDIA_FILENAME}/exhibits`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exhibitIds: [exhibitId] }),
    });
    expect(mediaRestore.status).toBe(200);
  });
});

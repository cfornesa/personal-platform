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

type FakeUser = { id: string; role: "owner" | "member"; status: "active" } | null;

const userHolder: { current: FakeUser } = { current: null };

vi.mock("../lib/current-user", () => ({
  loadCurrentUser: async () => ({
    session: userHolder.current ? { user: { id: userHolder.current.id } } : null,
    user: userHolder.current,
  }),
  loadAuthSession: async () =>
    userHolder.current ? { user: { id: userHolder.current.id } } : null,
}));

const { ensureTables, mysqlPool } = await import("@workspace/db");
const { default: feedSourcesRouter } = await import("./feed-sources");

const RUN_ID = randomUUID();
const OWNER_ID = `e2e-feed-photo-owner-${RUN_ID}`;
const MEMBER_ID = `e2e-feed-photo-member-${RUN_ID}`;
const SEEDED_MEDIA_FILENAME = `e2e-feed-photo-${RUN_ID.slice(0, 8)}.png`;
const SEEDED_MEDIA_URL = `/api/media/${SEEDED_MEDIA_FILENAME}`;
const OLD_SOURCE_PHOTO = "/api/media/old-feed-photo.png";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

let server: Server;
let baseUrl: string;
let sourceId = 0;
const uploadedUrls: string[] = [];

function photoForm(buffer = png1x1, fileName = "feed-avatar.png") {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "image/png" }), fileName);
  return form;
}

async function countSourcePostsWithImage(imageUrl: string) {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM posts WHERE source_feed_id = ? AND author_image_url = ?`,
    [sourceId, imageUrl],
  );
  return Number(rows[0]?.count ?? 0);
}

beforeAll(async () => {
  await ensureTables();

  await mysqlPool.query(
    `
      INSERT INTO users (id, name, email, role, status, created_at, updated_at)
      VALUES
        (?, 'Feed Photo Owner', 'feed-photo-owner@example.com', 'owner', 'active', NOW(3), NOW(3)),
        (?, 'Feed Photo Member', 'feed-photo-member@example.com', 'member', 'active', NOW(3), NOW(3))
    `,
    [OWNER_ID, MEMBER_ID],
  );

  const [sourceResult] = await mysqlPool.query<ResultSetHeader>(
    `
      INSERT INTO feed_sources
        (name, feed_url, site_url, cadence, enabled, items_imported, created_at, updated_at)
      VALUES
        ('Feed Photo Source', ?, ?, 'daily', 1, 0, NOW(3), NOW(3))
    `,
    [`https://example.com/${RUN_ID}/feed.xml`, `https://example.com/${RUN_ID}`],
  );
  sourceId = sourceResult.insertId;

  await mysqlPool.query(
    `
      INSERT INTO media_assets (url, filename, title, mime_type, uploaded_at, file_data)
      VALUES (?, ?, 'Selectable feed photo', 'image/png', NOW(3), ?)
    `,
    [SEEDED_MEDIA_URL, SEEDED_MEDIA_FILENAME, png1x1],
  );

  await mysqlPool.query(
    `
      INSERT INTO posts
        (author_id, author_user_id, author_name, author_image_url, content, content_text, content_format, status, source_feed_id, created_at)
      VALUES
        (?, NULL, 'Feed Photo Source', ?, 'first imported post', 'first imported post', 'plain', 'published', ?, NOW(3)),
        (?, NULL, 'Feed Photo Source', ?, 'second imported post', 'second imported post', 'plain', 'pending', ?, NOW(3))
    `,
    [`feed:${sourceId}`, OLD_SOURCE_PHOTO, sourceId, `feed:${sourceId}`, OLD_SOURCE_PHOTO, sourceId],
  );

  const app: Express = express();
  app.use(express.json());
  app.use("/api", feedSourcesRouter);
  await new Promise<void>((resolve) => {
    server = http.createServer(app).listen(0, "127.0.0.1", () => resolve());
  });
  const { address, port } = server.address() as AddressInfo;
  baseUrl = `http://${address}:${port}`;
}, 30_000);

afterAll(async () => {
  await mysqlPool.query(`DELETE FROM posts WHERE source_feed_id = ?`, [sourceId]).catch(() => undefined);
  await mysqlPool.query(`DELETE FROM feed_sources WHERE id = ?`, [sourceId]).catch(() => undefined);
  if (uploadedUrls.length > 0) {
    await mysqlPool.query(
      `DELETE FROM media_assets WHERE url IN (${uploadedUrls.map(() => "?").join(",")})`,
      uploadedUrls,
    ).catch(() => undefined);
  }
  await mysqlPool.query(`DELETE FROM media_assets WHERE filename = ?`, [SEEDED_MEDIA_FILENAME]).catch(() => undefined);
  await mysqlPool.query(`DELETE FROM users WHERE id IN (?, ?)`, [OWNER_ID, MEMBER_ID]).catch(() => undefined);
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
  await mysqlPool.end().catch(() => undefined);
}, 30_000);

describe("feed source profile photos", () => {
  it("rejects non-owner library selection", async () => {
    userHolder.current = { id: MEMBER_ID, role: "member", status: "active" };

    const response = await fetch(`${baseUrl}/api/feed-sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: SEEDED_MEDIA_URL }),
    });

    expect(response.status).toBe(403);
  });

  it("lets the owner select an Image Library photo and cascades imported posts", async () => {
    userHolder.current = { id: OWNER_ID, role: "owner", status: "active" };

    const response = await fetch(`${baseUrl}/api/feed-sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: SEEDED_MEDIA_URL }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { imageUrl: string };
    expect(body.imageUrl).toBe(SEEDED_MEDIA_URL);
    expect(await countSourcePostsWithImage(SEEDED_MEDIA_URL)).toBe(2);
  });

  it("uploads a feed profile photo into the Image Library and cascades imported posts", async () => {
    userHolder.current = { id: OWNER_ID, role: "owner", status: "active" };

    const response = await fetch(`${baseUrl}/api/feed-sources/${sourceId}/profile-photo`, {
      method: "POST",
      body: photoForm(),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { imageUrl: string };
    expect(body.imageUrl).toMatch(/^\/api\/media\/.+\.png$/);
    uploadedUrls.push(body.imageUrl);

    const [mediaRows] = await mysqlPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM media_assets WHERE url = ?`,
      [body.imageUrl],
    );
    expect(Number(mediaRows[0]?.count ?? 0)).toBe(1);
    expect(await countSourcePostsWithImage(body.imageUrl)).toBe(2);
  });
});

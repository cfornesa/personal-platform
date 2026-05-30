import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";

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

type FakeUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "member";
  status: "active" | "blocked";
};

const userHolder: { current: FakeUser | null } = { current: null };

vi.mock("../lib/current-user", () => ({
  loadCurrentUser: async () => ({
    session: userHolder.current ? { user: { id: userHolder.current.id } } : null,
    user: userHolder.current,
  }),
  loadAuthSession: async () =>
    userHolder.current ? { user: { id: userHolder.current.id } } : null,
  invalidateUserCache: vi.fn(),
}));

const { ensureTables, mysqlPool } = await import("@workspace/db");
const { default: usersRouter } = await import("./users");

const RUN_ID = randomUUID();
const OWNER_ID = `e2e-photo-owner-${RUN_ID}`;
const MEMBER_ID = `e2e-photo-member-${RUN_ID}`;
const BLOCKED_ID = `e2e-photo-blocked-${RUN_ID}`;
const SEEDED_MEDIA_FILENAME = `e2e-profile-select-${RUN_ID.slice(0, 8)}.png`;
const SEEDED_MEDIA_URL = `/api/media/${SEEDED_MEDIA_FILENAME}`;
const OLD_PROFILE_URL = "/api/media/old-profile.png";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

let server: Server;
let baseUrl: string;
const ownerUploadedUrls: string[] = [];

function profileForm(buffer = png1x1, fileName = "avatar.png") {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "image/png" }), fileName);
  return form;
}

async function mediaAssetCount() {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM media_assets`);
  return Number(rows[0]?.count ?? 0);
}

beforeAll(async () => {
  await ensureTables();

  await mysqlPool.query(
    `
      INSERT INTO users (id, name, email, image, role, status, created_at, updated_at)
      VALUES
        (?, 'Photo Owner', 'photo-owner@example.com', NULL, 'owner', 'active', NOW(3), NOW(3)),
        (?, 'Photo Member', 'photo-member@example.com', NULL, 'member', 'active', NOW(3), NOW(3)),
        (?, 'Blocked Member', 'photo-blocked@example.com', NULL, 'member', 'blocked', NOW(3), NOW(3))
    `,
    [OWNER_ID, MEMBER_ID, BLOCKED_ID],
  );

  await mysqlPool.query(
    `
      INSERT INTO media_assets (url, filename, title, mime_type, uploaded_at, file_data)
      VALUES (?, ?, 'Selectable profile image', 'image/png', NOW(3), ?)
    `,
    [SEEDED_MEDIA_URL, SEEDED_MEDIA_FILENAME, png1x1],
  );

  await mysqlPool.query(
    `
      INSERT INTO posts
        (author_id, author_user_id, author_name, author_image_url, content, content_text, content_format, status, created_at)
      VALUES
        (?, ?, 'Photo Owner', ?, 'modern owner post', 'modern owner post', 'plain', 'published', NOW(3)),
        (?, NULL, 'Photo Owner', ?, 'legacy owner post', 'legacy owner post', 'plain', 'published', NOW(3))
    `,
    [OWNER_ID, OWNER_ID, OLD_PROFILE_URL, OWNER_ID, OLD_PROFILE_URL],
  );

  const app: Express = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  await new Promise<void>((resolve) => {
    server = http.createServer(app).listen(0, "127.0.0.1", () => resolve());
  });
  const { address, port } = server.address() as AddressInfo;
  baseUrl = `http://${address}:${port}`;
}, 30_000);

afterAll(async () => {
  await mysqlPool.query(`DELETE FROM profile_photo_assets WHERE user_id IN (?, ?, ?)`, [
    OWNER_ID,
    MEMBER_ID,
    BLOCKED_ID,
  ]).catch(() => undefined);
  await mysqlPool.query(`DELETE FROM posts WHERE author_id IN (?, ?, ?)`, [
    OWNER_ID,
    MEMBER_ID,
    BLOCKED_ID,
  ]).catch(() => undefined);
  if (ownerUploadedUrls.length > 0) {
    await mysqlPool.query(
      `DELETE FROM media_assets WHERE url IN (${ownerUploadedUrls.map(() => "?").join(",")})`,
      ownerUploadedUrls,
    ).catch(() => undefined);
  }
  await mysqlPool.query(`DELETE FROM media_assets WHERE filename = ?`, [
    SEEDED_MEDIA_FILENAME,
  ]).catch(() => undefined);
  await mysqlPool.query(`DELETE FROM users WHERE id IN (?, ?, ?)`, [
    OWNER_ID,
    MEMBER_ID,
    BLOCKED_ID,
  ]).catch(() => undefined);
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
  await mysqlPool.end().catch(() => undefined);
}, 30_000);

describe("profile photo upload route", () => {
  it("rejects anonymous uploads with 401", async () => {
    userHolder.current = null;
    const response = await fetch(`${baseUrl}/api/users/me/profile-photo`, {
      method: "POST",
      body: profileForm(),
    });

    expect(response.status).toBe(401);
  });

  it("rejects blocked users with 403", async () => {
    userHolder.current = {
      id: BLOCKED_ID,
      name: "Blocked Member",
      email: "photo-blocked@example.com",
      image: null,
      role: "member",
      status: "blocked",
    };
    const response = await fetch(`${baseUrl}/api/users/me/profile-photo`, {
      method: "POST",
      body: profileForm(),
    });

    expect(response.status).toBe(403);
  });

  it("stores member uploads as profile-only DB photos, not Image Library assets", async () => {
    userHolder.current = {
      id: MEMBER_ID,
      name: "Photo Member",
      email: "photo-member@example.com",
      image: null,
      role: "member",
      status: "active",
    };
    const beforeCount = await mediaAssetCount();

    const response = await fetch(`${baseUrl}/api/users/me/profile-photo`, {
      method: "POST",
      body: profileForm(),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { imageUrl: string };
    expect(body.imageUrl).toMatch(/^\/api\/profile-photos\/.+\.png$/);

    const [profileRows] = await mysqlPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM profile_photo_assets WHERE user_id = ?`,
      [MEMBER_ID],
    );
    expect(Number(profileRows[0]?.count ?? 0)).toBe(1);
    expect(await mediaAssetCount()).toBe(beforeCount);
  });

  it("rejects invalid image uploads", async () => {
    userHolder.current = {
      id: MEMBER_ID,
      name: "Photo Member",
      email: "photo-member@example.com",
      image: null,
      role: "member",
      status: "active",
    };
    const response = await fetch(`${baseUrl}/api/users/me/profile-photo`, {
      method: "POST",
      body: profileForm(Buffer.from("not an image"), "avatar.txt"),
    });

    expect(response.status).toBe(400);
  });

  it("stores owner uploads in the Image Library and sets the owner profile photo", async () => {
    userHolder.current = {
      id: OWNER_ID,
      name: "Photo Owner",
      email: "photo-owner@example.com",
      image: null,
      role: "owner",
      status: "active",
    };

    const response = await fetch(`${baseUrl}/api/users/me/profile-photo`, {
      method: "POST",
      body: profileForm(),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { imageUrl: string };
    expect(body.imageUrl).toMatch(/^\/api\/media\/.+\.png$/);
    ownerUploadedUrls.push(body.imageUrl);

    const [mediaRows] = await mysqlPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM media_assets WHERE url = ?`,
      [body.imageUrl],
    );
    expect(Number(mediaRows[0]?.count ?? 0)).toBe(1);
  });
});

describe("owner Image Library profile-photo selection", () => {
  it("lets the owner select an existing Image Library URL", async () => {
    userHolder.current = {
      id: OWNER_ID,
      name: "Photo Owner",
      email: "photo-owner@example.com",
      image: null,
      role: "owner",
      status: "active",
    };

    const response = await fetch(`${baseUrl}/api/users/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: SEEDED_MEDIA_URL }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { imageUrl: string };
    expect(body.imageUrl).toBe(SEEDED_MEDIA_URL);

    const [postRows] = await mysqlPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM posts WHERE author_id = ? AND author_image_url = ?`,
      [OWNER_ID, SEEDED_MEDIA_URL],
    );
    expect(Number(postRows[0]?.count ?? 0)).toBe(2);
  });

  it("rejects member Image Library selection", async () => {
    userHolder.current = {
      id: MEMBER_ID,
      name: "Photo Member",
      email: "photo-member@example.com",
      image: null,
      role: "member",
      status: "active",
    };

    const response = await fetch(`${baseUrl}/api/users/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: SEEDED_MEDIA_URL }),
    });

    expect(response.status).toBe(403);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { ResultSetHeader } from "mysql2/promise";

const { mysqlPool } = await import("@workspace/db");
const { default: feedsCatalogRouter } = await import("./feeds-catalog");

let server: Server;
let baseUrl: string;

const RUN_ID = randomUUID().slice(0, 8);
const CATEGORY_SLUG = `e2e-cat-cat-${RUN_ID}`;
const PAGE_SLUG = `e2e-cat-page-${RUN_ID}`;
let categoryId = 0;
let pageId = 0;

beforeAll(async () => {
  const app: Express = express();
  app.use("/api", feedsCatalogRouter);
  await new Promise<void>((resolve) => {
    server = http.createServer(app).listen(0, "127.0.0.1", () => resolve());
  });
  const { address, port } = server.address() as AddressInfo;
  baseUrl = `http://${address}:${port}`;

  const [resCat] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO categories (slug, name) VALUES (?, ?)`,
    [CATEGORY_SLUG, "Catalog Cat"],
  );
  categoryId = resCat.insertId;
  const [resPage] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO pages (slug, title, content, content_text, content_format, status, show_in_nav)
     VALUES (?, ?, '<p>x</p>', 'x', 'html', 'published', 0)`,
    [PAGE_SLUG, "Catalog Page"],
  );
  pageId = resPage.insertId;
}, 15_000);

afterAll(async () => {
  if (categoryId) {
    await mysqlPool.query(`DELETE FROM categories WHERE id = ?`, [categoryId]);
  }
  if (pageId) {
    await mysqlPool.query(`DELETE FROM pages WHERE id = ?`, [pageId]);
  }
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
  await mysqlPool.end().catch(() => undefined);
}, 15_000);

describe("feeds catalog", () => {
  it("returns Atom + JSON Feed + MF2 entries with absolute URLs and known mime types", async () => {
    const res = await fetch(`${baseUrl}/api/feeds`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      feeds: Array<{
        slug: string;
        title: string;
        description: string;
        url: string;
        mimeType: string;
      }>;
    };
    expect(Array.isArray(body.feeds)).toBe(true);
    const slugs = body.feeds.map((f) => f.slug);
    // The three site-wide feeds are always present (categories may add more).
    expect(slugs).toContain("atom");
    expect(slugs).toContain("json");
    expect(slugs).toContain("mf2");
    expect(body.feeds.length).toBeGreaterThanOrEqual(3);
    for (const f of body.feeds) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
      expect(f.url.startsWith("/") || /^https?:\/\//.test(f.url)).toBe(true);
    }
    expect(body.feeds.find((f) => f.slug === "atom")!.mimeType).toMatch(/atom\+xml/);
    expect(body.feeds.find((f) => f.slug === "json")!.mimeType).toMatch(/feed\+json/);
  });

  it("includes all categories' Atom + JSON feeds in the default response (no query params)", async () => {
    const res = await fetch(`${baseUrl}/api/feeds`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { feeds: Array<{ slug: string; url: string }> };
    const slugs = body.feeds.map((f) => f.slug);
    expect(slugs).toContain(`category-${CATEGORY_SLUG}-atom`);
    expect(slugs).toContain(`category-${CATEGORY_SLUG}-json`);
    const atom = body.feeds.find((f) => f.slug === `category-${CATEGORY_SLUG}-atom`)!;
    expect(atom.url).toContain(`/api/categories/${CATEGORY_SLUG}/feeds/atom`);
  });

  it("appends per-category Atom + JSON entries when ?category=<slug> resolves", async () => {
    const res = await fetch(`${baseUrl}/api/feeds?category=${CATEGORY_SLUG}`);
    const body = (await res.json()) as {
      feeds: Array<{ slug: string; url: string; mimeType: string }>;
    };
    const slugs = body.feeds.map((f) => f.slug);
    expect(slugs).toContain(`category-${CATEGORY_SLUG}-atom`);
    expect(slugs).toContain(`category-${CATEGORY_SLUG}-json`);
    const atom = body.feeds.find((f) => f.slug === `category-${CATEGORY_SLUG}-atom`)!;
    expect(atom.url).toContain(`/api/categories/${CATEGORY_SLUG}/feeds/atom`);
    expect(atom.mimeType).toMatch(/atom\+xml/);
  });

  it("appends per-page Atom + JSON entries when ?page=<slug> resolves a published page", async () => {
    const res = await fetch(`${baseUrl}/api/feeds?page=${PAGE_SLUG}`);
    const body = (await res.json()) as {
      feeds: Array<{ slug: string; url: string; mimeType: string }>;
    };
    const slugs = body.feeds.map((f) => f.slug);
    expect(slugs).toContain(`page-${PAGE_SLUG}-atom`);
    expect(slugs).toContain(`page-${PAGE_SLUG}-json`);
    const json = body.feeds.find((f) => f.slug === `page-${PAGE_SLUG}-json`)!;
    expect(json.url).toContain(`/api/p/${PAGE_SLUG}/feeds/json`);
    expect(json.mimeType).toMatch(/feed\+json/);
  });

  it("returns site-wide feeds plus all real categories; unknown page slug is silently ignored", async () => {
    const res = await fetch(`${baseUrl}/api/feeds?category=does-not-exist&page=does-not-exist`);
    const body = (await res.json()) as { feeds: Array<{ slug: string }> };
    const slugs = body.feeds.map((f) => f.slug);
    // The three site-wide feeds are always present.
    expect(slugs).toContain("atom");
    expect(slugs).toContain("json");
    expect(slugs).toContain("mf2");
    // The real test category is always included (always-on behavior).
    expect(slugs).toContain(`category-${CATEGORY_SLUG}-atom`);
    expect(slugs).toContain(`category-${CATEGORY_SLUG}-json`);
    // An unknown page slug produces no page feed entry.
    expect(slugs.some((s) => s.startsWith("page-does-not-exist"))).toBe(false);
  });
});

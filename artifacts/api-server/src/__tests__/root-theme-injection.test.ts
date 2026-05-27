import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod/v4";

/**
 * Integration test for the site-root theme-injection wired up in
 * `app.ts`. Confirms two things in tandem:
 *
 *   1. `GET /` and `GET /index.html` flow through `injectThemeData`,
 *      so the response body already contains
 *      `<style id="site-settings-theme">` and
 *      `<html ... data-theme="bauhaus">` before the bundle runs.
 *   2. Real static assets under `staticPath` (e.g. `/favicon.svg`)
 *      are still served untouched by `express.static`.
 */

const tmpStatic = fs.mkdtempSync(path.join(os.tmpdir(), "api-server-static-"));
const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Microblog</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
fs.writeFileSync(path.join(tmpStatic, "index.html"), indexHtml, "utf-8");
fs.writeFileSync(
  path.join(tmpStatic, "favicon.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
  "utf-8",
);

process.env.STATIC_FILES_PATH = tmpStatic;
// Disable rate limiting to keep the test deterministic.
process.env.NODE_ENV = "test";

// Mock `@workspace/db` BEFORE importing the app so the eager mysql
// pool initialization in the real module never runs. The shape mirrors
// just what app.ts + meta-injection.ts pull in at load time; route
// handlers we don't exercise here grab their own tables/helpers from
// the proxied default, which returns harmless stubs.
vi.mock("@workspace/db", () => {
  const tableStub = new Proxy({}, { get: () => ({ _: "col" }) });
  // Drizzle-style chain: every terminal returns an empty array so
  // `loadSettings()` falls through to `siteSettingsDefaults` and the
  // theme resolves to "bauhaus".
  const limit = vi.fn(async () => []);
  const where = vi.fn(() => ({ limit, then: (r: (v: unknown[]) => unknown) => r([]) }));
  const from = vi.fn(() => ({ where, limit }));
  const select = vi.fn(() => ({ from }));
  const db = { select, transaction: vi.fn() };
  const eq = vi.fn();
  const and = vi.fn();
  const stub = vi.fn();
  return {
    db,
    mysqlPool: { query: vi.fn(), getConnection: vi.fn() },
    siteSettingsDefaults: {
      theme: "bauhaus",
      palette: "bauhaus",
      colorBackground: "0 0% 100%",
      colorForeground: "0 0% 0%",
      colorBackgroundDark: "0 0% 0%",
      colorForegroundDark: "0 0% 100%",
      colorPrimary: "0 100% 50%",
      colorPrimaryForeground: "0 0% 100%",
      colorSecondary: "240 100% 50%",
      colorSecondaryForeground: "0 0% 100%",
      colorAccent: "0 0% 60%",
      colorAccentForeground: "0 0% 0%",
      colorMuted: "0 0% 95%",
      colorMutedForeground: "0 0% 40%",
      colorDestructive: "0 80% 50%",
      colorDestructiveForeground: "0 0% 100%",
      siteTitle: "Microblog",
    },
    isReservedSlug: () => false,
    ensureTables: vi.fn(),
    // Tables (anything destructured from @workspace/db across routes).
    postsTable: tableStub,
    commentsTable: tableStub,
    usersTable: tableStub,
    accountsTable: tableStub,
    sessionsTable: tableStub,
    verificationTokensTable: tableStub,
    reactionsTable: tableStub,
    siteSettingsTable: tableStub,
    feedSourcesTable: tableStub,
    feedItemsSeenTable: tableStub,
    categoriesTable: tableStub,
    postCategoriesTable: tableStub,
    navLinksTable: tableStub,
    pagesTable: tableStub,
    // Drizzle helpers — only `eq` and `and` are actually invoked at
    // module load (in route definitions); the rest are safe stubs.
    eq,
    and,
    or: stub,
    desc: stub,
    asc: stub,
    count: stub,
    sql: stub,
    like: stub,
    ne: stub,
    gt: stub,
    lt: stub,
    gte: stub,
    lte: stub,
    isNull: stub,
    isNotNull: stub,
    inArray: stub,
    notInArray: stub,
    // Schemas used by art-pieces route
    artPieceEngineSchema: z.enum(["p5", "c2", "three"]),
    artPieceStatusSchema: z.enum(["published", "pending", "draft", "scheduled"]),
    aiVendorSchema: z.enum([
      "openrouter",
      "opencode-zen",
      "opencode-go",
      "google",
      "mistral",
      "mistral-vibe",
      "deepseek",
    ]),
  };
});

// Drizzle adapter is invoked at module load by `auth/config.ts`.
vi.mock("@auth/drizzle-adapter", () => ({
  DrizzleAdapter: () => ({}),
}));

// `lib/og.ts` reads ttf font files synchronously at module load via
// `fs.readFileSync` — those assets aren't checked into the repo, so
// importing the route graph would crash. We don't exercise OG image
// generation here, so a stub is sufficient.
vi.mock("../lib/og", () => ({
  generatePostOgImage: vi.fn(),
}));

// `hydrateAuth` runs on every request and would otherwise call into
// Auth.js with our stubbed adapter, which throws `MissingAdapterMethods`
// — replace with a no-op so the request reaches the route handlers.
vi.mock("../middlewares/auth", () => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    hydrateAuth: passthrough,
    requireAuth: passthrough,
    requireOwner: passthrough,
  };
});

// `ExpressAuth` is mounted at `/api/auth` and configured at module load.
vi.mock("@auth/express", () => ({
  ExpressAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: app } = await import("../app");
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  fs.rmSync(tmpStatic, { recursive: true, force: true });
});

async function fetchText(pathname: string): Promise<{ status: number; body: string; contentType: string }> {
  const res = await fetch(`${baseUrl}${pathname}`);
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get("content-type") ?? "",
  };
}

describe("GET / and /index.html — root theme injection", () => {
  it("injects <style id=\"site-settings-theme\"> and data-theme on /", async () => {
    const res = await fetchText("/");
    expect(res.status).toBe(200);
    expect(res.body).toContain('<style id="site-settings-theme">');
    expect(res.body).toMatch(/<html[^>]*\sdata-theme="bauhaus"/);
  });

  it("injects the same payload on /index.html (not the raw static file)", async () => {
    const res = await fetchText("/index.html");
    expect(res.status).toBe(200);
    expect(res.body).toContain('<style id="site-settings-theme">');
    expect(res.body).toMatch(/<html[^>]*\sdata-theme="bauhaus"/);
  });
});

describe("static assets are still served by express.static", () => {
  it("serves /favicon.svg verbatim", async () => {
    const res = await fetchText("/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("image/svg");
    expect(res.body).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    // Theme-injection markers must NOT appear on a real static asset.
    expect(res.body).not.toContain("site-settings-theme");
    expect(res.body).not.toContain("data-theme=");
  });
});

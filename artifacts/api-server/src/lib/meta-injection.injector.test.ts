import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end coverage for `injectUserTheme()` itself (not just its
 * helpers). Exercises the three first-paint paths the catch-all HTML
 * route depends on for `/users/:handle`:
 *
 *   - unknown handle  → null (caller falls back to site theme)
 *   - known user, no customization → html WITHOUT user-scoped block
 *   - known user, with customization → html WITH both the scoped
 *     `<style>` and the `window.__USER_THEME_BOOTSTRAP__` script
 */

const HTML_FIXTURE = `<!DOCTYPE html><html><head><title>x</title></head><body><div id="root"></div></body></html>`;

type UserRow = {
  id: string | null;
  username: string | null;
  theme: string | null;
  palette: string | null;
  colorBackground: string | null;
  colorForeground: string | null;
  colorBackgroundDark: string | null;
  colorForegroundDark: string | null;
  colorPrimary: string | null;
  colorPrimaryForeground: string | null;
  colorSecondary: string | null;
  colorSecondaryForeground: string | null;
  colorAccent: string | null;
  colorAccentForeground: string | null;
  colorMuted: string | null;
  colorMutedForeground: string | null;
  colorDestructive: string | null;
  colorDestructiveForeground: string | null;
};

function emptyUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: null,
    username: null,
    theme: null,
    palette: null,
    colorBackground: null,
    colorForeground: null,
    colorBackgroundDark: null,
    colorForegroundDark: null,
    colorPrimary: null,
    colorPrimaryForeground: null,
    colorSecondary: null,
    colorSecondaryForeground: null,
    colorAccent: null,
    colorAccentForeground: null,
    colorMuted: null,
    colorMutedForeground: null,
    colorDestructive: null,
    colorDestructiveForeground: null,
    ...overrides,
  };
}

const dbState: { userByUsername: UserRow | null; userById: UserRow | null } = {
  userByUsername: null,
  userById: null,
};

function makeWhereChain(rows: UserRow[]) {
  return {
    limit: vi.fn(async () => rows),
  };
}

vi.mock("@workspace/db", () => {
  const usersTable = {
    id: { _: "id" },
    username: { _: "username" },
  };
  const siteSettingsTable = {};
  const postsTable = {};
  const siteSettingsDefaults = {
    theme: "minimalist",
    palette: "monochrome",
    siteTitle: "S",
    heroHeading: "H",
    heroSubheading: "S",
    aboutHeading: "A",
    aboutBody: "B",
    copyrightLine: "C",
    footerCredit: "F",
    ctaLabel: "L",
    ctaHref: "/",
    colorBackground: "0 0% 100%",
    colorForeground: "0 0% 0%",
    colorBackgroundDark: "0 0% 0%",
    colorForegroundDark: "0 0% 100%",
    colorPrimary: "0 0% 50%",
    colorPrimaryForeground: "0 0% 100%",
    colorSecondary: "0 0% 70%",
    colorSecondaryForeground: "0 0% 0%",
    colorAccent: "0 0% 60%",
    colorAccentForeground: "0 0% 0%",
    colorMuted: "0 0% 95%",
    colorMutedForeground: "0 0% 40%",
    colorDestructive: "0 80% 50%",
    colorDestructiveForeground: "0 0% 100%",
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn((clause: { __field?: string }) => {
          if (table === usersTable) {
            const field = clause.__field;
            if (field === "username") {
              return makeWhereChain(dbState.userByUsername ? [dbState.userByUsername] : []);
            }
            if (field === "id") {
              return makeWhereChain(dbState.userById ? [dbState.userById] : []);
            }
          }
          // Site-settings select: the injector calls `loadSettings`,
          // which selects from `siteSettingsTable` and falls back to
          // defaults when empty. Returning empty exercises the
          // defaults path so the test doesn't depend on a real row.
          return makeWhereChain([]);
        }),
      })),
    })),
  };

  // The injector calls `eq(usersTable.username, cleaned)` and
  // `eq(usersTable.id, cleaned)`. We tag the result with the field
  // name so the `where` mock above can route to the right user.
  const eq = vi.fn((field: { _: string }) => ({ __field: field._ }));

  return { db, usersTable, siteSettingsTable, postsTable, siteSettingsDefaults, eq };
});

let injectUserTheme: typeof import("./meta-injection").injectUserTheme;
let htmlPath: string;

beforeEach(async () => {
  // A fresh import each test isn't required; the mock state is reset
  // via `dbState` mutation below.
  ({ injectUserTheme } = await import("./meta-injection"));
  // Write the fixture to a real temp file because the injector reads
  // it via `fs.readFileSync`.
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  htmlPath = path.join(os.tmpdir(), `inject-test-${Date.now()}-${Math.random()}.html`);
  fs.writeFileSync(htmlPath, HTML_FIXTURE, "utf-8");

  dbState.userByUsername = null;
  dbState.userById = null;
});

afterEach(async () => {
  const fs = await import("node:fs");
  if (htmlPath) {
    try { fs.unlinkSync(htmlPath); } catch { /* ignore */ }
  }
});

describe("injectUserTheme — first-paint paths", () => {
  it("returns null for an unknown handle (caller falls back to site theme)", async () => {
    dbState.userByUsername = null;
    const result = await injectUserTheme({} as any, htmlPath, "@nobody");
    expect(result).toBeNull();
  });

  it("returns null for an empty handle", async () => {
    expect(await injectUserTheme({} as any, htmlPath, "")).toBeNull();
    expect(await injectUserTheme({} as any, htmlPath, "@")).toBeNull();
  });

  it("returns html WITHOUT a user-scoped block when the user has no customization", async () => {
    dbState.userByUsername = emptyUser({ id: "abc-123", username: "noah" });
    const result = await injectUserTheme({} as any, htmlPath, "@noah");
    expect(result).not.toBeNull();
    expect(result).not.toContain("user-theme-server-style");
    expect(result).not.toContain("user-theme-bootstrap");
    expect(result).not.toContain("__USER_THEME_BOOTSTRAP__");
    // Site theme still applies — the injector does call applyThemeToHtml.
    expect(result).toContain("<head>");
  });

  it("returns html WITH both the scoped <style> and the bootstrap <script> when the user has customization", async () => {
    dbState.userByUsername = emptyUser({
      id: "6953bb74-768e-4ee8-9159-464e3450e0a2",
      username: "fan",
      theme: "nature",
      colorBackground: "200 100% 90%",
      colorPrimary: "180 60% 40%",
    });
    const result = await injectUserTheme({} as any, htmlPath, "@fan");
    expect(result).not.toBeNull();
    // Site theme block is always present so navbar/footer keep matching
    // the rest of the site even on a per-user profile page.
    expect(result).toContain(`<style id="site-settings-theme">`);
    expect(result).toMatch(/<html[^>]*\sdata-theme="[a-z]+"/);
    // User-scoped theme block is emitted alongside the site theme,
    // targeting the `[data-user-theme-scope]` attribute selector.
    expect(result).toContain(`<style id="user-theme-server-style">`);
    expect(result).toContain(
      `[data-user-theme-scope="user-6953bb74-768e-4ee8-9159-464e3450e0a2"]`,
    );
    expect(result).toContain("--background: 200 100% 90%;");
    expect(result).toContain("--primary: 180 60% 40%;");
    expect(result).toContain(`<script id="user-theme-bootstrap">`);
    expect(result).toContain(
      `window.__USER_THEME_BOOTSTRAP__={"scopeKey":"user-6953bb74-768e-4ee8-9159-464e3450e0a2","theme":"nature"}`,
    );
  });

  it("looks the user up by id when the handle is a UUID", async () => {
    const id = "6953bb74-768e-4ee8-9159-464e3450e0a2";
    dbState.userById = emptyUser({
      id,
      username: "fan",
      theme: "nature",
      colorBackground: "200 100% 90%",
    });
    const result = await injectUserTheme({} as any, htmlPath, id);
    expect(result).not.toBeNull();
    // Both blocks ride along on the UUID path too — the lookup just
    // switches columns; the injection contract is identical.
    expect(result).toContain(`<style id="site-settings-theme">`);
    expect(result).toContain(`<style id="user-theme-server-style">`);
    expect(result).toContain(`[data-user-theme-scope="user-${id}"]`);
  });

  it("never themes the global :root scope (per-user CSS stays scoped)", async () => {
    dbState.userByUsername = emptyUser({
      id: "abc",
      username: "fan",
      theme: "nature",
      colorBackground: "200 100% 90%",
      colorPrimary: "180 60% 40%",
      colorBackgroundDark: "200 30% 10%",
    });
    const result = await injectUserTheme({} as any, htmlPath, "@fan");
    expect(result).not.toBeNull();
    // Carve out the SSR'd user-theme block and assert it never targets :root.
    const block = result!.match(
      /<style id="user-theme-server-style">([\s\S]*?)<\/style>/,
    );
    expect(block).not.toBeNull();
    expect(block![1]).not.toContain(":root");
  });
});

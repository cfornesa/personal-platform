import fs from "fs";
import { db, postsTable, categoriesTable, pagesTable, siteSettingsTable, usersTable, eq, and, siteSettingsDefaults } from "@workspace/db";

const _htmlCache = new Map<string, string>();
function readHtml(htmlPath: string): string {
  const cached = _htmlCache.get(htmlPath);
  if (cached !== undefined) return cached;
  const content = fs.readFileSync(htmlPath, "utf-8");
  _htmlCache.set(htmlPath, content);
  return content;
}

const KNOWN_THEMES = new Set([
  "bauhaus",
  "traditional",
  "minimalist",
  "academic",
  "airy",
  "nature",
  "comfort",
  "audacious",
  "artistic",
]);

/**
 * Strict HSL token format: `<h> <s>% <l>%`. Mirrors the OpenAPI pattern
 * applied to every color column in `UpdateUserProfileBody` (so the API
 * never accepts anything else) AND is enforced again here as
 * defense-in-depth: any value that doesn't match is dropped, never
 * interpolated into HTML.
 */
const HSL_PATTERN = /^[0-9]{1,3}(\.[0-9]+)? [0-9]{1,3}(\.[0-9]+)?% [0-9]{1,3}(\.[0-9]+)?%$/;

function safeHsl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > 32) return null;
  return HSL_PATTERN.test(value) ? value : null;
}

function safeThemeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return KNOWN_THEMES.has(value) ? value : null;
}

type PartialSettings = {
  theme?: string | null;
  colorBackground?: string | null;
  colorForeground?: string | null;
  colorBackgroundDark?: string | null;
  colorForegroundDark?: string | null;
  colorPrimary?: string | null;
  colorPrimaryForeground?: string | null;
  colorSecondary?: string | null;
  colorSecondaryForeground?: string | null;
  colorAccent?: string | null;
  colorAccentForeground?: string | null;
  colorMuted?: string | null;
  colorMutedForeground?: string | null;
  colorDestructive?: string | null;
  colorDestructiveForeground?: string | null;
  siteTitle?: string | null;
};

function buildThemeInjection(settings: PartialSettings): { themeId: string; css: string } {
  const merged = { ...siteSettingsDefaults, ...settings };
  // Validate every value before interpolating into the inline `<style>`.
  // Site defaults are trusted, but DB rows may contain anything.
  const v = (k: keyof PartialSettings): string => {
    const candidate = (merged as Record<string, unknown>)[k];
    if (typeof candidate === "string") {
      const safe = safeHsl(candidate);
      if (safe !== null) return safe;
    }
    const fallback = (siteSettingsDefaults as Record<string, unknown>)[k];
    return typeof fallback === "string" ? fallback : "0 0% 0%";
  };
  const themeId = safeThemeId(merged.theme) ?? "bauhaus";

  const css = `:root {
  --background: ${v("colorBackground")};
  --foreground: ${v("colorForeground")};
  --card: ${v("colorBackground")};
  --card-foreground: ${v("colorForeground")};
  --popover: ${v("colorBackground")};
  --popover-foreground: ${v("colorForeground")};
  --primary: ${v("colorPrimary")};
  --primary-foreground: ${v("colorPrimaryForeground")};
  --secondary: ${v("colorSecondary")};
  --secondary-foreground: ${v("colorSecondaryForeground")};
  --accent: ${v("colorAccent")};
  --accent-foreground: ${v("colorAccentForeground")};
  --muted: ${v("colorMuted")};
  --muted-foreground: ${v("colorMutedForeground")};
  --destructive: ${v("colorDestructive")};
  --destructive-foreground: ${v("colorDestructiveForeground")};
  --input: ${v("colorBackground")};
  --ring: ${v("colorSecondary")};
}
.dark {
  --background: ${v("colorBackgroundDark")};
  --foreground: ${v("colorForegroundDark")};
  --card: ${v("colorBackgroundDark")};
  --card-foreground: ${v("colorForegroundDark")};
  --popover: ${v("colorBackgroundDark")};
  --popover-foreground: ${v("colorForegroundDark")};
  --primary: ${v("colorPrimary")};
  --primary-foreground: ${v("colorPrimaryForeground")};
  --secondary: ${v("colorSecondary")};
  --secondary-foreground: ${v("colorSecondaryForeground")};
  --accent: ${v("colorAccent")};
  --accent-foreground: ${v("colorAccentForeground")};
  --muted: ${v("colorMuted")};
  --muted-foreground: ${v("colorMutedForeground")};
  --destructive: ${v("colorDestructive")};
  --destructive-foreground: ${v("colorDestructiveForeground")};
  --input: ${v("colorBackgroundDark")};
  --ring: ${v("colorSecondary")};
}`;

  return { themeId, css };
}

async function loadSettings(): Promise<PartialSettings> {
  try {
    const rows = await db
      .select()
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, 1))
      .limit(1);
    return rows[0] ?? {};
  } catch {
    return {};
  }
}

const FEED_ALTERNATE_LINKS =
  '<link rel="alternate" type="application/atom+xml" title="Atom feed" href="/feed.xml">\n' +
  '  <link rel="alternate" type="application/feed+json" title="JSON Feed" href="/feed.json">';

function applyThemeToHtml(html: string, themeId: string, css: string): string {
  html = html.replace(
    /(<html\b[^>]*?)(?:\s+data-theme="[^"]*")?(\s*>)/,
    `$1 data-theme="${themeId}"$2`,
  );
  const linkBlock = html.includes('rel="alternate" type="application/atom+xml"')
    ? ""
    : `  ${FEED_ALTERNATE_LINKS}\n`;
  html = html.replace(
    "</head>",
    `${linkBlock}  <style id="site-settings-theme">${css}</style>\n  </head>`,
  );
  return html;
}

export async function injectThemeData(htmlPath: string): Promise<string> {
  const html = readHtml(htmlPath);
  try {
    const settings = await loadSettings();
    const { themeId, css } = buildThemeInjection(settings);
    return applyThemeToHtml(html, themeId, css);
  } catch (err) {
    console.error("Theme injection failed:", err);
    return html;
  }
}

type UserThemeRow = {
  id?: string | null;
  theme?: string | null;
  colorBackground?: string | null;
  colorForeground?: string | null;
  colorBackgroundDark?: string | null;
  colorForegroundDark?: string | null;
  colorPrimary?: string | null;
  colorPrimaryForeground?: string | null;
  colorSecondary?: string | null;
  colorSecondaryForeground?: string | null;
  colorAccent?: string | null;
  colorAccentForeground?: string | null;
  colorMuted?: string | null;
  colorMutedForeground?: string | null;
  colorDestructive?: string | null;
  colorDestructiveForeground?: string | null;
};

const USER_COLOR_COLUMNS: Array<keyof UserThemeRow> = [
  "colorBackground",
  "colorForeground",
  "colorBackgroundDark",
  "colorForegroundDark",
  "colorPrimary",
  "colorPrimaryForeground",
  "colorSecondary",
  "colorSecondaryForeground",
  "colorAccent",
  "colorAccentForeground",
  "colorMuted",
  "colorMutedForeground",
  "colorDestructive",
  "colorDestructiveForeground",
];

/**
 * Build a `<style>` payload that overrides only the variables the user
 * has actually set, scoped to a stable attribute selector matching the
 * client-side `UserThemeScope` wrapper:
 *
 *     [data-user-theme-scope="user-<id>"]
 *
 * The wrapper renders inside the user-profile page only — never around
 * `#root` — so navbar and footer always keep the site theme. The `<id>`
 * portion of the selector is sanitized to `[a-zA-Z0-9_-]` (and is
 * normally a UUID anyway) so it cannot break out of the attribute value.
 *
 * Every interpolated color is validated against `HSL_PATTERN`; any
 * value that doesn't match is dropped, eliminating the stored-XSS risk
 * of embedding raw user-controlled strings into a `<style>` tag.
 */
export function buildUserThemeCss(user: UserThemeRow, scopeKey: string): string {
  const lightVars: string[] = [];
  const darkVars: string[] = [];
  const get = (k: keyof UserThemeRow): string | null => safeHsl(user[k]);

  const colorBackground = get("colorBackground");
  const colorForeground = get("colorForeground");
  const colorBackgroundDark = get("colorBackgroundDark");
  const colorForegroundDark = get("colorForegroundDark");
  const colorPrimary = get("colorPrimary");
  const colorPrimaryForeground = get("colorPrimaryForeground");
  const colorSecondary = get("colorSecondary");
  const colorSecondaryForeground = get("colorSecondaryForeground");
  const colorAccent = get("colorAccent");
  const colorAccentForeground = get("colorAccentForeground");
  const colorMuted = get("colorMuted");
  const colorMutedForeground = get("colorMutedForeground");
  const colorDestructive = get("colorDestructive");
  const colorDestructiveForeground = get("colorDestructiveForeground");

  if (colorBackground) {
    lightVars.push(`--background: ${colorBackground};`);
    lightVars.push(`--card: ${colorBackground};`);
    lightVars.push(`--popover: ${colorBackground};`);
    lightVars.push(`--input: ${colorBackground};`);
  }
  if (colorForeground) {
    lightVars.push(`--foreground: ${colorForeground};`);
    lightVars.push(`--card-foreground: ${colorForeground};`);
    lightVars.push(`--popover-foreground: ${colorForeground};`);
  }
  if (colorPrimary) lightVars.push(`--primary: ${colorPrimary};`);
  if (colorPrimaryForeground) lightVars.push(`--primary-foreground: ${colorPrimaryForeground};`);
  if (colorSecondary) {
    lightVars.push(`--secondary: ${colorSecondary};`);
    lightVars.push(`--ring: ${colorSecondary};`);
  }
  if (colorSecondaryForeground) lightVars.push(`--secondary-foreground: ${colorSecondaryForeground};`);
  if (colorAccent) lightVars.push(`--accent: ${colorAccent};`);
  if (colorAccentForeground) lightVars.push(`--accent-foreground: ${colorAccentForeground};`);
  if (colorMuted) lightVars.push(`--muted: ${colorMuted};`);
  if (colorMutedForeground) lightVars.push(`--muted-foreground: ${colorMutedForeground};`);
  if (colorDestructive) lightVars.push(`--destructive: ${colorDestructive};`);
  if (colorDestructiveForeground) lightVars.push(`--destructive-foreground: ${colorDestructiveForeground};`);

  if (colorBackgroundDark) {
    darkVars.push(`--background: ${colorBackgroundDark};`);
    darkVars.push(`--card: ${colorBackgroundDark};`);
    darkVars.push(`--popover: ${colorBackgroundDark};`);
    darkVars.push(`--input: ${colorBackgroundDark};`);
  }
  if (colorForegroundDark) {
    darkVars.push(`--foreground: ${colorForegroundDark};`);
    darkVars.push(`--card-foreground: ${colorForegroundDark};`);
    darkVars.push(`--popover-foreground: ${colorForegroundDark};`);
  }

  const selector = `[data-user-theme-scope="${scopeKey}"]`;
  let css = "";
  if (lightVars.length > 0) {
    css += `${selector} { ${lightVars.join(" ")} }`;
  }
  if (darkVars.length > 0) {
    css += ` .dark ${selector}, ${selector}.dark { ${darkVars.join(" ")} }`;
  }
  return css;
}

export function userHasCustomization(user: UserThemeRow): boolean {
  if (safeThemeId(user.theme) !== null) return true;
  for (const key of USER_COLOR_COLUMNS) {
    if (safeHsl(user[key]) !== null) return true;
  }
  return false;
}

/**
 * Sanitize a user id into a CSS-attribute-safe scope key. UUIDs pass
 * through unchanged; anything else has non-`[a-zA-Z0-9_-]` characters
 * stripped. Always prefixed with `user-` so the value is never empty.
 */
export function buildScopeKey(userId: string): string | null {
  if (typeof userId !== "string" || userId.length === 0) return null;
  const cleaned = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned.length > 0 ? `user-${cleaned}` : null;
}

/**
 * Inject a per-user theme block in addition to the site theme, for first
 * paint of `/users/:handle`. The site theme still owns `:root` (so navbar
 * and footer keep matching the rest of the site); the user theme is
 * scoped via the stable `[data-user-theme-scope="user-<id>"]` attribute
 * selector that the client-side `UserThemeScope` wrapper carries. As
 * soon as React mounts that wrapper inside the profile page the styles
 * apply with no flicker — and because the wrapper is rendered *inside*
 * the profile page (not around `#root`), navbar/footer stay site-themed.
 *
 * Returns null when no user is found (caller falls back to site theme).
 */
export async function injectUserTheme(
  htmlPath: string,
  handle: string,
): Promise<string | null> {
  try {
    if (!handle) return null;
    // Strip the `@` prefix from `/users/@handle`
    const cleaned = handle.startsWith("@") ? handle.slice(1) : handle;
    if (!cleaned) return null;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      cleaned,
    );

    const userRows = isUuid
      ? await db.select().from(usersTable).where(eq(usersTable.id, cleaned)).limit(1)
      : await db.select().from(usersTable).where(eq(usersTable.username, cleaned)).limit(1);

    const user = userRows[0] as UserThemeRow | undefined;
    if (!user) return null;

    const settings = await loadSettings();
    const { themeId, css } = buildThemeInjection(settings);
    let html = readHtml(htmlPath);
    html = applyThemeToHtml(html, themeId, css);

    if (userHasCustomization(user) && typeof user.id === "string") {
      const scopeKey = buildScopeKey(user.id);
      if (scopeKey) {
        const userCss = buildUserThemeCss(user, scopeKey);
        const safeTheme = safeThemeId(user.theme);

        // Stable first-paint hook. Two pieces:
        //
        //   1. The `<style>` block in `<head>` whose selector is
        //      `[data-user-theme-scope="<scopeKey>"]` — pre-loaded so it
        //      applies the moment a matching wrapper is in the DOM.
        //
        //   2. A small `<script>` that publishes the scope key + theme on
        //      `window.__USER_THEME_BOOTSTRAP__`. The React-rendered
        //      `<UserThemeScope>` reads it synchronously on its first
        //      render, so the wrapper exists with the right attributes
        //      from frame 1 — even before the React Query fetch for the
        //      user resolves. That means the head-injected styles match
        //      and apply on first paint, with no flicker.
        //
        //   Both `scopeKey` and `safeTheme` are validated/whitelisted
        //   above; we still use `JSON.stringify` to keep the script body
        //   safe even if the validators ever loosen.
        const bootstrap = JSON.stringify({
          scopeKey,
          theme: safeTheme,
        }).replace(/</g, "\\u003c");

        const styleBlock = userCss.length > 0
          ? `  <style id="user-theme-server-style">${userCss}</style>\n`
          : "";
        const scriptBlock = `  <script id="user-theme-bootstrap">window.__USER_THEME_BOOTSTRAP__=${bootstrap};</script>\n`;

        html = html.replace(
          "</head>",
          `${styleBlock}${scriptBlock}  </head>`,
        );
      }
    }

    return html;
  } catch (err) {
    console.error("User theme injection failed:", err);
    return null;
  }
}

/**
 * For `/categories/:slug` pages, expose the category-scoped Atom and
 * JSON feeds via `<link rel="alternate">` so feed readers and IndieWeb
 * tools can auto-discover them. Returns null when the slug doesn't
 * resolve, letting the caller fall back to the site-wide alternate
 * links injected by `injectThemeData`.
 */
export async function injectCategoryFeedLinks(
  htmlPath: string,
  rawSlug: string,
): Promise<string | null> {
  try {
    const slug = String(rawSlug ?? "").toLowerCase();
    if (!slug) return null;
    const rows = await db
      .select({ slug: categoriesTable.slug, name: categoriesTable.name })
      .from(categoriesTable)
      .where(eq(categoriesTable.slug, slug))
      .limit(1);
    const cat = rows[0];
    if (!cat) return null;

    const settings = await loadSettings();
    const { themeId, css } = buildThemeInjection(settings);
    let html = readHtml(htmlPath);
    html = applyThemeToHtml(html, themeId, css);

    const safeName = cat.name
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const base = `/categories/${cat.slug}`;
    const categoryAlternates =
      `  <link rel="alternate" type="application/atom+xml" data-scope="category" title="Atom feed — ${safeName}" href="${base}/feed.xml">\n` +
      `  <link rel="alternate" type="application/feed+json" data-scope="category" title="JSON Feed — ${safeName}" href="${base}/feed.json">\n`;
    html = html.replace("</head>", `${categoryAlternates}  </head>`);
    return html;
  } catch (err) {
    console.error("Category feed-link injection failed:", err);
    return null;
  }
}

/**
 * For published `/p/:slug` CMS pages, expose the page-scoped Atom and
 * JSON feeds via `<link rel="alternate">` so feed readers can pick up
 * a subscription target for the single page. Returns null when the
 * slug doesn't resolve to a published page.
 */
export async function injectPageFeedLinks(
  htmlPath: string,
  rawSlug: string,
): Promise<string | null> {
  try {
    const slug = String(rawSlug ?? "").toLowerCase();
    if (!slug) return null;
    const rows = await db
      .select({ slug: pagesTable.slug, title: pagesTable.title })
      .from(pagesTable)
      .where(and(eq(pagesTable.slug, slug), eq(pagesTable.status, "published")))
      .limit(1);
    const page = rows[0];
    if (!page) return null;

    const settings = await loadSettings();
    const { themeId, css } = buildThemeInjection(settings);
    let html = readHtml(htmlPath);
    html = applyThemeToHtml(html, themeId, css);

    const safeTitle = page.title
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const base = `/p/${page.slug}`;
    const pageAlternates =
      `  <link rel="alternate" type="application/atom+xml" data-scope="page" title="Atom feed — ${safeTitle}" href="${base}/feed.xml">\n` +
      `  <link rel="alternate" type="application/feed+json" data-scope="page" title="JSON Feed — ${safeTitle}" href="${base}/feed.json">\n`;
    html = html.replace("</head>", `${pageAlternates}  </head>`);
    return html;
  } catch (err) {
    console.error("Page feed-link injection failed:", err);
    return null;
  }
}

export async function injectPostMetadata(htmlPath: string, postId: string): Promise<string | null> {
  try {
    const id = parseInt(postId, 10);
    if (isNaN(id)) return null;

    const post = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!post[0]) return null;

    const settingsRows = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.id, 1)).limit(1);
    const settings: PartialSettings = settingsRows[0] ?? {};
    const siteTitle = settings.siteTitle ?? "Microblog";
    const siteUrl = process.env.PUBLIC_SITE_URL || "https://chrisfornesa.com";
    const authorName = post[0].authorName;
    const description = post[0].contentFormat === "html"
      ? post[0].content.replace(/<[^>]*>?/gm, "").substring(0, 200) + "..."
      : post[0].content.substring(0, 200) + (post[0].content.length > 200 ? "..." : "");

    const generatedOgImageUrl = `${siteUrl}/api/og/posts/${postId}`;
    const ogImageUrl = post[0].featuredImageUrl || generatedOgImageUrl;
    const postUrl = `${siteUrl}/posts/${postId}`;

    const metaTags = `
    <!-- Dynamic Social Metadata -->
    <title>Post by ${authorName} | ${siteTitle}</title>
    <meta name="description" content="${description}">
    <meta property="og:title" content="Post by ${authorName} | ${siteTitle}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${ogImageUrl}">
    <meta property="og:url" content="${postUrl}">
    <meta property="og:type" content="article">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Post by ${authorName}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${ogImageUrl}">
    `;

    let html = readHtml(htmlPath);

    const { themeId, css } = buildThemeInjection(settings);
    html = applyThemeToHtml(html, themeId, css);

    html = html.replace("</head>", `${metaTags}\n  </head>`);

    return html;
  } catch (err) {
    console.error("Meta injection failed:", err);
    return null;
  }
}

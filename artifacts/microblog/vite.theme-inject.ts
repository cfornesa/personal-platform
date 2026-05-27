import fs from "fs";
import type { Plugin } from "vite";

export interface ThemeInjectOptions {
  /** Absolute path to the dev `index.html` on disk. */
  indexPath: string;
  /**
   * Pure injector — same `injectThemeData` the api-server uses for
   * its catch-all HTML route. Passed in so this plugin module can be
   * imported and unit-tested without dragging in `@workspace/db` and
   * its eager mysql pool initialization.
   */
  injectThemeData: (req: any, htmlPath: string) => Promise<string>;
}

export interface RunThemeInjectionDeps {
  injectThemeData: (req: any, htmlPath: string) => Promise<string>;
  /**
   * Vite's `server.transformIndexHtml(url, html, originalUrl?)`.
   * Applies HMR/`@vitejs/plugin-react` transforms (the React refresh
   * preamble, `/@vite/client`, etc.) so the served HTML still wires
   * up the dev bundle correctly.
   */
  transformIndexHtml: (url: string, html: string) => Promise<string>;
}

/**
 * Core transform: read `index.html` from disk, inject the site theme
 * via the same helper the api-server uses, then run the result through
 * vite's `transformIndexHtml` so HMR and other vite plugins still
 * get to mutate the document. Exposed separately so tests can drive
 * it with stubs (no real vite server, no real db).
 *
 * If `injectThemeData` throws (typically a transient db outage), the
 * raw HTML on disk is used and the error is logged — vite stays up.
 */
export async function runThemeInjection(
  req: any,
  indexPath: string,
  url: string,
  deps: RunThemeInjectionDeps,
): Promise<string> {
  let injected: string;
  try {
    injected = await deps.injectThemeData(req, indexPath);
  } catch (err) {
    console.error("[vite-theme-inject] injectThemeData failed:", err);
    injected = fs.readFileSync(indexPath, "utf-8");
  }
  return deps.transformIndexHtml(url, injected);
}

/**
 * Vite dev plugin that mirrors the api-server's `injectThemeData`
 * pre-paint hook into the dev server. Without this, vite's built-in
 * index serving returns the raw `index.html` from disk and the browser
 * paints the bauhaus-white CSS defaults until `<ThemeInjector />` runs
 * after React mounts.
 *
 * `apply: 'serve'` keeps it out of the production build entirely — the
 * generated `dist/public/index.html` is unaffected.
 */
export default function viteThemeInject(opts: ThemeInjectOptions): Plugin {
  return {
    name: "theme-inject",
    apply: "serve",
    configureServer(server) {
      // Registering directly (no return) installs this BEFORE vite's
      // built-in indexHtmlMiddleware, so we get the chance to handle
      // navigations to `/` and other HTML routes ourselves.
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();

        const url = req.url ?? "/";
        // Don't touch vite internals or any path that's clearly
        // requesting a non-html asset.
        if (url.startsWith("/@") || url.startsWith("/__")) return next();
        const accept = String(req.headers["accept"] ?? "");
        const looksLikeHtml =
          accept.includes("text/html") ||
          url === "/" ||
          url.endsWith("/") ||
          url.endsWith(".html");
        if (!looksLikeHtml) return next();

        try {
          const html = await runThemeInjection(req, opts.indexPath, url, {
            injectThemeData: opts.injectThemeData,
            transformIndexHtml: (u, h) => server.transformIndexHtml(u, h),
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.end(html);
        } catch (err) {
          console.error("[vite-theme-inject] middleware error:", err);
          next();
        }
      });
    },
  };
}

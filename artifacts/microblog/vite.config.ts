import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import http from "http";
import https from "https";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import viteThemeInject from "./vite.theme-inject";
import { injectThemeData } from "../api-server/src/lib/meta-injection";

// Vite's built-in `server.proxy` regex keys (e.g. `^/categories/[^/]+/feed\.xml$`)
// are not reliably picked up against arbitrary URL shapes in this Vite version,
// causing per-category and per-page feed URLs to fall through to the SPA's
// htmlFallbackMiddleware (which serves index.html and renders NotFound).
// This plugin explicitly intercepts those URLs and forwards them to the API
// server. Production (api-server) already serves these routes directly via
// feedsRouter mounted before the SPA fallback in app.ts, so this plugin is
// dev-only.
function feedSubPathProxyPlugin(target: string): Plugin {
  const FEED_PATTERN =
    /^\/(?:categories|p)\/[^/]+\/feed\.(?:xml|json)(?:\?.*)?$/;
  return {
    name: "feed-subpath-proxy",
    apply: "serve",
    configureServer(server) {
      const targetUrl = new URL(target);
      const transport = targetUrl.protocol === "https:" ? https : http;
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!FEED_PATTERN.test(url)) return next();
        const method = req.method ?? "GET";
        const headers: Record<string, string | string[] | undefined> = {
          ...req.headers,
        };
        const upstream = transport.request(
          {
            protocol: targetUrl.protocol,
            hostname: targetUrl.hostname,
            port: targetUrl.port,
            method,
            path: url,
            headers,
          },
          (upRes) => {
            res.writeHead(upRes.statusCode ?? 502, upRes.headers);
            upRes.pipe(res);
          },
        );
        upstream.on("error", (err) => {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.end(`feed proxy error: ${err.message}`);
          } else {
            res.end();
          }
        });
        if (method === "GET" || method === "HEAD") {
          upstream.end();
        } else {
          req.pipe(upstream);
        }
      });
    },
  };
}

const rawPort = process.env.FRONTEND_PORT ?? "20925";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";
const apiOrigin =
  process.env.API_ORIGIN ?? `http://localhost:${process.env.API_PORT ?? "8080"}`;

export default defineConfig({
  base: basePath,
  envDir: path.resolve(import.meta.dirname, "..", ".."),
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    viteThemeInject({
      indexPath: path.resolve(import.meta.dirname, "index.html"),
      injectThemeData,
    }),
    feedSubPathProxyPlugin(apiOrigin),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: apiOrigin,
        changeOrigin: false,
      },
      "/embed/pieces/": {
        target: apiOrigin,
        changeOrigin: false,
      },
      "/feed.xml": {
        target: apiOrigin,
        changeOrigin: false,
      },
      "/feed.json": {
        target: apiOrigin,
        changeOrigin: false,
      },
      "/export.json": {
        target: apiOrigin,
        changeOrigin: false,
      },
      "/export/json": {
        target: apiOrigin,
        changeOrigin: false,
      },
      // Per-category and per-page feed URLs (e.g.
      // `/categories/:slug/feed.xml`, `/p/:slug/feed.json`) are
      // handled by `feedSubPathProxyPlugin` above instead of a
      // regex proxy entry — Vite's regex proxy keys did not match
      // those URLs reliably and let them fall through to the SPA.
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

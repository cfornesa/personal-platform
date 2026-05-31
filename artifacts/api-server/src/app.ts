import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { ExpressAuth } from "@auth/express";
import router from "./routes";
import feedsRouter from "./routes/feeds";
import pieceEmbedHtmlRouter from "./routes/piece-embed-html";
import { logger } from "./lib/logger";
import { authConfig } from "./auth/config";
import { hydrateAuth } from "./middlewares/auth";
import { createRateLimitMiddleware } from "./lib/ratelimit";
import {
  injectCategoryFeedLinks,
  injectPageFeedLinks,
  injectPostMetadata,
  injectThemeData,
  injectUserTheme,
} from "./lib/meta-injection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nmRoot = path.resolve(__dirname, "../../..", "node_modules");

const app: Express = express();
app.set("trust proxy", true);

// Serve art-piece library runtimes from node_modules. We use /api prefix to bypass
// Replit proxy interception of .js files on some environments.
const p5Path = fs.existsSync(path.join(nmRoot, "p5", "lib"))
  ? path.join(nmRoot, "p5", "lib")
  : path.resolve(__dirname, "../../..", "artifacts/microblog/node_modules/p5/lib");

const threePath = fs.existsSync(path.join(nmRoot, "three", "build"))
  ? path.join(nmRoot, "three", "build")
  : path.resolve(__dirname, "../../..", "artifacts/microblog/node_modules/three/build");

const threeExamplesPath = fs.existsSync(path.join(nmRoot, "three", "examples"))
  ? path.join(nmRoot, "three", "examples")
  : path.resolve(__dirname, "../../..", "artifacts/microblog/node_modules/three/examples");

const c2Path = fs.existsSync(path.join(nmRoot, "c2.js", "dist"))
  ? path.join(nmRoot, "c2.js", "dist")
  : path.resolve(__dirname, "../../..", "artifacts/microblog/node_modules/c2.js/dist");

app.use("/api/runtimes/p5", express.static(p5Path));
app.use("/api/runtimes/three", express.static(threePath));
app.use("/api/runtimes/three-examples", express.static(threeExamplesPath));
app.use("/api/runtimes/c2", express.static(c2Path));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : [];
const serverPort = process.env.PORT ?? "8080";
const allowedOrigins = new Set([
  ...configuredOrigins,
  `http://localhost:${serverPort}`,
  `http://127.0.0.1:${serverPort}`,
]);

app.use(
  (req, res, next) =>
    cors({
      credentials: true,
      origin: (origin, callback) => {
        if (!origin || isAllowedOrigin(origin, req)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
    })(req, res, next),
);

function isAllowedOrigin(origin: string, req: Request): boolean {
  if (allowedOrigins.has(origin)) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const requestHost = req.hostname;

    if (
      originUrl.hostname === requestHost &&
      (originUrl.hostname.endsWith(".replit.dev") ||
        originUrl.hostname.endsWith(".replit.app"))
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

app.use(createRateLimitMiddleware({ windowMs: 60_000, max: 240 }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(feedsRouter);
app.use(pieceEmbedHtmlRouter);
app.use("/api/auth", ExpressAuth(authConfig));

app.use(hydrateAuth);
app.use("/api", router);

const staticPath = process.env.STATIC_FILES_PATH
  ? path.resolve(process.env.STATIC_FILES_PATH)
  : path.resolve(__dirname, "..", "..", "microblog", "dist", "public");

if (fs.existsSync(staticPath)) {
  const indexPath = path.join(staticPath, "index.html");

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nAllow: /\n");
  });

  // Site root: register an explicit handler before `express.static` so
  // `GET /` and `GET /index.html` always run through `injectThemeData`
  // and arrive at the browser with `<style id="site-settings-theme">`
  // and `<html data-theme="...">` already in place. Without this,
  // `express.static` would serve the raw `index.html` from disk for
  // these routes (its default `index: "index.html"` for `/`, plus any
  // direct `/index.html` request as a regular static file), and the
  // browser would briefly paint the bauhaus-white defaults baked into
  // the bundle's CSS before React's `ThemeInjector` runs.
  app.get(["/", "/index.html"], async (req, res) => {
    const html = await injectThemeData(req, indexPath);
    res.send(html);
  });

  // Specific handler for posts to inject social metadata
  app.get(["/posts/:id", "/embed/posts/:id"], async (req, res, next) => {
    const id = req.params.id as string;
    if (id && id !== "index.html") {
      const html = await injectPostMetadata(req, indexPath, id);
      if (html) {
        res.send(html);
        return;
      }
    }
    next();
  });

  // CMS pages: expose the per-page Atom + JSON feeds via
  // `<link rel="alternate">`. Falls through to the site theme when the
  // slug doesn't resolve to a published page (so drafts and 404s keep
  // their normal behavior).
  app.get("/p/:slug", async (req, res, next) => {
    const slug = req.params.slug as string;
    if (slug && slug !== "index.html") {
      const html = await injectPageFeedLinks(req, indexPath, slug);
      if (html) {
        res.send(html);
        return;
      }
    }
    next();
  });

  // Category pages: expose the per-category Atom + JSON feeds via
  // `<link rel="alternate">` so feed readers can auto-discover them.
  app.get("/categories/:slug", async (req, res, next) => {
    const slug = req.params.slug as string;
    if (slug && slug !== "index.html") {
      const html = await injectCategoryFeedLinks(req, indexPath, slug);
      if (html) {
        res.send(html);
        return;
      }
    }
    next();
  });

  // Per-user profile pages: inject the user's theme alongside the site
  // theme so the profile content paints with the user's customization
  // before React hydrates. Falls through to the site theme on miss.
  app.get("/users/:handle", async (req, res, next) => {
    const handle = req.params.handle as string;
    if (handle && handle !== "index.html") {
      const html = await injectUserTheme(req, indexPath, handle);
      if (html) {
        res.send(html);
        return;
      }
    }
    next();
  });

  app.use(express.static(staticPath));
  app.use(async (req: Request, res: Response) => {
    const html = await injectThemeData(req, indexPath);
    res.send(html);
  });
} else {
  logger.warn(
    { staticPath },
    "Static files directory not found — frontend served separately (dev mode)",
  );
}

export default app;

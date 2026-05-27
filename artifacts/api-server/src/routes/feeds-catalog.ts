// Hand-maintained catalog of subscribable site feeds rendered at /feeds.
// All categories' Atom + JSON feeds are always included.
// `?page=<slug>` appends per-page feeds when it resolves to a published page.
// Feed content routes live here (under /api) so Replit's webview proxy
// forwards them to Express instead of serving the SPA.
import { Router, type IRouter, type Request, type Response } from "express";
import { db, categoriesTable, pagesTable, eq, and, asc } from "@workspace/db";
import {
  getOrigin,
  siteScope,
  categoryScope,
  loadPosts,
  buildAtom,
  buildJsonFeed,
  buildMf2Export,
  loadCategoryBySlug,
  loadPublishedPageBySlug,
  buildPageAtom,
  buildPageJsonFeed,
} from "./feeds";

const router: IRouter = Router();

const FEEDS = [
  {
    slug: "atom",
    title: "Atom feed",
    description:
      "All published posts in standard Atom 1.0 — paste this URL into any feed reader to subscribe.",
    path: "/api/feeds/atom",
    mimeType: "application/atom+xml",
  },
  {
    slug: "json",
    title: "JSON Feed",
    description:
      "Same posts as the Atom feed, in JSON Feed 1.1 format — handy for clients that prefer JSON.",
    path: "/api/feeds/json",
    mimeType: "application/feed+json",
  },
  {
    slug: "mf2",
    title: "Microformats2 export",
    description:
      "Full portable export with reactions, comments, and category metadata. Useful for backups and migrations.",
    path: "/api/feeds/mf2",
    mimeType: "application/mf2+json",
  },
] as const;

type FeedEntry = {
  slug: string;
  title: string;
  description: string;
  url: string;
  mimeType: string;
};

// --- Feed content routes (proxy-safe: all under /api) ---

router.get("/feeds/atom", async (req: Request, res: Response) => {
  try {
    const origin = getOrigin(req);
    const posts = await loadPosts();
    res.type("application/atom+xml; charset=utf-8");
    res.send(buildAtom(origin, siteScope(), posts));
  } catch {
    res.status(500).json({ error: "Failed to generate Atom feed" });
  }
});

router.get("/feeds/json", async (req: Request, res: Response) => {
  try {
    const origin = getOrigin(req);
    const posts = await loadPosts();
    res.type("application/feed+json; charset=utf-8");
    res.json(buildJsonFeed(origin, siteScope(), posts));
  } catch {
    res.status(500).json({ error: "Failed to generate JSON feed" });
  }
});

router.get("/feeds/mf2", async (req: Request, res: Response) => {
  try {
    const origin = getOrigin(req);
    const posts = await loadPosts();
    res.type("application/json; charset=utf-8");
    res.json(buildMf2Export(origin, posts));
  } catch {
    res.status(500).json({ error: "Failed to generate export" });
  }
});

router.get("/categories/:slug/feeds/atom", async (req: Request, res: Response) => {
  try {
    const cat = await loadCategoryBySlug(req.params.slug);
    if (!cat) return res.status(404).json({ error: "Not found" });
    const origin = getOrigin(req);
    const posts = await loadPosts({ categoryId: cat.id });
    res.type("application/atom+xml; charset=utf-8");
    return res.send(buildAtom(origin, categoryScope(cat), posts));
  } catch {
    return res.status(500).json({ error: "Failed to generate Atom feed" });
  }
});

router.get("/categories/:slug/feeds/json", async (req: Request, res: Response) => {
  try {
    const cat = await loadCategoryBySlug(req.params.slug);
    if (!cat) return res.status(404).json({ error: "Not found" });
    const origin = getOrigin(req);
    const posts = await loadPosts({ categoryId: cat.id });
    res.type("application/feed+json; charset=utf-8");
    return res.json(buildJsonFeed(origin, categoryScope(cat), posts));
  } catch {
    return res.status(500).json({ error: "Failed to generate JSON feed" });
  }
});

router.get("/p/:slug/feeds/atom", async (req: Request, res: Response) => {
  try {
    const page = await loadPublishedPageBySlug(req.params.slug);
    if (!page) return res.status(404).json({ error: "Not found" });
    const origin = getOrigin(req);
    res.type("application/atom+xml; charset=utf-8");
    return res.send(buildPageAtom(origin, page));
  } catch {
    return res.status(500).json({ error: "Failed to generate Atom feed" });
  }
});

router.get("/p/:slug/feeds/json", async (req: Request, res: Response) => {
  try {
    const page = await loadPublishedPageBySlug(req.params.slug);
    if (!page) return res.status(404).json({ error: "Not found" });
    const origin = getOrigin(req);
    res.type("application/feed+json; charset=utf-8");
    return res.json(buildPageJsonFeed(origin, page));
  } catch {
    return res.status(500).json({ error: "Failed to generate JSON feed" });
  }
});

// --- Feed catalog route ---

router.get("/feeds", async (req: Request, res: Response) => {
  const origin = getOrigin(req);
  const feeds: FeedEntry[] = FEEDS.map((feed) => ({
    slug: feed.slug,
    title: feed.title,
    description: feed.description,
    url: `${origin}${feed.path}`,
    mimeType: feed.mimeType,
  }));

  // Always include every category's Atom + JSON feeds so the /feeds
  // page shows them without the caller needing to know each slug.
  // The former ?category=<slug> param is now a no-op (kept for
  // backwards compatibility — existing callers still receive a valid response).
  try {
    const allCategories = await db
      .select({ slug: categoriesTable.slug, name: categoriesTable.name })
      .from(categoriesTable)
      .orderBy(asc(categoriesTable.name));
    for (const cat of allCategories) {
      feeds.push(
        {
          slug: `category-${cat.slug}-atom`,
          title: `Atom feed — ${cat.name}`,
          description: `Posts in the "${cat.name}" category, in Atom 1.0.`,
          url: `${origin}/api/categories/${cat.slug}/feeds/atom`,
          mimeType: "application/atom+xml",
        },
        {
          slug: `category-${cat.slug}-json`,
          title: `JSON Feed — ${cat.name}`,
          description: `Posts in the "${cat.name}" category, in JSON Feed 1.1.`,
          url: `${origin}/api/categories/${cat.slug}/feeds/json`,
          mimeType: "application/feed+json",
        },
      );
    }
  } catch {
    // Swallow DB errors — catalog still returns the site-wide feeds.
  }

  // Per-page feeds are contextual: only appended when a valid published
  // page slug is passed via `?page=<slug>`.
  const pageSlug =
    typeof req.query.page === "string" ? req.query.page.toLowerCase() : "";
  if (pageSlug) {
    try {
      const rows = await db
        .select({ slug: pagesTable.slug, title: pagesTable.title })
        .from(pagesTable)
        .where(and(eq(pagesTable.slug, pageSlug), eq(pagesTable.status, "published")))
        .limit(1);
      const page = rows[0];
      if (page) {
        const base = `/api/p/${page.slug}/feeds`;
        feeds.push(
          {
            slug: `page-${page.slug}-atom`,
            title: `Atom feed — ${page.title}`,
            description: `Updates to the "${page.title}" page, in Atom 1.0.`,
            url: `${origin}${base}/atom`,
            mimeType: "application/atom+xml",
          },
          {
            slug: `page-${page.slug}-json`,
            title: `JSON Feed — ${page.title}`,
            description: `Updates to the "${page.title}" page, in JSON Feed 1.1.`,
            url: `${origin}${base}/json`,
            mimeType: "application/feed+json",
          },
        );
      }
    } catch {
      // Swallow DB errors — catalog still returns the site-wide feeds.
    }
  }

  return res.json({ feeds });
});

export default router;

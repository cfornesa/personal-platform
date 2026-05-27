import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  postsTable,
  categoriesTable,
  postCategoriesTable,
  pagesTable,
  desc,
  eq,
  and,
} from "@workspace/db";
import { stripHtmlToText } from "../lib/html";
import { attachCategoriesToPosts, type HydratedCategory } from "../lib/post-categories";

import { getCanonicalOrigin } from "../lib/origin";

export type FeedPost = {
  id: number;
  authorName: string;
  title?: string | null;
  content: string;
  contentFormat: "plain" | "html";
  createdAt: string;
  categories: HydratedCategory[];
};

type FeedScope = {
  // Stable id for the feed (used as <id> / feed_url base).
  id: string;
  // Visible title.
  title: string;
  // Visible subtitle / description.
  description: string;
  // Origin-relative path to the Atom representation, e.g. `/feed.xml`
  // or `/categories/photos/feed.xml`.
  atomPath: string;
  // Origin-relative path to the JSON Feed representation.
  jsonPath: string;
  // Origin-relative URL the feed represents (HTML alternate link).
  alternatePath: string;
};

const router: IRouter = Router();

export function getOrigin(req: Request): string {
  return getCanonicalOrigin(req);
}

function getSiteTitle(): string {
  return process.env.SITE_TITLE?.trim() || "Microblog";
}

function getSiteDescription(): string {
  return (
    process.env.SITE_DESCRIPTION?.trim() ||
    "A personal microblog with rich posts, comments, and portable feed exports."
  );
}

function toVisibleText(post: FeedPost): string {
  if (post.contentFormat === "html") {
    return stripHtmlToText(post.content);
  }

  return post.content.replace(/\s+/g, " ").trim();
}

function summarize(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 50) {
    return normalized;
  }

  return `${normalized.slice(0, 50)}...`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value: string): string {
  return value.replace(/\]\]>/g, "]]]]><![CDATA[>");
}

function getCanonicalPostUrl(origin: string, postId: number): string {
  return `${origin}/posts/${postId}`;
}

function getAuthorName(posts: FeedPost[]): string {
  return process.env.SITE_AUTHOR_NAME?.trim() || posts[0]?.authorName || "Microblog Author";
}

export function siteScope(): FeedScope {
  return {
    id: "",
    title: getSiteTitle(),
    description: getSiteDescription(),
    atomPath: "/feed.xml",
    jsonPath: "/feed.json",
    alternatePath: "/",
  };
}

export function categoryScope(category: { slug: string; name: string; description: string | null }): FeedScope {
  const path = `/categories/${category.slug}`;
  return {
    id: path,
    title: `${getSiteTitle()} — ${category.name}`,
    description:
      category.description?.trim() ||
      `Posts in the “${category.name}” category.`,
    atomPath: `${path}/feed.xml`,
    jsonPath: `${path}/feed.json`,
    alternatePath: path,
  };
}

export async function loadPosts(opts: { categoryId?: number } = {}): Promise<FeedPost[]> {
  // Public feed exports (Atom, JSON Feed, MF2) must mirror the visible
  // timeline exactly — pending items in the moderation queue stay out
  // of every syndicated copy until the owner approves them.
  const baseSelect = {
    id: postsTable.id,
    authorName: postsTable.authorName,
    title: postsTable.title,
    content: postsTable.content,
    contentFormat: postsTable.contentFormat,
    createdAt: postsTable.createdAt,
  };

  const posts = opts.categoryId
    ? await db
        .select(baseSelect)
        .from(postsTable)
        .innerJoin(
          postCategoriesTable,
          eq(postCategoriesTable.postId, postsTable.id),
        )
        .where(
          and(
            eq(postsTable.status, "published"),
            eq(postCategoriesTable.categoryId, opts.categoryId),
          ),
        )
        .orderBy(desc(postsTable.createdAt))
    : await db
        .select(baseSelect)
        .from(postsTable)
        .where(eq(postsTable.status, "published"))
        .orderBy(desc(postsTable.createdAt));

  const hydrated = await attachCategoriesToPosts(posts);
  return hydrated as FeedPost[];
}

function normalizePieceUrlsInHtml(html: string, origin: string): string {
  if (!html.includes("/embed/pieces/") && !html.includes("/immersive/pieces/")) return html;

  // Convert root-relative piece URLs to absolute canonical URLs
  // Works for both src="/embed/pieces/1" and src="http://localhost:4000/embed/pieces/1"
  return html.replace(
    /src=["'](?:\/|https?:\/\/[^\/]+)?\/embed\/pieces\/(\d+)([^"']*)["']/g,
    (_, id, query) => `src="${origin}/embed/pieces/${id}${query}"`
  ).replace(
    /href=["'](?:\/|https?:\/\/[^\/]+)?\/immersive\/pieces\/(\d+)([^"']*)["']/g,
    (_, id, query) => `href="${origin}/immersive/pieces/${id}${query}"`
  );
}

export function buildAtom(origin: string, scope: FeedScope, posts: FeedPost[]): string {
  const authorName = getAuthorName(posts);
  const updatedAt = posts[0]?.createdAt ?? new Date().toISOString();
  const selfUrl = `${origin}${scope.atomPath}`;
  const alternateUrl = `${origin}${scope.alternatePath}`;
  const feedId = scope.id ? `${origin}${scope.id}` : origin;

  const entries = posts
    .map((post) => {
      const canonicalUrl = getCanonicalPostUrl(origin, post.id);
      const visibleText = toVisibleText(post);
      const summary = summarize(visibleText);
      const rawContentHtml =
        post.contentFormat === "html" ? post.content : `<p>${xmlEscape(post.content)}</p>`;
      const contentHtml = normalizePieceUrlsInHtml(rawContentHtml, origin);
      const categoryTags = post.categories
        .map(
          (c) =>
            `    <category term="${xmlEscape(c.slug)}" label="${xmlEscape(c.name)}" />`,
        )
        .join("\n");

      const feedTitle = post.title?.trim() || summary || `Post ${post.id}`;
      return `
  <entry>
    <id>${xmlEscape(canonicalUrl)}</id>
    <title>${xmlEscape(feedTitle)}</title>
    <link href="${xmlEscape(canonicalUrl)}" />
    <updated>${xmlEscape(post.createdAt)}</updated>
    <published>${xmlEscape(post.createdAt)}</published>
    <summary>${xmlEscape(summary)}</summary>
    <author><name>${xmlEscape(post.authorName || authorName)}</name></author>
${categoryTags ? `${categoryTags}\n` : ""}    <content type="html"><![CDATA[${cdata(contentHtml)}]]></content>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${xmlEscape(feedId)}</id>
  <title>${xmlEscape(scope.title)}</title>
  <subtitle>${xmlEscape(scope.description)}</subtitle>
  <updated>${xmlEscape(updatedAt)}</updated>
  <link rel="self" href="${xmlEscape(selfUrl)}" />
  <link rel="alternate" href="${xmlEscape(alternateUrl)}" />
  <author><name>${xmlEscape(authorName)}</name></author>
${entries}
</feed>`;
}

export function buildJsonFeed(origin: string, scope: FeedScope, posts: FeedPost[]) {
  const authorName = getAuthorName(posts);
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: scope.title,
    home_page_url: `${origin}${scope.alternatePath}`,
    feed_url: `${origin}${scope.jsonPath}`,
    description: scope.description,
    authors: [{ name: authorName }],
    items: posts.map((post) => {
      const canonicalUrl = getCanonicalPostUrl(origin, post.id);
      const visibleText = toVisibleText(post);
      const summary = summarize(visibleText);
      const rawContentHtml =
        post.contentFormat === "html" ? post.content : `<p>${xmlEscape(post.content)}</p>`;
      const contentHtml = normalizePieceUrlsInHtml(rawContentHtml, origin);

      const tags = post.categories.map((c) => c.name);
      return {
        id: canonicalUrl,
        url: canonicalUrl,
        title: post.title?.trim() || summary || `Post ${post.id}`,
        summary,
        content_html: contentHtml,
        content_text: visibleText,
        date_published: post.createdAt,
        ...(tags.length > 0 ? { tags } : {}),
      };
    }),
  };
}

router.get("/feed.xml", async (req: Request, res: Response) => {
  try {
    const origin = getOrigin(req);
    const posts = await loadPosts();
    res.type("application/atom+xml; charset=utf-8");
    res.send(buildAtom(origin, siteScope(), posts));
  } catch {
    res.status(500).json({ error: "Failed to generate Atom feed" });
  }
});

router.get("/atom", async (req: Request, res: Response) => {
  try {
    const origin = getOrigin(req);
    const posts = await loadPosts();
    res.type("application/atom+xml; charset=utf-8");
    res.send(buildAtom(origin, siteScope(), posts));
  } catch {
    res.status(500).json({ error: "Failed to generate Atom feed" });
  }
});

router.get("/feed.json", async (req: Request, res: Response) => {
  try {
    const origin = getOrigin(req);
    const posts = await loadPosts();
    res.type("application/feed+json; charset=utf-8");
    res.json(buildJsonFeed(origin, siteScope(), posts));
  } catch {
    res.status(500).json({ error: "Failed to generate JSON feed" });
  }
});

router.get("/jsonfeed", async (req: Request, res: Response) => {
  try {
    const origin = getOrigin(req);
    const posts = await loadPosts();
    res.type("application/feed+json; charset=utf-8");
    res.json(buildJsonFeed(origin, siteScope(), posts));
  } catch {
    res.status(500).json({ error: "Failed to generate JSON feed" });
  }
});

export async function loadCategoryBySlug(rawSlug: unknown) {
  const slug = String(rawSlug ?? "").toLowerCase();
  if (!slug) return null;
  const rows = await db
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

router.get("/categories/:slug/feed.xml", async (req: Request, res: Response) => {
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

router.get("/categories/:slug/atom", async (req: Request, res: Response) => {
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

router.get("/categories/:slug/feed.json", async (req: Request, res: Response) => {
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

router.get("/categories/:slug/jsonfeed", async (req: Request, res: Response) => {
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

// Per-page feeds — a single-entry Atom/JSON feed reflecting the
// page's current title, body, and updated_at. Useful for readers
// that want a notification when a long-lived CMS page changes.
export async function loadPublishedPageBySlug(rawSlug: unknown) {
  const slug = String(rawSlug ?? "").toLowerCase();
  if (!slug) return null;
  const rows = await db
    .select()
    .from(pagesTable)
    .where(eq(pagesTable.slug, slug))
    .limit(1);
  const page = rows[0];
  if (!page) return null;
  // Drafts and other non-published statuses stay out of public feeds
  // so unauthenticated readers can't subscribe to unpublished work.
  if (page.status !== "published") return null;
  return page;
}

export type PageRow = typeof pagesTable.$inferSelect;

function pageScope(page: PageRow): FeedScope {
  const path = `/p/${page.slug}`;
  return {
    id: path,
    title: `${getSiteTitle()} — ${page.title}`,
    description: `Updates to the “${page.title}” page.`,
    atomPath: `${path}/feed.xml`,
    jsonPath: `${path}/feed.json`,
    alternatePath: path,
  };
}

export function buildPageAtom(origin: string, page: PageRow): string {
  const scope = pageScope(page);
  const authorName = getAuthorName([]);
  const updatedAt = page.updatedAt;
  const selfUrl = `${origin}${scope.atomPath}`;
  const alternateUrl = `${origin}${scope.alternatePath}`;
  const feedId = `${origin}${scope.id}`;
  const visibleText =
    page.contentFormat === "html" ? stripHtmlToText(page.content) : page.content;
  const summary = summarize(visibleText);
  const contentHtml =
    page.contentFormat === "html" ? page.content : `<p>${xmlEscape(page.content)}</p>`;
  const entryId = `${origin}/p/${page.slug}`;

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${xmlEscape(feedId)}</id>
  <title>${xmlEscape(scope.title)}</title>
  <subtitle>${xmlEscape(scope.description)}</subtitle>
  <updated>${xmlEscape(updatedAt)}</updated>
  <link rel="self" href="${xmlEscape(selfUrl)}" />
  <link rel="alternate" href="${xmlEscape(alternateUrl)}" />
  <author><name>${xmlEscape(authorName)}</name></author>

  <entry>
    <id>${xmlEscape(entryId)}</id>
    <title>${xmlEscape(page.title)}</title>
    <link href="${xmlEscape(entryId)}" />
    <updated>${xmlEscape(page.updatedAt)}</updated>
    <published>${xmlEscape(page.createdAt)}</published>
    <summary>${xmlEscape(summary)}</summary>
    <author><name>${xmlEscape(authorName)}</name></author>
    <content type="html"><![CDATA[${cdata(contentHtml)}]]></content>
  </entry>
</feed>`;
}

export function buildPageJsonFeed(origin: string, page: PageRow) {
  const scope = pageScope(page);
  const authorName = getAuthorName([]);
  const visibleText =
    page.contentFormat === "html" ? stripHtmlToText(page.content) : page.content;
  const summary = summarize(visibleText);
  const contentHtml =
    page.contentFormat === "html" ? page.content : `<p>${xmlEscape(page.content)}</p>`;
  const entryUrl = `${origin}/p/${page.slug}`;
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: scope.title,
    home_page_url: `${origin}${scope.alternatePath}`,
    feed_url: `${origin}${scope.jsonPath}`,
    description: scope.description,
    authors: [{ name: authorName }],
    items: [
      {
        id: entryUrl,
        url: entryUrl,
        title: page.title,
        summary,
        content_html: contentHtml,
        content_text: visibleText,
        date_published: page.createdAt,
        date_modified: page.updatedAt,
      },
    ],
  };
}

router.get("/p/:slug/feed.xml", async (req: Request, res: Response) => {
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

router.get("/p/:slug/atom", async (req: Request, res: Response) => {
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

router.get("/p/:slug/feed.json", async (req: Request, res: Response) => {
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

router.get("/p/:slug/jsonfeed", async (req: Request, res: Response) => {
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


export function buildMf2Export(origin: string, posts: FeedPost[]) {
  const authorName = getAuthorName(posts);

  return {
    items: posts.map((post) => {
      const canonicalUrl = getCanonicalPostUrl(origin, post.id);
      const visibleText = toVisibleText(post);
      const summary = summarize(visibleText);
      const contentHtml =
        post.contentFormat === "html" ? post.content : `<p>${xmlEscape(post.content)}</p>`;

      const categoryNames = post.categories.map((c) => c.name);
      return {
        type: ["h-entry"],
        properties: {
          name: [summary || `Post ${post.id}`],
          content: [
            {
              html: contentHtml,
              value: visibleText,
            },
          ],
          url: [canonicalUrl],
          published: [post.createdAt],
          author: [
            {
              type: ["h-card"],
              properties: {
                name: [authorName],
                url: [origin],
              },
            },
          ],
          ...(categoryNames.length > 0 ? { category: categoryNames } : {}),
        },
      };
    }),
  };
}

router.get("/export/json", async (req: Request, res: Response) => {
  try {
    const origin = getOrigin(req);
    const posts = await loadPosts();
    res.type("application/json; charset=utf-8");
    res.json(buildMf2Export(origin, posts));
  } catch {
    res.status(500).json({ error: "Failed to generate export" });
  }
});

router.get("/export.json", async (req: Request, res: Response) => {
  try {
    const origin = getOrigin(req);
    const posts = await loadPosts();
    res.type("application/json; charset=utf-8");
    res.json(buildMf2Export(origin, posts));
  } catch {
    res.status(500).json({ error: "Failed to generate export" });
  }
});

export default router;

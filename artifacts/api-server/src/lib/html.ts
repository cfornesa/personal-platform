import sanitizeHtml, { type IFrame, type Tag } from "sanitize-html";
import { mysqlPool } from "@workspace/db";
import type { RowDataPacket } from "mysql2";
import { logger } from "./logger";

/**
 * Strip every tag/attribute and collapse whitespace down to single spaces.
 *
 * The single source of truth for the "what does the reader actually see in
 * this post body?" question. Used by:
 *   - Atom / JSON Feed exports (summary text)
 *   - The `posts.content_text` shadow column that backs FULLTEXT search
 *   - The feed-ingest path's pending-post normalization
 *
 * Same input must always yield the same output across all callers — that's
 * the invariant `posts.content` and `posts.content_text` rely on to never
 * drift. Don't fork this; extend it here.
 */
export function stripHtmlToText(value: string): string {
  const withoutTags = sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  });

  return withoutTags.replace(/\s+/g, " ").trim();
}

/**
 * Compute the `content_text` shadow value for a post. Plain-text posts
 * pass through with whitespace collapsed; HTML posts get tags stripped.
 *
 * Centralized so every write path (manual create/update + feed ingest)
 * derives `content_text` identically from `content`.
 */
export function computeContentText(
  content: string,
  contentFormat: "plain" | "html",
): string {
  if (contentFormat === "html") {
    return stripHtmlToText(content);
  }
  return content.replace(/\s+/g, " ").trim();
}

/**
 * Populate `posts.content_text` for any row that is still NULL.
 *
 * Runs once on API server startup right after `ensureTables`. Uses
 * the same `computeContentText` helper that every write path uses,
 * so legacy rows are stripped with identical sanitize-html semantics
 * to fresh inserts — there is no "SQL approximation" of the JS
 * stripper anywhere in the codebase.
 *
 * Idempotent: when the WHERE clause matches nothing the loop exits
 * immediately, so subsequent boots are essentially free.
 */
export async function backfillPostContentText(): Promise<void> {
  const BATCH = 100;
  let totalUpdated = 0;

  while (true) {
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      `SELECT id, content, content_format
         FROM posts
        WHERE content_text IS NULL
        LIMIT ?`,
      [BATCH],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const content = (row.content as string | null) ?? "";
      const format = row.content_format === "html" ? "html" : "plain";
      const text = computeContentText(content, format);
      await mysqlPool.query(
        `UPDATE posts SET content_text = ? WHERE id = ?`,
        [text, row.id],
      );
    }
    totalUpdated += rows.length;

    // A short batch means we drained the queue this iteration; no
    // need to issue another SELECT to discover that.
    if (rows.length < BATCH) break;
  }

  if (totalUpdated > 0) {
    logger.info(
      { rows: totalUpdated },
      "Backfilled posts.content_text for legacy rows",
    );
  }
}

function isAllowedHttpsUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isAllowedIframeSource(value: string) {
  if (value.startsWith("/embed/pieces/")) return true;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") {
      return true;
    }
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isAllowedImageSource(value: string) {
  return value.startsWith("/api/media/") || isAllowedHttpsUrl(value);
}

export function sanitizeRichHtml(input: string): string {
  const sanitized = sanitizeHtml(input, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "s",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "h2",
      "h3",
      "hr",
      "img",
      "figure",
      "figcaption",
      "code",
      "pre",
      "iframe",
      "div",
    ],
    allowedAttributes: {
      // `class` is allowed so IndieWeb microformats markup
      // (e.g. `u-syndication`, `u-url`, `h-cite`) survives the
      // sanitizer. The class attribute itself can't execute code; the
      // dangerous attributes are still filtered out below.
      a: ["href", "target", "rel", "title", "class"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      iframe: [
        "src",
        "width",
        "height",
        "allow",
        "allowfullscreen",
        "frameborder",
        "loading",
        "title",
        "aria-label",
        "referrerpolicy",
        "sandbox",
      ],
      div: ["style", "data-media-kind", "data-embed-kind"],
      p: ["style"],
      h2: ["style"],
      h3: ["style"],
      figure: ["data-media-kind"],
    },
    allowedSchemes: ["https"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        "text-align": [/^(left|center|right|justify)$/],
      },
    },
    transformTags: {
      a: (tagName: string, attribs: Tag["attribs"]) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
      iframe: (tagName: string, attribs: Tag["attribs"]) => ({
        tagName,
        attribs: {
          ...attribs,
          loading: attribs.loading || "lazy",
          frameborder: attribs.frameborder || "0",
        },
      }),
      img: (tagName: string, attribs: Tag["attribs"]) => ({
        tagName,
        attribs: {
          ...attribs,
          loading: attribs.loading || "lazy",
        },
      }),
    },
    exclusiveFilter(frame: IFrame) {
      if (frame.tag === "iframe") {
        return !frame.attribs.src || !isAllowedIframeSource(frame.attribs.src);
      }

      if (frame.tag === "img") {
        return !frame.attribs.src || !isAllowedImageSource(frame.attribs.src);
      }

      if (frame.tag === "a" && frame.attribs.href) {
        return !isAllowedHttpsUrl(frame.attribs.href);
      }

      return false;
    },
  }).trim();

  return sanitized === "" ? "<p></p>" : sanitized;
}

import crypto from "node:crypto";
import Parser from "rss-parser";
import { sanitizeRichHtml } from "./html";

export type RawFeedItem = {
  guid?: string;
  id?: string;
  link?: string;
  title?: string;
  isoDate?: string;
  pubDate?: string;
  contentEncoded?: string;
  "content:encoded"?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  author?: string;
  creator?: string;
  "dc:creator"?: string;
};

export type NormalizedItem = {
  guidHash: string;
  guid: string | null;
  canonicalUrl: string | null;
  title: string;
  originalAuthor: string | null;
  publishedAt: string;
  content: string;
  contentFormat: "plain" | "html";
};

const HASH_FALLBACK_DELIM = "\n";
const MAX_GUID_INPUT = 4096;
const MAX_AUTHOR_LENGTH = 255;

export function computeGuidHash(item: RawFeedItem): { hash: string; guid: string | null } {
  const explicit = (item.guid ?? item.id ?? "").trim();
  if (explicit && explicit.length <= MAX_GUID_INPUT) {
    return {
      hash: crypto.createHash("sha256").update(explicit).digest("hex"),
      guid: explicit,
    };
  }

  const fallbackInput = `${(item.link ?? "").trim()}${HASH_FALLBACK_DELIM}${(item.title ?? "").trim()}`;
  return {
    hash: crypto.createHash("sha256").update(fallbackInput).digest("hex"),
    guid: null,
  };
}

function pickRawBody(item: RawFeedItem): { raw: string | null; isHtml: boolean } {
  const html =
    item.contentEncoded ??
    item["content:encoded"] ??
    item.content ??
    item.summary ??
    "";
  if (html.trim().length > 0) {
    return { raw: html, isHtml: detectIsHtml(html) };
  }
  const snippet = (item.contentSnippet ?? "").trim();
  if (snippet.length > 0) {
    return { raw: snippet, isHtml: false };
  }
  return { raw: null, isHtml: false };
}

function detectIsHtml(value: string): boolean {
  return /<[a-z][\s\S]*?>/i.test(value);
}

function resolveRelativeSrcUrls(html: string, siteUrl: string): string {
  try {
    const origin = new URL(siteUrl).origin;
    // Rewrite root-relative src/href values (starting with /) to absolute URLs
    // so that piece iframes and images ingested from another site don't resolve
    // against the local origin when the post is rendered here.
    return html.replace(/\b(src|href)="(\/[^"]*)"/g, (_match, attr, path) => {
      return `${attr}="${origin}${path}"`;
    });
  } catch {
    return html;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function pickOriginalAuthor(item: RawFeedItem): string | null {
  const candidates = [item.creator, item["dc:creator"], item.author];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // RSS <author> per spec is "email (Name)" — prefer the parenthesized name.
    const parenMatch = trimmed.match(/\(([^)]+)\)\s*$/);
    const candidate = parenMatch ? parenMatch[1].trim() : trimmed;
    if (!candidate) continue;
    return candidate.slice(0, MAX_AUTHOR_LENGTH);
  }
  return null;
}

export function normalizeFeedItem(
  item: RawFeedItem,
  sourceName: string,
  sourceSiteUrl?: string | null,
): NormalizedItem {
  const { hash, guid } = computeGuidHash(item);
  const title = (item.title ?? "Untitled").trim() || "Untitled";
  const canonicalUrl =
    typeof item.link === "string" && item.link.trim().length > 0 ? item.link.trim() : null;
  const originalAuthor = pickOriginalAuthor(item);

  const isoCandidate = item.isoDate ?? item.pubDate ?? null;
  let publishedAt = new Date().toISOString();
  if (isoCandidate) {
    const parsed = new Date(isoCandidate);
    if (!Number.isNaN(parsed.getTime())) {
      publishedAt = parsed.toISOString();
    }
  }

  const { raw, isHtml } = pickRawBody(item);

  if (raw === null) {
    const titleBlock = `<h2>${escapeHtml(title)}</h2>`;
    const byline = originalAuthor
      ? `by <strong>${escapeHtml(originalAuthor)}</strong> · `
      : "";
    const attribution = canonicalUrl
      ? `<p><em>${byline}via <strong>${escapeHtml(sourceName)}</strong> — <a href="${escapeHtml(
          canonicalUrl,
        )}" class="u-url u-syndication" rel="noopener noreferrer nofollow" target="_blank">Read original</a></em></p>`
      : `<p><em>${byline}via <strong>${escapeHtml(sourceName)}</strong></em></p>`;
    const merged = `${titleBlock}\n<p><em>(No body in source feed.)</em></p>\n${attribution}`;
    return {
      guidHash: hash,
      guid,
      canonicalUrl,
      title,
      originalAuthor,
      publishedAt,
      content: sanitizeRichHtml(merged),
      contentFormat: "html",
    };
  }

  if (isHtml) {
    const titleBlock = `<h2>${escapeHtml(title)}</h2>`;
    const byline = originalAuthor
      ? `by <strong>${escapeHtml(originalAuthor)}</strong> · `
      : "";
    const attribution = canonicalUrl
      ? `<p><em>${byline}via <strong>${escapeHtml(sourceName)}</strong> — <a href="${escapeHtml(
          canonicalUrl,
        )}" class="u-url u-syndication" rel="noopener noreferrer nofollow" target="_blank">Read original</a></em></p>`
      : `<p><em>${byline}via <strong>${escapeHtml(sourceName)}</strong></em></p>`;

    // Resolve root-relative src/href attributes to absolute URLs so that piece
    // iframes copied from the source site don't resolve against this site's origin.
    const resolvedRaw = sourceSiteUrl ? resolveRelativeSrcUrls(raw, sourceSiteUrl) : raw;
    const merged = `${titleBlock}\n${resolvedRaw}\n${attribution}`;
    return {
      guidHash: hash,
      guid,
      canonicalUrl,
      title,
      originalAuthor,
      publishedAt,
      content: sanitizeRichHtml(merged),
      contentFormat: "html",
    };
  }

  const bylinePlain = originalAuthor ? `by ${originalAuthor} · ` : "";
  const attributionPlain = canonicalUrl
    ? `${bylinePlain}via ${sourceName} — ${canonicalUrl}`
    : `${bylinePlain}via ${sourceName}`;
  const plainBody = [title, "", raw.trim(), "", attributionPlain].join("\n");
  return {
    guidHash: hash,
    guid,
    canonicalUrl,
    title,
    originalAuthor,
    publishedAt,
    content: plainBody,
    contentFormat: "plain",
  };
}

export function cadenceIntervalMs(cadence: string): number {
  switch (cadence) {
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    case "monthly":
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

export function computeNextFetchAt(now: Date, cadence: string): string {
  return new Date(now.getTime() + cadenceIntervalMs(cadence)).toISOString();
}

export function isSourceDue(nextFetchAt: string | null, now: Date = new Date()): boolean {
  if (!nextFetchAt) return true;
  const next = new Date(nextFetchAt);
  if (Number.isNaN(next.getTime())) return true;
  return now.getTime() >= next.getTime();
}

export async function fetchFeed(feedUrl: string): Promise<RawFeedItem[]> {
  const parser = new Parser({
    timeout: 15_000,
    headers: {
      "User-Agent": "MicroblogFeedIngest/1.0",
      Accept: "application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    },
  });
  const parsed = await parser.parseURL(feedUrl);
  return (parsed.items ?? []) as RawFeedItem[];
}

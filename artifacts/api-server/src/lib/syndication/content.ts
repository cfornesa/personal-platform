import type { Post } from "@workspace/db";
import type { SyndicationPayload } from "./types";

const CHAR_LIMITS = { bluesky: 300, linkedin: 3000, facebook: 63206, instagram: 2200 } as const;
type SocialPlatform = keyof typeof CHAR_LIMITS;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function slugsToHashtags(slugs: string[]): string {
  return slugs.map((s) => `#${s.replace(/-/g, "")}`).join(" ");
}

export function buildSocialPostText(
  platform: SocialPlatform,
  post: Pick<Post, "title" | "content" | "contentFormat">,
  categorySlugs: string[],
  canonicalUrl: string,
): string {
  const limit = CHAR_LIMITS[platform];
  const plainBody = stripHtml(post.content);
  const hashtags = slugsToHashtags(categorySlugs);

  if (platform === "bluesky") {
    const urlPart = ` ${canonicalUrl}`;
    const hashtagPart = hashtags ? ` ${hashtags}` : "";
    const budget = limit - urlPart.length - hashtagPart.length - 1;
    let text = post.title?.trim() ? `${post.title.trim()}: ${plainBody}` : plainBody;
    if (text.length > budget) text = text.substring(0, budget - 1) + "…";
    return `${text}${hashtagPart}${urlPart}`;
  }

  if (platform === "linkedin") {
    const titlePart = post.title?.trim() ? `${post.title.trim()}\n\n` : "";
    const body = plainBody.length > limit ? plainBody.substring(0, limit - 1) + "…" : plainBody;
    return [titlePart + body, hashtags, canonicalUrl].filter(Boolean).join("\n\n");
  }

  if (platform === "instagram") {
    const titlePart = post.title?.trim() ? `${post.title.trim()}\n\n` : "";
    const urlPart = `\n\n${canonicalUrl}`;
    const hashtagPart = hashtags ? `\n\n${hashtags}` : "";
    const excerptBudget = limit - titlePart.length - urlPart.length - hashtagPart.length;
    const excerpt = plainBody.length > excerptBudget ? plainBody.substring(0, excerptBudget - 1) + "…" : plainBody;
    return `${titlePart}${excerpt}${hashtagPart}${urlPart}`.trim();
  }

  // facebook
  const titlePart = post.title?.trim() ? `${post.title.trim()}\n\n` : "";
  return [titlePart + plainBody, hashtags, canonicalUrl].filter(Boolean).join("\n\n");
}

export function buildPostExcerpt(html: string, limit = 180): string {
  const plainBody = stripHtml(html);
  if (plainBody.length <= limit) {
    return plainBody;
  }
  return `${plainBody.substring(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function ensureCanonicalUrl(
  text: string,
  canonicalUrl: string,
  platform: SocialPlatform,
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return canonicalUrl;
  }
  if (trimmed.includes(canonicalUrl)) {
    return trimmed;
  }

  const limit = CHAR_LIMITS[platform];
  const separator = platform === "bluesky" ? " " : "\n\n";
  const suffix = `${separator}${canonicalUrl}`;
  if (trimmed.length + suffix.length <= limit) {
    return `${trimmed}${suffix}`;
  }

  const budget = limit - suffix.length;
  if (budget <= 1) {
    return canonicalUrl.slice(0, limit);
  }
  return `${trimmed.substring(0, budget - 1).trimEnd()}…${suffix}`;
}

export function buildLinkCardMetadata(
  payload: Pick<SyndicationPayload, "title" | "contentHtml" | "canonicalUrl">,
): { source: string; title: string; description: string } {
  let fallbackTitle = "Original post";
  try {
    fallbackTitle = new URL(payload.canonicalUrl).host;
  } catch {
    // Keep the generic fallback when the URL cannot be parsed.
  }

  return {
    source: payload.canonicalUrl,
    title: payload.title.trim() || fallbackTitle,
    description: buildPostExcerpt(payload.contentHtml),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveSiteLabel(siteTitle: string | null | undefined, canonicalUrl: string): string {
  const trimmed = siteTitle?.trim();
  if (trimmed) return trimmed;

  try {
    return new URL(canonicalUrl).host;
  } catch {
    return canonicalUrl;
  }
}

export function buildSourceFooter(siteTitle: string | null | undefined, canonicalUrl: string): {
  html: string;
  text: string;
} {
  const label = resolveSiteLabel(siteTitle, canonicalUrl);
  const escapedLabel = escapeHtml(label);
  const escapedUrl = escapeHtml(canonicalUrl);

  return {
    html: `<p><em>Original source at ${escapedLabel}: <a href="${escapedUrl}" class="u-url" rel="noopener noreferrer nofollow" target="_blank">${escapedUrl}</a></em></p>`,
    text: `Original source at ${label}: ${canonicalUrl}`,
  };
}

export function buildSyndicatedContent(
  payload: Pick<SyndicationPayload, "contentHtml" | "contentFormat" | "sourceFooterHtml" | "sourceFooterText" | "featuredImageUrl">,
  options?: { prependFeaturedImage?: boolean },
): string {
  let body = replaceInteractivePieceIframes(payload.contentHtml).trimEnd();
  if (
    options?.prependFeaturedImage &&
    payload.featuredImageUrl &&
    payload.contentFormat === "html" &&
    !body.trimStart().startsWith(`<img src="${payload.featuredImageUrl}"`)
  ) {
    body = `<img src="${payload.featuredImageUrl}" alt="">\n${body}`;
  }
  if (payload.contentFormat === "html") {
    return `${body}\n${payload.sourceFooterHtml}`;
  }
  return `${body}\n\n${payload.sourceFooterText}`;
}

export function shouldAppendSourceFooter(post: Pick<Post, "sourceFeedId">): boolean {
  return post.sourceFeedId == null;
}

export function rewriteRelativeImageUrls(html: string, origin: string): string {
  return html.replace(
    /(<img\b[^>]*\ssrc=")(\/)([^"]*")/gi,
    (_match, prefix: string, _slash: string, rest: string) =>
      `${prefix}${origin}/${rest}`,
  );
}

function replaceInteractivePieceIframes(html: string): string {
  return html.replace(
    /<iframe\b[^>]*\bsrc="([^"]*\/embed\/pieces\/[^"]+)"[^>]*\btitle="([^"]*)"[^>]*><\/iframe>/gi,
    (_match, src: string, title: string) => {
      const safeTitle = escapeHtml(title || "Interactive piece");
      const safeSrc = escapeHtml(src);
      return `<p><em>${safeTitle}: <a href="${safeSrc}" class="u-url" rel="noopener noreferrer nofollow" target="_blank">${safeSrc}</a></em></p>`;
    },
  );
}

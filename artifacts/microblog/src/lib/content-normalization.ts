/**
 * True for hosts that are local-development placeholders (any port). URLs on
 * these hosts are what the canonical-origin rewrite is meant to fix — e.g. a
 * piece embed authored against `http://localhost:4000` that needs correcting
 * before it's published.
 */
function isLocalDevHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * Normalizes a single piece embed URL to be absolute using the canonical origin.
 *
 * Only rewrites the origin when the source URL is relative (definitely ours)
 * or points at a local-dev placeholder host. Absolute URLs on any other host
 * are left untouched — they're intentional references to a piece hosted on a
 * different site (e.g. cross-posted from another CreatrWeb instance), and
 * rewriting them would silently break the embed. See `extractPieceEmbedMeta`'s
 * `pieceOrigin` preservation for the same precedent.
 */
export function normalizePieceEmbedSrc(src: string, origin = window.location.origin) {
  const trimmed = src.trim();
  if (!trimmed) {
    return trimmed;
  }

  const isAbsolute = trimmed.startsWith("http://") || trimmed.startsWith("https://");

  try {
    const url = isAbsolute ? new URL(trimmed) : new URL(trimmed, window.location.origin);
    const match = url.pathname.match(/^\/embed\/pieces\/(\d+)$/);
    if (!match) {
      return trimmed;
    }
    if (isAbsolute && !isLocalDevHost(url.hostname)) {
      return trimmed;
    }
    // Preserve query parameters (e.g. ?version=...) and hash fragments.
    return `${origin}/embed/pieces/${match[1]}${url.search}${url.hash}`;
  } catch {
    const match = trimmed.match(/^(\/embed\/pieces\/\d+)(?:\?[^#]*)?(#.*)?$/);
    if (!match) {
      return trimmed;
    }
    return `${match[1]}${match[2] ?? ""}`;
  }
}

export function normalizeExhibitEmbedSrc(src: string, origin = window.location.origin) {
  const trimmed = src.trim();
  if (!trimmed) return trimmed;

  const isAbsolute = trimmed.startsWith("http://") || trimmed.startsWith("https://");

  try {
    const url = isAbsolute ? new URL(trimmed) : new URL(trimmed, window.location.origin);
    const match = url.pathname.match(/^\/immersive\/exhibits\/([^/]+)$/);
    if (!match) return trimmed;
    if (isAbsolute && !isLocalDevHost(url.hostname)) {
      return trimmed;
    }
    return `${origin}/immersive/exhibits/${match[1]}${url.search}${url.hash}`;
  } catch {
    return trimmed;
  }
}

/**
 * Scans HTML for iframe embeds and normalizes their src URLs.
 */
export function normalizePieceEmbedUrls(html: string, origin = window.location.origin) {
  if (!/<iframe\b/i.test(html)) {
    return html;
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  let mutated = false;
  document.querySelectorAll("iframe[src]").forEach((iframe) => {
    const currentSrc = iframe.getAttribute("src");
    if (!currentSrc) {
      return;
    }
    const normalizedPiece = normalizePieceEmbedSrc(currentSrc, origin);
    const normalizedSrc = normalizedPiece !== currentSrc
      ? normalizedPiece
      : normalizeExhibitEmbedSrc(currentSrc, origin);
    if (normalizedSrc !== currentSrc) {
      iframe.setAttribute("src", normalizedSrc);
      mutated = true;
    }
  });

  return mutated ? document.body.innerHTML : html;
}

/**
 * Ensures HTML content is wrapped in paragraphs and all piece URLs are normalized.
 */
export function ensureNormalizedParagraphHtml(html: string, origin = window.location.origin) {
  const trimmed = html.trim();
  if (trimmed === "") {
    return "<p></p>";
  }
  
  let processed = trimmed;
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    processed = normalizePieceEmbedUrls(trimmed, origin);
  } else {
    processed = normalizePieceEmbedUrls(
      trimmed
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
      .join(""),
      origin,
    );
  }
  
  return processed;
}

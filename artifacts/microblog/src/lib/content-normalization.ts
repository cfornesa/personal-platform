/**
 * Normalizes a single piece embed URL to be absolute using the canonical origin.
 */
export function normalizePieceEmbedSrc(src: string, origin = window.location.origin) {
  const trimmed = src.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const url = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? new URL(trimmed)
      : new URL(trimmed, window.location.origin);
    const match = url.pathname.match(/^\/embed\/pieces\/(\d+)$/);
    if (!match) {
      return trimmed;
    }
    // Always use the canonical origin for piece embeds to prevent
    // local development URLs from leaking into production content.
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
  try {
    const url = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? new URL(trimmed)
      : new URL(trimmed, window.location.origin);
    const match = url.pathname.match(/^\/immersive\/exhibits\/([^/]+)$/);
    if (!match) return trimmed;
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

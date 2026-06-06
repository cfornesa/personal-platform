export type ImmersiveImageMetadata = {
  alt?: string | null;
  title?: string | null;
  caption?: string | null;
};

const RESPONSIVE_EMBED_IFRAME_STYLE = "width:100%;aspect-ratio:16 / 9;display:block;";

const IMAGE_QUERY_KEYS = {
  alt: "alt",
  title: "title",
  caption: "caption",
} as const;

function base64UrlEncode(value: string) {
  if (typeof window === "undefined") {
    return Buffer.from(value, "utf-8").toString("base64url");
  }
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  if (typeof window === "undefined") {
    return Buffer.from(padded, "base64").toString("utf-8");
  }
  return atob(padded);
}

export function normalizeImmersiveImageRef(src: string, origin = window.location.origin) {
  try {
    const resolved = new URL(src, origin);
    if (resolved.origin === origin) {
      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    }
    return resolved.toString();
  } catch {
    return src;
  }
}

export function encodeImmersiveImageRef(src: string, origin = window.location.origin) {
  return base64UrlEncode(normalizeImmersiveImageRef(src, origin));
}

export function decodeImmersiveImageRef(ref: string) {
  return base64UrlDecode(ref);
}

export function resolveImmersiveImageSrc(ref: string, origin = window.location.origin) {
  const decoded = decodeImmersiveImageRef(ref);
  try {
    return new URL(decoded, origin).toString();
  } catch {
    return decoded;
  }
}

export function buildImmersiveImageHref(
  src: string,
  metadata: ImmersiveImageMetadata = {},
  origin = window.location.origin,
  postId?: number | null,
  returnTo?: string,
) {
  const href = new URL(`/immersive/images/${encodeImmersiveImageRef(src, origin)}`, origin);
  if (metadata.alt?.trim()) {
    href.searchParams.set(IMAGE_QUERY_KEYS.alt, metadata.alt.trim());
  }
  if (metadata.title?.trim()) {
    href.searchParams.set(IMAGE_QUERY_KEYS.title, metadata.title.trim());
  }
  if (metadata.caption?.trim()) {
    href.searchParams.set(IMAGE_QUERY_KEYS.caption, metadata.caption.trim());
  }
  if (returnTo && returnTo.startsWith("/")) {
    href.searchParams.set("returnTo", returnTo);
  } else if (postId && Number.isFinite(postId) && postId > 0) {
    href.searchParams.set("post", String(postId));
  }
  return `${href.pathname}${href.search}`;
}

export function readImmersiveImageMetadata(searchParams: URLSearchParams): ImmersiveImageMetadata {
  return {
    alt: searchParams.get(IMAGE_QUERY_KEYS.alt),
    title: searchParams.get(IMAGE_QUERY_KEYS.title),
    caption: searchParams.get(IMAGE_QUERY_KEYS.caption),
  };
}

export function buildImmersivePieceHref(
  id: number,
  versionId?: number | null,
  origin?: string,
  postId?: number | null,
  returnTo?: string,
) {
  const base = origin || window.location.origin;
  const href = new URL(`/immersive/pieces/${id}`, base);
  if (versionId && Number.isFinite(versionId) && versionId > 0) {
    href.searchParams.set("version", String(versionId));
  }
  // Return a full absolute URL when an origin is explicitly provided
  // to ensure links are robust when the HTML is moved to other sites
  // (e.g. syndication, copy-paste, external embeds).
  if (origin) {
    const isSameOrigin = typeof window !== "undefined" && href.origin === window.location.origin;
    if (isSameOrigin && returnTo && returnTo.startsWith("/")) {
      href.searchParams.set("returnTo", returnTo);
    } else if (postId && Number.isFinite(postId) && postId > 0) {
      href.searchParams.set("post", String(postId));
    }
    return href.toString();
  }
  if (returnTo && returnTo.startsWith("/")) {
    href.searchParams.set("returnTo", returnTo);
  } else if (postId && Number.isFinite(postId) && postId > 0) {
    href.searchParams.set("post", String(postId));
  }
  return `${href.pathname}${href.search}`;
}


export function buildPieceGalleryEmbedHtml(
  pieceId: number,
  versionId: number | null | undefined,
  title: string,
  origin = window.location.origin,
): string {
  const params = new URLSearchParams({ embed: "1" });
  if (versionId && Number.isFinite(versionId) && versionId > 0) {
    params.set("version", String(versionId));
  }
  const src = `${origin}/immersive/pieces/${pieceId}?${params}`;
  const safeTitle = title.replace(/"/g, "&quot;");
  return `<iframe src="${src}" width="100%" style="${RESPONSIVE_EMBED_IFRAME_STYLE}" title="${safeTitle}" frameborder="0" loading="lazy" allowfullscreen allow="fullscreen" sandbox="allow-scripts allow-same-origin"></iframe>`;
}

export function buildImageGalleryEmbedHtml(
  encodedRef: string,
  metadata: ImmersiveImageMetadata,
  origin = window.location.origin,
): string {
  const params = new URLSearchParams({ embed: "1" });
  if (metadata.alt?.trim()) params.set("alt", metadata.alt.trim());
  if (metadata.title?.trim()) params.set("title", metadata.title.trim());
  if (metadata.caption?.trim()) params.set("caption", metadata.caption.trim());
  const src = `${origin}/immersive/images/${encodedRef}?${params}`;
  const safeTitle = (metadata.title || metadata.alt || "Immersive image").replace(/"/g, "&quot;");
  return `<iframe src="${src}" width="100%" style="${RESPONSIVE_EMBED_IFRAME_STYLE}" title="${safeTitle}" frameborder="0" loading="lazy" allowfullscreen allow="fullscreen" sandbox="allow-scripts allow-same-origin"></iframe>`;
}

export function buildPlainImageEmbedHtml(
  imageSrc: string,
  alt?: string | null,
): string {
  const safeAlt = (alt ?? "").replace(/"/g, "&quot;");
  return `<img src="${imageSrc}" alt="${safeAlt}" style="max-width:100%;height:auto;display:block;" />`;
}

export function buildImmersiveExhibitHref(slug: string, origin?: string, postId?: number | null, returnTo?: string): string {
  const base = origin || window.location.origin;
  const href = new URL(`/immersive/exhibits/${slug}`, base);
  if (origin) {
    const isSameOrigin = typeof window !== "undefined" && href.origin === window.location.origin;
    if (isSameOrigin && returnTo && returnTo.startsWith("/")) {
      href.searchParams.set("returnTo", returnTo);
    } else if (postId && Number.isFinite(postId) && postId > 0) {
      href.searchParams.set("post", String(postId));
    }
    return href.toString();
  }
  if (returnTo && returnTo.startsWith("/")) {
    href.searchParams.set("returnTo", returnTo);
  } else if (postId && Number.isFinite(postId) && postId > 0) {
    href.searchParams.set("post", String(postId));
  }
  return `${href.pathname}${href.search}`;
}

export function buildExhibitGalleryEmbedHtml(
  slug: string,
  name: string,
  origin = window.location.origin,
): string {
  const src = `${origin}/immersive/exhibits/${slug}?embed=1`;
  const safeTitle = name.replace(/"/g, "&quot;");
  return `<iframe src="${src}" width="100%" style="${RESPONSIVE_EMBED_IFRAME_STYLE}" title="${safeTitle}" frameborder="0" loading="lazy" allowfullscreen allow="fullscreen" sandbox="allow-scripts allow-same-origin"></iframe>`;
}

export function extractPieceEmbedMeta(src: string, origin = window.location.origin) {
  try {
    const url = new URL(src, origin);
    if (!url.pathname.startsWith("/embed/pieces/")) {
      return null;
    }
    const id = Number(url.pathname.split("/").pop());
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }
    const versionRaw = url.searchParams.get("version");
    const versionId = versionRaw ? Number(versionRaw) : null;
    return {
      id,
      versionId: versionId && Number.isFinite(versionId) && versionId > 0 ? versionId : null,
      // Preserve the source origin so cross-posted VR links point back to the
      // site that owns the piece, not the current site.
      pieceOrigin: url.origin,
    };
  } catch {
    return null;
  }
}

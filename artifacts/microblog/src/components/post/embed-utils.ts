function normalizePieceEmbedSrc(src: string): string {
  try {
    const url = new URL(src, window.location.origin);
    if (url.pathname.startsWith("/embed/pieces/") || url.pathname.startsWith("/api/")) {
      const relative = url.pathname + url.search + url.hash;
      return relative;
    }
  } catch {
    // not a URL — return as-is
  }
  return src;
}

export function parseIframeEmbed(embedCode: string) {
  const document = new DOMParser().parseFromString(embedCode, "text/html");
  const iframe = document.querySelector("iframe");
  if (!iframe?.getAttribute("src")) {
    return null;
  }

  return {
    src: normalizePieceEmbedSrc(iframe.getAttribute("src") ?? ""),
    width: iframe.getAttribute("width") ?? "100%",
    height: iframe.getAttribute("height") ?? "420",
    title: iframe.getAttribute("title") ?? "Embedded content",
    allow: iframe.getAttribute("allow") ?? undefined,
    loading: iframe.getAttribute("loading") ?? "lazy",
    referrerpolicy: iframe.getAttribute("referrerpolicy") ?? undefined,
    sandbox: iframe.getAttribute("sandbox") ?? undefined,
    frameborder: iframe.getAttribute("frameborder") ?? "0",
    allowfullscreen: iframe.hasAttribute("allowfullscreen") ? "true" : undefined,
  };
}

export function parseYouTubeUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  let videoId = "";

  if (url.hostname === "youtu.be") {
    videoId = url.pathname.slice(1);
  } else if (url.hostname.endsWith("youtube.com")) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") ?? "";
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.split("/")[2] ?? "";
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/")[2] ?? "";
    } else if (url.pathname.startsWith("/live/")) {
      videoId = url.pathname.split("/")[2] ?? "";
    }
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  return {
    src: `https://www.youtube.com/embed/${videoId}`,
    width: "100%",
    height: "420",
    title: "YouTube video",
    allow:
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
    loading: "lazy",
    referrerpolicy: "strict-origin-when-cross-origin",
    frameborder: "0",
    allowfullscreen: "true" as const,
  };
}

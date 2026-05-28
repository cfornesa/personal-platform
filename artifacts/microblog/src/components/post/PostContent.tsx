import { memo, useMemo, type ReactNode } from "react";
import type { PostContentFormat } from "@workspace/api-client-react";
import {
  buildImmersiveImageHref,
  buildImmersivePieceHref,
  buildImmersiveExhibitHref,
  extractPieceEmbedMeta,
} from "@/lib/immersive-view";
import { useSiteSettings } from "@/hooks/use-site-settings";
import { normalizePieceEmbedUrls } from "@/lib/content-normalization";

type PostContentProps = {
  content: string;
  contentFormat: PostContentFormat;
  className?: string;
  /**
   * Optional whitespace-separated search query. When set, occurrences of
   * each token are wrapped in `<mark>` for visual emphasis only — the
   * underlying post HTML stored on the server is never modified.
   * Matching is case-insensitive and skips text inside `<script>`,
   * `<style>`, and existing `<mark>` nodes.
   */
  highlightQuery?: string | null;
};

function tokenizeQuery(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean);
}

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildHighlightRegex(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  // Sort longest-first so an alternation like /(java|javascript)/ doesn't
  // shadow the longer match inside the shorter one.
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  return new RegExp(`(${sorted.map(escapeRegex).join("|")})`, "gi");
}

function highlightPlain(text: string, regex: RegExp): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <mark key={`${m.index}-${parts.length}`}>{m[0]}</mark>,
    );
    last = m.index + m[0].length;
    if (m[0].length === 0) regex.lastIndex++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? parts : text;
}

function highlightHtml(html: string, regex: RegExp): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstChild as HTMLElement | null;
  if (!root) return html;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "MARK") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    targets.push(n as Text);
  }
  for (const text of targets) {
    const value = text.nodeValue ?? "";
    regex.lastIndex = 0;
    if (!regex.test(value)) continue;
    regex.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(value)) !== null) {
      if (m.index > last) {
        frag.appendChild(doc.createTextNode(value.slice(last, m.index)));
      }
      const mark = doc.createElement("mark");
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) regex.lastIndex++;
    }
    if (last < value.length) {
      frag.appendChild(doc.createTextNode(value.slice(last)));
    }
    text.parentNode?.replaceChild(frag, text);
  }
  return root.innerHTML;
}

function createImmersiveAnchorMarkup(href: string, label: string) {
  const boxSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;margin-right:6px;flex-shrink:0"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
  return `<a href="${href}" aria-label="${label.replace(/"/g, "&quot;")}" class="absolute bottom-3 right-3 z-20 inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border border-border/70 bg-background/90 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground shadow-lg backdrop-blur transition hover:border-primary hover:text-primary">${boxSvg}<span aria-hidden="true">VR</span></a>`;
}

function normalizePieceEmbedFrame(frame: HTMLIFrameElement, origin: string) {
  const currentSrc = frame.getAttribute("src") || "";
  // Ensure the iframe src is absolute and uses the canonical origin
  // so it renders correctly on external embeds and across environments.
  if (currentSrc.includes("/embed/pieces/")) {
    const match = currentSrc.match(/\/embed\/pieces\/(\d+)/);
    if (match) {
      const pieceId = match[1];
      const url = new URL(currentSrc, window.location.origin);
      const version = url.searchParams.get("version");
      const nextSrc = `${origin}/embed/pieces/${pieceId}${version ? `?version=${version}` : ""}`;
      if (currentSrc !== nextSrc) {
        frame.setAttribute("src", nextSrc);
      }
    }
  }

  frame.setAttribute("width", "100%");
  frame.removeAttribute("height");
  const existingStyle = frame.getAttribute("style") || "";
  const preservedStyle = existingStyle
    .replace(/(?:^|;)\s*(?:width|height|min-height|max-height|aspect-ratio)\s*:[^;]*/gi, "")
    .trim()
    .replace(/^;|;$/g, "");
  const normalizedStyle = [
    "width:100%",
    "aspect-ratio:16 / 9",
    "display:block",
    preservedStyle,
  ]
    .filter(Boolean)
    .join(";");
  frame.setAttribute("style", normalizedStyle.endsWith(";") ? normalizedStyle : `${normalizedStyle};`);
}

function enhanceImmersiveHtml(html: string, canonicalOrigin: string): string {
  if (typeof DOMParser === "undefined") return html;
  // First, normalize all piece embed URLs in the raw HTML to use the canonical origin.
  // This ensures they render correctly even if the stored HTML has a different origin.
  const normalizedHtml = normalizePieceEmbedUrls(html, canonicalOrigin);

  const doc = new DOMParser().parseFromString(`<div>${normalizedHtml}</div>`, "text/html");
  const root = doc.body.firstChild as HTMLElement | null;
  if (!root) return normalizedHtml;

  Array.from(root.querySelectorAll("img[src]")).forEach((image) => {
    const src = image.getAttribute("src");
    if (!src || image.closest("[data-immersive-wrapper]")) return;

    const wrapper = doc.createElement("span");
    wrapper.setAttribute("data-immersive-wrapper", "image");
    wrapper.className = "not-prose group/immersive relative my-4 inline-block max-w-full align-middle";
    image.parentNode?.insertBefore(wrapper, image);
    wrapper.appendChild(image);
    wrapper.insertAdjacentHTML(
      "beforeend",
      createImmersiveAnchorMarkup(
        buildImmersiveImageHref(src, {
          alt: image.getAttribute("alt"),
          title: image.getAttribute("title"),
        }),
        "Open image in immersive view",
      ),
    );
  });

  Array.from(root.querySelectorAll("iframe[src]")).forEach((frame) => {
    if (!(frame instanceof HTMLIFrameElement)) return;
    const src = frame.getAttribute("src");
    if (!src || frame.closest("[data-immersive-wrapper]")) return;
    const meta = extractPieceEmbedMeta(src);
    if (!meta) return;
    normalizePieceEmbedFrame(frame, canonicalOrigin);

    const wrapper = doc.createElement("div");
    wrapper.setAttribute("data-immersive-wrapper", "piece");
    wrapper.className = "not-prose group/immersive relative my-4";
    frame.parentNode?.insertBefore(wrapper, frame);
    wrapper.appendChild(frame);
    wrapper.insertAdjacentHTML(
      "beforeend",
      createImmersiveAnchorMarkup(
        buildImmersivePieceHref(meta.id, meta.versionId, canonicalOrigin),
        "Open piece in immersive view",
      ),
    );
  });

  Array.from(root.querySelectorAll("iframe[src]")).forEach((frame) => {
    if (!(frame instanceof HTMLIFrameElement)) return;
    const src = frame.getAttribute("src");
    if (!src || frame.closest("[data-immersive-wrapper]")) return;
    const match = src.match(/\/immersive\/exhibits\/([^/?#]+)/);
    if (!match) return;
    const slug = match[1];
    try {
      const url = new URL(src, window.location.origin);
      frame.setAttribute("src", `${canonicalOrigin}/immersive/exhibits/${slug}${url.search}${url.hash}`);
    } catch {
      frame.setAttribute("src", `${canonicalOrigin}/immersive/exhibits/${slug}`);
    }
    frame.setAttribute("width", "100%");
    frame.removeAttribute("height");
    frame.setAttribute("style", "width:100%;aspect-ratio:16 / 9;display:block;");

    const wrapper = doc.createElement("div");
    wrapper.setAttribute("data-immersive-wrapper", "exhibit");
    wrapper.className = "not-prose group/immersive relative my-4";
    frame.parentNode?.insertBefore(wrapper, frame);
    wrapper.appendChild(frame);
    wrapper.insertAdjacentHTML(
      "beforeend",
      createImmersiveAnchorMarkup(
        buildImmersiveExhibitHref(slug, canonicalOrigin),
        "Open exhibit in immersive view",
      ),
    );
  });

  return root.innerHTML;
}

// Same yellow `<mark>` look as the search results page so a click-through
// from /search feels visually continuous.
const MARK_CLASSES =
  "[&_mark]:bg-yellow-200 [&_mark]:dark:bg-yellow-500/40 [&_mark]:rounded [&_mark]:px-0.5";

const DEFAULT_PLAIN_CLASS =
  "text-base text-foreground whitespace-pre-wrap break-words leading-relaxed";

const DEFAULT_HTML_CLASS =
  "wysiwyg-rendered-content prose prose-neutral max-w-none break-words text-foreground prose-p:my-3 prose-h1:mt-7 prose-h1:mb-4 prose-h2:mt-6 prose-h2:mb-3 prose-h3:mt-5 prose-h3:mb-2 prose-h4:mt-4 prose-h4:mb-2 prose-h5:mt-4 prose-h5:mb-2 prose-h6:mt-4 prose-h6:mb-2 prose-strong:font-extrabold prose-strong:text-foreground prose-img:rounded-xl prose-img:border prose-img:border-border prose-iframe:w-full prose-iframe:rounded-xl prose-iframe:border prose-iframe:border-border";

export const PostContent = memo(function PostContent({
  content,
  contentFormat,
  className,
  highlightQuery,
}: PostContentProps) {
  const { data: siteSettings } = useSiteSettings();
  const canonicalOrigin = 
    (window as any).__CANONICAL_ORIGIN__ || 
    siteSettings?.allowedOrigins?.[0] || 
    window.location.origin;

  const terms = useMemo(
    () => tokenizeQuery(highlightQuery ?? ""),
    [highlightQuery],
  );
  const regex = useMemo(() => buildHighlightRegex(terms), [terms]);
  const renderedHtml = useMemo(
    () =>
      regex && contentFormat === "html" ? highlightHtml(content, regex) : content,
    [content, contentFormat, regex],
  );
  const immersiveHtml = useMemo(
    () => (contentFormat === "html" ? enhanceImmersiveHtml(renderedHtml, canonicalOrigin) : renderedHtml),
    [contentFormat, renderedHtml, canonicalOrigin],
  );

  if (contentFormat === "plain") {
    const baseClass = className ?? DEFAULT_PLAIN_CLASS;
    const finalClass = regex ? `${baseClass} ${MARK_CLASSES}` : baseClass;
    return (
      <p className={finalClass}>
        {regex ? highlightPlain(content, regex) : content}
      </p>
    );
  }

  const baseClass = className ?? DEFAULT_HTML_CLASS;
  const finalClass = regex ? `${baseClass} ${MARK_CLASSES}` : baseClass;
  return (
    <div
      className={finalClass}
      dangerouslySetInnerHTML={{ __html: immersiveHtml }}
    />
  );
});

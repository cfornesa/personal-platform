import {
  db,
  eq,
  formatMysqlDateTime,
  platformConnectionsTable,
  type PlatformConnection,
} from "@workspace/db";
import { parseDocument } from "htmlparser2";
import { Element, isTag, Text, type ChildNode, type Node as DomNode } from "domhandler";
import { decodeHTML } from "entities";
import { decryptSecret } from "../crypto";
import { logger } from "../logger";
import type {
  PlatformAdapter,
  SyndicationDispatchOptions,
  SyndicationPayload,
  SyndicationResult,
} from "./types";
import { parseMeta, SyndicationAuthExpiredError, SyndicationConfigurationError } from "./types";
import { buildSyndicatedContent } from "./content";

type SubstackDraftResponse = {
  id?: string | number;
  slug?: string | null;
  canonical_url?: string | null;
  url?: string | null;
};

type SubstackTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "code" }
  | { type: "link"; attrs: { href: string } };

type SubstackTextNode = {
  type: "text";
  text: string;
  marks?: SubstackTextMark[];
};

type SubstackInlineNode =
  | SubstackTextNode
  | { type: "hardBreak" };

type SubstackBlockNode =
  | { type: "paragraph"; content?: SubstackInlineNode[] }
  | { type: "heading"; attrs: { level: number }; content?: SubstackInlineNode[] }
  | { type: "blockquote"; content: SubstackBlockNode[] }
  | { type: "bulletList"; content: Array<{ type: "listItem"; content: SubstackBlockNode[] }> }
  | { type: "orderedList"; attrs: { order: number }; content: Array<{ type: "listItem"; content: SubstackBlockNode[] }> }
  | { type: "codeBlock"; content?: SubstackTextNode[] }
  | { type: "horizontalRule" }
  | { type: "image"; attrs: { src: string; alt?: string; title?: string } };

type SubstackDocument = {
  type: "doc";
  content: SubstackBlockNode[];
};

const SUBSTACK_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const INLINE_MARK_TAGS = new Set(["strong", "b", "em", "i", "code", "a"]);
const UNSUPPORTED_TAGS = new Set(["iframe", "video", "audio", "embed", "object", "script", "style"]);
const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "pre",
  "hr",
  "img",
  "figure",
]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(
  cookieHeader: string,
  options: {
    origin?: string;
    referer?: string;
  } = {},
): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": SUBSTACK_USER_AGENT,
  };
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  if (options.referer) {
    headers.Referer = options.referer;
  }
  if (options.origin) {
    headers.Origin = options.origin;
  }
  return headers;
}

function normalizePublicationHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  }
}

function createUnsupportedContentError(reason: string): Error {
  return new Error(`Substack content mapping error: ${reason}`);
}

function normalizeStoredCookieHeader(raw: string): string {
  const trimmed = raw.trim().replace(/^cookie:\s*/i, "");
  if (!trimmed) return "";
  if (trimmed.includes("=") && trimmed.includes(";")) {
    return trimmed;
  }
  if (trimmed.startsWith("connect.sid=")) {
    return trimmed;
  }
  return `connect.sid=${trimmed}`;
}

function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const chunk of cookieHeader.split(";")) {
    const part = chunk.trim();
    if (!part) continue;
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name) map.set(name, value);
  }
  return map;
}

function serializeCookieMap(cookieMap: Map<string, string>): string {
  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function mergeCookieHeaders(baseCookieHeader: string, setCookieHeaders: string[]): string {
  const cookieMap = parseCookieHeader(baseCookieHeader);
  for (const setCookie of setCookieHeaders) {
    const pair = setCookie.split(";")[0]?.trim();
    if (!pair) continue;
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!name) continue;
    cookieMap.set(name, value);
  }
  return serializeCookieMap(cookieMap);
}

function getSetCookieHeaders(response: Response): string[] {
  const maybeWithGetter = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof maybeWithGetter.getSetCookie === "function") {
    return maybeWithGetter.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function getPublicationSubdomain(publicationHost: string): string {
  const hostname = normalizePublicationHost(publicationHost);
  return hostname.endsWith(".substack.com")
    ? hostname.slice(0, -".substack.com".length)
    : hostname;
}

function getTagName(node: DomNode): string | null {
  return isTag(node) ? node.name.toLowerCase() : null;
}

function textNode(text: string, marks: SubstackTextMark[] = []): SubstackTextNode | null {
  const normalized = decodeHTML(text).replace(/\s+/g, " ");
  if (!normalized.trim()) {
    return null;
  }
  const node: SubstackTextNode = { type: "text", text: normalized };
  if (marks.length > 0) node.marks = marks;
  return node;
}

function cloneMarks(marks: SubstackTextMark[]): SubstackTextMark[] {
  return marks.map((mark) => (mark.type === "link" ? { type: "link", attrs: { href: mark.attrs.href } } : { type: mark.type }));
}

function marksForElement(element: Element, marks: SubstackTextMark[]): SubstackTextMark[] {
  const next = cloneMarks(marks);
  const tag = element.name.toLowerCase();
  if (tag === "strong" || tag === "b") next.push({ type: "bold" });
  else if (tag === "em" || tag === "i") next.push({ type: "italic" });
  else if (tag === "code") next.push({ type: "code" });
  else if (tag === "a") {
    const href = element.attribs.href?.trim();
    if (!href) {
      throw createUnsupportedContentError("link is missing href");
    }
    next.push({ type: "link", attrs: { href } });
  }
  return next;
}

function mergeAdjacentText(nodes: SubstackInlineNode[]): SubstackInlineNode[] {
  const merged: SubstackInlineNode[] = [];
  for (const node of nodes) {
    const prev = merged[merged.length - 1];
    const prevMarks = prev && prev.type === "text" ? JSON.stringify(prev.marks ?? []) : null;
    const nodeMarks = node.type === "text" ? JSON.stringify(node.marks ?? []) : null;
    if (prev && prev.type === "text" && node.type === "text" && prevMarks === nodeMarks) {
      prev.text += node.text;
    } else {
      merged.push(node);
    }
  }
  return merged;
}

function extractInlineNodes(nodes: ChildNode[], marks: SubstackTextMark[] = []): SubstackInlineNode[] {
  const out: SubstackInlineNode[] = [];

  for (const node of nodes) {
    if (node instanceof Text) {
      const next = textNode(node.data, marks);
      if (next) out.push(next);
      continue;
    }

    const tag = getTagName(node);
    if (!tag) continue;

    if (tag === "br") {
      out.push({ type: "hardBreak" });
      continue;
    }

    if (INLINE_MARK_TAGS.has(tag)) {
      out.push(...extractInlineNodes((node as Element).children, marksForElement(node as Element, marks)));
      continue;
    }

    if (tag === "img") {
      throw createUnsupportedContentError("inline images are not supported");
    }

    if (UNSUPPORTED_TAGS.has(tag)) {
      throw createUnsupportedContentError(`unsupported tag <${tag}>`);
    }

    if (BLOCK_TAGS.has(tag)) {
      throw createUnsupportedContentError(`block tag <${tag}> appeared inside inline content`);
    }

    out.push(...extractInlineNodes((node as Element).children, marks));
  }

  return mergeAdjacentText(out);
}

function hasVisibleInline(nodes: SubstackInlineNode[]): boolean {
  return nodes.some((node) => node.type === "hardBreak" || node.text.trim() !== "");
}

function convertCodeBlock(element: Element): SubstackBlockNode {
  const codeElement = element.children.find((child): child is Element => getTagName(child) === "code") ?? element;
  const text = decodeHTML(codeElement.children.map((child) => ("data" in child ? child.data : "")).join(""));
  return {
    type: "codeBlock",
    content: [{ type: "text", text }],
  };
}

function convertListItem(element: Element): { type: "listItem"; content: SubstackBlockNode[] } {
  const blocks = extractBlockNodes(element.children);
  if (blocks.length === 0) {
    return {
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
    };
  }
  return { type: "listItem", content: blocks };
}

function convertFigure(element: Element): SubstackBlockNode[] {
  const image = element.children.find((child): child is Element => getTagName(child) === "img");
  if (!image) {
    throw createUnsupportedContentError("figure without image is not supported");
  }
  return [convertElementToBlock(image)];
}

function convertElementToBlock(element: Element): SubstackBlockNode {
  const tag = element.name.toLowerCase();

  if (tag === "p") {
    const inline = extractInlineNodes(element.children);
    return hasVisibleInline(inline) ? { type: "paragraph", content: inline } : { type: "paragraph" };
  }
  if (/^h[1-6]$/.test(tag)) {
    const inline = extractInlineNodes(element.children);
    return {
      type: "heading",
      attrs: { level: Number(tag.slice(1)) },
      content: hasVisibleInline(inline) ? inline : undefined,
    };
  }
  if (tag === "blockquote") {
    const content = extractBlockNodes(element.children);
    return {
      type: "blockquote",
      content: content.length > 0 ? content : [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
    };
  }
  if (tag === "ul") {
    return {
      type: "bulletList",
      content: element.children.filter((child): child is Element => getTagName(child) === "li").map(convertListItem),
    };
  }
  if (tag === "ol") {
    const order = Number(element.attribs.start ?? "1");
    return {
      type: "orderedList",
      attrs: { order: Number.isFinite(order) ? order : 1 },
      content: element.children.filter((child): child is Element => getTagName(child) === "li").map(convertListItem),
    };
  }
  if (tag === "pre") {
    return convertCodeBlock(element);
  }
  if (tag === "hr") {
    return { type: "horizontalRule" };
  }
  if (tag === "img") {
    const src = element.attribs.src?.trim();
    if (!src) {
      throw createUnsupportedContentError("image is missing src");
    }
    return {
      type: "image",
      attrs: {
        src,
        alt: element.attribs.alt?.trim() || undefined,
        title: element.attribs.title?.trim() || undefined,
      },
    };
  }

  throw createUnsupportedContentError(`unsupported block tag <${tag}>`);
}

function extractBlockNodes(nodes: ChildNode[]): SubstackBlockNode[] {
  const blocks: SubstackBlockNode[] = [];
  let pendingInline: ChildNode[] = [];

  const flushInlineAsParagraph = () => {
    if (pendingInline.length === 0) return;
    const inline = extractInlineNodes(pendingInline);
    if (hasVisibleInline(inline)) {
      blocks.push({ type: "paragraph", content: inline });
    }
    pendingInline = [];
  };

  for (const node of nodes) {
    if (node instanceof Text) {
      if (decodeHTML(node.data).trim()) {
        pendingInline.push(node);
      }
      continue;
    }

    const tag = getTagName(node);
    if (!tag) continue;

    if (tag === "figure") {
      flushInlineAsParagraph();
      blocks.push(...convertFigure(node as Element));
      continue;
    }

    if (UNSUPPORTED_TAGS.has(tag)) {
      throw createUnsupportedContentError(`unsupported tag <${tag}>`);
    }

    if (BLOCK_TAGS.has(tag)) {
      flushInlineAsParagraph();
      blocks.push(convertElementToBlock(node as Element));
      continue;
    }

    pendingInline.push(node);
  }

  flushInlineAsParagraph();
  return blocks;
}

export function buildSubstackDraftBodyDocument(html: string): SubstackDocument {
  const document = parseDocument(html);
  const content = extractBlockNodes(document.children as ChildNode[]);
  return {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
  };
}

async function markConnectionExpired(
  connection: PlatformConnection,
  publicationId: string | null,
  publicationHost: string | null,
): Promise<void> {
  const now = formatMysqlDateTime(new Date());
  const nextMeta = {
    ...(parseMeta(connection.metadata)),
    publicationId,
    publicationHost,
    authStatus: "expired",
    statusMessage: "Substack session expired. Update your session cookie to reconnect.",
    lastAuthFailureAt: now,
  };

  await db
    .update(platformConnectionsTable)
    .set({
      metadata: nextMeta,
      updatedAt: now,
    })
    .where(eq(platformConnectionsTable.id, connection.id));
}

async function fetchCurrentUserId(cookieHeader: string): Promise<number | null> {
  const res = await fetch("https://substack.com/api/v1/user/profile/self", {
    headers: buildHeaders(cookieHeader, {
      referer: "https://substack.com/",
      origin: "https://substack.com",
    }),
  });

  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Substack profile lookup error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { id?: number | string };
  const userId = Number(data.id);
  return Number.isFinite(userId) ? userId : null;
}

function publicationApiUrl(publicationHost: string, path: string): string {
  return `https://${publicationHost}/api/v1${path}`;
}

async function signInForPublication(cookieHeader: string, publicationHost: string): Promise<string> {
  const subdomain = getPublicationSubdomain(publicationHost);
  if (!subdomain) return cookieHeader;

  const signInUrl = `https://substack.com/sign-in?redirect=%2F&for_pub=${encodeURIComponent(subdomain)}`;
  const response = await fetch(signInUrl, {
    headers: buildHeaders(cookieHeader, {
      referer: "https://substack.com/",
      origin: "https://substack.com",
    }),
    redirect: "manual",
  });

  const setCookies = getSetCookieHeaders(response);
  return setCookies.length > 0 ? mergeCookieHeaders(cookieHeader, setCookies) : cookieHeader;
}

export const substackAdapter: PlatformAdapter = {
  async publish(
    connection: PlatformConnection,
    payload: SyndicationPayload,
    options?: SyndicationDispatchOptions,
  ): Promise<SyndicationResult> {
    const storedCookie = connection.encryptedAccessToken
      ? decryptSecret(connection.encryptedAccessToken)
      : "";
    let cookieHeader = normalizeStoredCookieHeader(storedCookie);
    const meta = parseMeta(connection.metadata);
    const publicationIdRaw = meta.publicationId;
    const publicationId = typeof publicationIdRaw === "string" ? publicationIdRaw.trim() : String(publicationIdRaw ?? "").trim();
    const publicationHost = normalizePublicationHost(typeof meta.publicationHost === "string" ? meta.publicationHost : "");

    if (!cookieHeader || !publicationId || !publicationHost) {
      throw new SyndicationConfigurationError("Substack integration not configured");
    }

    await delay(1500);
    cookieHeader = await signInForPublication(cookieHeader, publicationHost);
    const userId = await fetchCurrentUserId(cookieHeader);
    if (!userId) {
      await markConnectionExpired(connection, publicationId, publicationHost);
      logger.warn({ connectionId: connection.id }, "Substack Session Expired");
      throw new SyndicationAuthExpiredError("Substack Session Expired");
    }

    const title = payload.title.trim() || "Untitled";
    const draftBody = buildSubstackDraftBodyDocument(buildSyndicatedContent(payload, { prependFeaturedImage: true }));
    const publicationOrigin = `https://${publicationHost}`;
    const publicationReferer = `${publicationOrigin}/publish/post`;

    const draftRes = await fetch(publicationApiUrl(publicationHost, "/drafts"), {
      method: "POST",
      headers: buildHeaders(cookieHeader, {
        origin: publicationOrigin,
        referer: publicationReferer,
      }),
      body: JSON.stringify({
        draft_title: title,
        draft_subtitle: "",
        draft_body: JSON.stringify(draftBody),
        draft_bylines: [{ id: userId, is_guest: false }],
        draft_podcast_url: null,
        draft_podcast_duration: null,
        draft_section_id: null,
        section_chosen: false,
        audience: "everyone",
        type: "newsletter",
        write_comment_permissions: "everyone",
      }),
    });

    if (draftRes.status === 401) {
      await markConnectionExpired(connection, publicationId, publicationHost);
      logger.warn({ connectionId: connection.id }, "Substack Session Expired");
      throw new SyndicationAuthExpiredError("Substack Session Expired");
    }

    if (!draftRes.ok) {
      const body = await draftRes.text().catch(() => "");
      throw new Error(`Substack draft API error ${draftRes.status}: ${body.slice(0, 500)}`);
    }

    const draft = (await draftRes.json()) as SubstackDraftResponse;
    const draftId = String(draft.id ?? "");
    if (!draftId) {
      throw new Error("Substack draft API error: missing draft id");
    }

    const prepublishRes = await fetch(publicationApiUrl(publicationHost, `/drafts/${draftId}/prepublish`), {
      headers: buildHeaders(cookieHeader, {
        origin: publicationOrigin,
        referer: publicationReferer,
      }),
    });

    if (prepublishRes.status === 401) {
      await markConnectionExpired(connection, publicationId, publicationHost);
      logger.warn({ connectionId: connection.id }, "Substack Session Expired");
      throw new SyndicationAuthExpiredError("Substack Session Expired");
    }
    if (!prepublishRes.ok) {
      const body = await prepublishRes.text().catch(() => "");
      throw new Error(`Substack prepublish API error ${prepublishRes.status}: ${body.slice(0, 500)}`);
    }

    const publishRes = await fetch(publicationApiUrl(publicationHost, `/drafts/${draftId}/publish`), {
      method: "POST",
      headers: buildHeaders(cookieHeader, {
        origin: publicationOrigin,
        referer: publicationReferer,
      }),
      body: JSON.stringify({
        send: options?.substackSendNewsletter === true,
        share_automatically: false,
      }),
    });

    if (publishRes.status === 401) {
      await markConnectionExpired(connection, publicationId, publicationHost);
      logger.warn({ connectionId: connection.id }, "Substack Session Expired");
      throw new SyndicationAuthExpiredError("Substack Session Expired");
    }
    if (!publishRes.ok) {
      const body = await publishRes.text().catch(() => "");
      throw new Error(`Substack publish API error ${publishRes.status}: ${body.slice(0, 500)}`);
    }

    const data = (await publishRes.json()) as SubstackDraftResponse;
    const externalId = String(data.id ?? "");
    const externalUrl =
      data.url?.trim()
      || data.canonical_url?.trim()
      || draft.url?.trim()
      || draft.canonical_url?.trim()
      || (data.slug ? `https://${publicationHost}/p/${data.slug}` : "");

    return {
      externalId,
      externalUrl,
    };
  },
};

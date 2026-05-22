import { decryptSecret } from "../crypto";
import type { PlatformAdapter, SyndicationPayload, SyndicationResult } from "./types";
import { parseMeta } from "./types";
import type { PlatformConnection } from "@workspace/db";
import { buildLinkCardMetadata, buildSocialPostText, ensureCanonicalUrl } from "./content";

const BSKY_HOST = "https://bsky.social";

type BskySession = { did: string; accessJwt: string };
type BskyBlobResponse = { blob: { $type: string; ref: { $link: string }; mimeType: string; size: number } };
type BskyCreateRecordResponse = { uri: string; cid: string };

async function createSession(handle: string, appPassword: string): Promise<BskySession> {
  const res = await fetch(`${BSKY_HOST}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Bluesky session error ${res.status}: ${errBody.slice(0, 300)}`);
  }
  return (await res.json()) as BskySession;
}

async function uploadBlobFromUrl(
  imageUrl: string,
  accessJwt: string,
): Promise<BskyBlobResponse["blob"] | null> {
  try {
    const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imageRes.ok) return null;
    const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
    const buffer = await imageRes.arrayBuffer();

    const uploadRes = await fetch(`${BSKY_HOST}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        "Content-Type": contentType,
      },
      body: buffer,
      signal: AbortSignal.timeout(30_000),
    });
    if (!uploadRes.ok) return null;
    const data = (await uploadRes.json()) as BskyBlobResponse;
    return data.blob;
  } catch {
    return null;
  }
}

function buildUrlFacet(text: string, url: string) {
  const charStart = text.indexOf(url);
  if (charStart < 0) {
    return null;
  }
  const encoder = new TextEncoder();
  const prefixBytes = encoder.encode(text.slice(0, charStart));
  const urlBytes = encoder.encode(url);
  const byteStart = prefixBytes.length;
  const byteEnd = byteStart + urlBytes.length;
  return {
    index: { byteStart, byteEnd },
    features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
  };
}

export const blueskyAdapter: PlatformAdapter = {
  async publish(connection: PlatformConnection, payload: SyndicationPayload): Promise<SyndicationResult> {
    const appPassword = decryptSecret(connection.encryptedAccessToken!);
    const meta = parseMeta(connection.metadata);
    const handle = meta.handle as string;
    if (!handle) throw new Error("Bluesky connection is missing handle in metadata");

    const { did, accessJwt } = await createSession(handle, appPassword);

    const rawText = payload.socialPostDrafts?.bluesky?.trim()
      || buildSocialPostText("bluesky", { title: payload.title, content: payload.contentHtml, contentFormat: payload.contentFormat }, [], payload.canonicalUrl);
    const text = ensureCanonicalUrl(rawText, payload.canonicalUrl, "bluesky");
    const urlFacet = buildUrlFacet(text, payload.canonicalUrl);
    const card = buildLinkCardMetadata(payload);

    const record: Record<string, unknown> = {
      $type: "app.bsky.feed.post",
      text,
      createdAt: new Date().toISOString(),
      langs: ["en"],
    };
    if (urlFacet) {
      record.facets = [urlFacet];
    }

    let thumb: BskyBlobResponse["blob"] | undefined;
    if (payload.featuredImageUrl) {
      thumb = await uploadBlobFromUrl(payload.featuredImageUrl, accessJwt) ?? undefined;
    }
    record.embed = {
      $type: "app.bsky.embed.external",
      external: {
        uri: card.source,
        title: card.title,
        description: card.description,
        ...(thumb ? { thumb } : {}),
      },
    };

    const createRes = await fetch(`${BSKY_HOST}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repo: did,
        collection: "app.bsky.feed.post",
        record,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!createRes.ok) {
      const errBody = await createRes.text().catch(() => "");
      throw new Error(`Bluesky post error ${createRes.status}: ${errBody.slice(0, 500)}`);
    }

    const data = (await createRes.json()) as BskyCreateRecordResponse;
    // AT URI format: at://did:plc:xxx/app.bsky.feed.post/recordKey
    // Convert to public URL: https://bsky.app/profile/{handle}/post/{recordKey}
    const recordKey = data.uri.split("/").at(-1) ?? "";
    const externalUrl = `https://bsky.app/profile/${handle}/post/${recordKey}`;

    return { externalId: data.uri, externalUrl };
  },
};

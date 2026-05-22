import { decryptSecret } from "../crypto";
import type { PlatformAdapter, SyndicationPayload, SyndicationResult } from "./types";
import { parseMeta } from "./types";
import type { PlatformConnection } from "@workspace/db";
import { buildSyndicatedContent } from "./content";

type WpSelfPostResponse = { id: number; link: string };
type WpSelfMediaResponse = { id: number };

async function uploadFeaturedMediaToWp(
  siteUrl: string,
  basicCredential: string,
  imageUrl: string,
): Promise<number | null> {
  try {
    const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imageRes.ok) return null;
    const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
    const buffer = await imageRes.arrayBuffer();
    const filename = imageUrl.split("/").pop()?.split("?")[0] ?? "image.jpg";

    const uploadRes = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicCredential}`,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
      body: buffer,
      signal: AbortSignal.timeout(30_000),
    });
    if (!uploadRes.ok) return null;
    const data = (await uploadRes.json()) as WpSelfMediaResponse;
    return data.id ?? null;
  } catch {
    return null;
  }
}

// Self-hosted WordPress uses App Passwords (username:password), not OAuth tokens.
// The "access token" field stores base64(username:appPassword) for Basic Auth.
// App Passwords do not expire, so no refreshToken method is needed.
export const wordpressSelfAdapter: PlatformAdapter = {
  async publish(connection: PlatformConnection, payload: SyndicationPayload): Promise<SyndicationResult> {
    const meta = parseMeta(connection.metadata);
    const siteUrl = (meta.siteUrl as string | undefined)?.replace(/\/$/, "");

    if (!siteUrl) {
      throw new Error("Self-hosted WordPress connection is missing siteUrl in metadata");
    }

    // encryptedAccessToken stores base64(username:appPassword)
    const basicCredential = decryptSecret(connection.encryptedAccessToken!);

    const featuredMediaId = payload.featuredImageUrl
      ? await uploadFeaturedMediaToWp(siteUrl, basicCredential, payload.featuredImageUrl)
      : null;

    const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicCredential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: payload.title,
        content: buildSyndicatedContent(payload),
        status: "publish",
        ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`WordPress self-hosted API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as WpSelfPostResponse;
    return { externalId: String(data.id), externalUrl: data.link };
  },
};

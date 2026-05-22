import { decryptSecret } from "../crypto";
import type { PlatformAdapter, SyndicationPayload, SyndicationResult } from "./types";
import { parseMeta } from "./types";
import type { PlatformConnection } from "@workspace/db";
import { buildSocialPostText, ensureCanonicalUrl } from "./content";

type IGMediaResponse = { id: string };
type IGPublishResponse = { id: string };

export const instagramAdapter: PlatformAdapter = {
  async publish(connection: PlatformConnection, payload: SyndicationPayload): Promise<SyndicationResult> {
    if (!payload.featuredImageUrl) {
      throw new Error("Instagram posts require a featured image URL — set one before publishing to Instagram");
    }

    // Page Access Token (same Meta app as Facebook, stored as primary access token)
    const pageAccessToken = decryptSecret(connection.encryptedAccessToken!);
    const meta = parseMeta(connection.metadata);
    const igUserId = meta.igUserId as string;
    if (!igUserId) throw new Error("Instagram connection is missing igUserId in metadata");

    const rawCaption = payload.socialPostDrafts?.instagram?.trim()
      || buildSocialPostText("instagram", { title: payload.title, content: payload.contentHtml, contentFormat: payload.contentFormat }, [], payload.canonicalUrl);
    const caption = ensureCanonicalUrl(rawCaption, payload.canonicalUrl, "instagram");

    // Step 1: Create media container
    const containerRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: payload.featuredImageUrl,
        caption,
      }),
    });

    if (!containerRes.ok) {
      const errBody = await containerRes.text().catch(() => "");
      throw new Error(`Instagram media container error ${containerRes.status}: ${errBody.slice(0, 500)}`);
    }

    const containerData = (await containerRes.json()) as IGMediaResponse;
    const creationId = containerData.id;

    // Step 2: Publish the container
    const publishRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ creation_id: creationId }),
    });

    if (!publishRes.ok) {
      const errBody = await publishRes.text().catch(() => "");
      throw new Error(`Instagram media publish error ${publishRes.status}: ${errBody.slice(0, 500)}`);
    }

    const publishData = (await publishRes.json()) as IGPublishResponse;
    const mediaId = publishData.id;

    const igUsername = meta.igUsername as string | undefined;
    const externalUrl = igUsername
      ? `https://www.instagram.com/${igUsername}/`
      : `https://www.instagram.com/`;

    return { externalId: mediaId, externalUrl };
  },
};

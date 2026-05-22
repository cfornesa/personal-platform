import { decryptSecret } from "../crypto";
import type { PlatformAdapter, SyndicationPayload, SyndicationResult } from "./types";
import { parseMeta } from "./types";
import type { PlatformConnection } from "@workspace/db";
import { buildSocialPostText, ensureCanonicalUrl } from "./content";

type FacebookFeedResponse = { id: string };

export const facebookAdapter: PlatformAdapter = {
  async publish(connection: PlatformConnection, payload: SyndicationPayload): Promise<SyndicationResult> {
    // Page Access Token is stored as the primary access token
    const pageAccessToken = decryptSecret(connection.encryptedAccessToken!);
    const meta = parseMeta(connection.metadata);
    const pageId = meta.pageId as string;
    if (!pageId) throw new Error("Facebook connection is missing pageId in metadata");

    const rawText = payload.socialPostDrafts?.facebook?.trim()
      || buildSocialPostText("facebook", { title: payload.title, content: payload.contentHtml, contentFormat: payload.contentFormat }, [], payload.canonicalUrl);
    const text = ensureCanonicalUrl(rawText, payload.canonicalUrl, "facebook");

    const pageUsername = meta.username as string | undefined;

    const res = await fetch(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: text,
        link: payload.canonicalUrl,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Facebook Graph API error ${res.status}: ${errBody.slice(0, 500)}`);
    }

    const data = (await res.json()) as FacebookFeedResponse;
    const externalId = data.id;
    const postPart = data.id.split("_")[1] ?? data.id;
    const externalUrl = pageUsername
      ? `https://www.facebook.com/${pageUsername}/posts/${postPart}`
      : `https://www.facebook.com/${pageId}/posts/${postPart}`;

    return { externalId, externalUrl };
  },
};

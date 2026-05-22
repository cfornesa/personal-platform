import { decryptSecret } from "../crypto";
import type { PlatformAdapter, SyndicationPayload, SyndicationResult } from "./types";
import { parseMeta } from "./types";
import type { PlatformConnection } from "@workspace/db";
import { buildLinkCardMetadata, buildSocialPostText, ensureCanonicalUrl } from "./content";

export const DEFAULT_LINKEDIN_API_VERSION = "202605";

function getLinkedInApiVersion() {
  return process.env.LINKEDIN_API_VERSION?.trim() || DEFAULT_LINKEDIN_API_VERSION;
}

function linkedInHeaders(accessToken: string, contentType = "application/json") {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": contentType,
    "LinkedIn-Version": getLinkedInApiVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

type LinkedInInitializeImageUploadResponse = {
  value?: {
    uploadUrl?: string;
    image?: string;
  };
};

async function uploadLinkedInThumbnail(
  imageUrl: string,
  ownerUrn: string,
  accessToken: string,
): Promise<string> {
  const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!imageRes.ok) {
    const errBody = await imageRes.text().catch(() => "");
    throw new Error(`LinkedIn thumbnail fetch failed ${imageRes.status}: ${errBody.slice(0, 300)}`);
  }

  const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
  const buffer = await imageRes.arrayBuffer();

  const initRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: linkedInHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: ownerUrn,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!initRes.ok) {
    const errBody = await initRes.text().catch(() => "");
    throw new Error(`LinkedIn thumbnail initialize error ${initRes.status}: ${errBody.slice(0, 500)}`);
  }

  const initData = (await initRes.json()) as LinkedInInitializeImageUploadResponse;
  const uploadUrl = initData.value?.uploadUrl;
  const imageUrn = initData.value?.image;
  if (!uploadUrl || !imageUrn) {
    throw new Error("LinkedIn thumbnail initialize response was missing uploadUrl or image URN");
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType,
    },
    body: buffer,
    signal: AbortSignal.timeout(30_000),
  });

  if (!uploadRes.ok) {
    const errBody = await uploadRes.text().catch(() => "");
    throw new Error(`LinkedIn thumbnail upload error ${uploadRes.status}: ${errBody.slice(0, 500)}`);
  }

  return imageUrn;
}

export const linkedinAdapter: PlatformAdapter = {
  async publish(connection: PlatformConnection, payload: SyndicationPayload): Promise<SyndicationResult> {
    const accessToken = decryptSecret(connection.encryptedAccessToken!);
    const meta = parseMeta(connection.metadata);
    const personId = meta.personId as string;
    if (!personId) throw new Error("LinkedIn connection is missing personId in metadata");

    const rawCommentary = payload.socialPostDrafts?.linkedin?.trim()
      || buildSocialPostText("linkedin", { title: payload.title, content: payload.contentHtml, contentFormat: payload.contentFormat }, [], payload.canonicalUrl);
    const commentary = ensureCanonicalUrl(rawCommentary, payload.canonicalUrl, "linkedin");
    const authorUrn = `urn:li:person:${personId}`;
    const card = buildLinkCardMetadata(payload);
    let thumbnail: string | undefined;
    if (payload.featuredImageUrl) {
      try {
        thumbnail = await uploadLinkedInThumbnail(payload.featuredImageUrl, authorUrn, accessToken);
      } catch {
        // thumbnail unavailable — post will publish without featured image
      }
    }

    const body: Record<string, unknown> = {
      author: authorUrn,
      commentary,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: {
        article: {
          source: card.source,
          title: card.title,
          description: card.description,
          ...(thumbnail ? { thumbnail } : {}),
        },
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };

    const res = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: linkedInHeaders(accessToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`LinkedIn API error ${res.status}: ${errBody.slice(0, 500)}`);
    }

    // LinkedIn returns 201 with the post URN in the X-LinkedIn-Id header
    const postUrn = res.headers.get("x-linkedin-id") ?? res.headers.get("x-restli-id") ?? "";
    const externalId = postUrn || "unknown";

    // The URN encodes the post ID, e.g. urn:li:share:7205...
    const postId = postUrn.split(":").at(-1) ?? "";
    const externalUrl = postId
      ? `https://www.linkedin.com/feed/update/${postUrn}/`
      : `https://www.linkedin.com/in/${meta.profileUrl ?? ""}`;

    return { externalId, externalUrl };
  },
};

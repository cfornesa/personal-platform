import { decryptSecret } from "../crypto";
import { getOAuthAppCredentials } from "../oauth-app-credentials";
import type { PlatformAdapter, SyndicationPayload, SyndicationResult, TokenRefreshResult } from "./types";
import { parseMeta } from "./types";
import type { PlatformConnection } from "@workspace/db";
import { buildSyndicatedContent } from "./content";

type WpComPostResponse = { ID: number; URL: string };
type WpComTokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };

export const wordpressComAdapter: PlatformAdapter = {
  async publish(connection: PlatformConnection, payload: SyndicationPayload): Promise<SyndicationResult> {
    const token = decryptSecret(connection.encryptedAccessToken!);
    const meta = parseMeta(connection.metadata);
    let siteId: string | number | undefined = meta.blogId as string | number | undefined;

    // If blogId wasn't stored during OAuth (e.g. old connection or fetch failed),
    // try to recover it from the API at publish time.
    if (!siteId) {
      const sitesRes = await fetch("https://public-api.wordpress.com/rest/v1.1/me/sites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (sitesRes.ok) {
        const data = (await sitesRes.json()) as { sites?: Array<{ ID: number }> };
        const first = data.sites?.[0];
        if (first) siteId = String(first.ID);
      }
    }

    if (!siteId) {
      throw new Error("WordPress.com: no blog found on this account. Disconnect and reconnect from Admin → Platforms.");
    }

    const res = await fetch(
      `https://public-api.wordpress.com/rest/v1.1/sites/${siteId}/posts/new`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: payload.title,
          content: buildSyndicatedContent(payload),
          status: "publish",
          format: "standard",
          ...(payload.featuredImageUrl ? { featured_image: payload.featuredImageUrl } : {}),
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`WordPress.com API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as WpComPostResponse;
    return { externalId: String(data.ID), externalUrl: data.URL };
  },

  async refreshToken(connection: PlatformConnection): Promise<TokenRefreshResult> {
    const refreshToken = connection.encryptedRefreshToken
      ? decryptSecret(connection.encryptedRefreshToken)
      : null;

    if (!refreshToken) {
      throw new Error("WordPress.com connection has no refresh token");
    }

    const creds = await getOAuthAppCredentials(
      "wordpress_com",
      process.env.WORDPRESS_COM_CLIENT_ID,
      process.env.WORDPRESS_COM_CLIENT_SECRET,
    );
    if (!creds) {
      throw new Error("WordPress.com OAuth app credentials not configured");
    }

    const res = await fetch("https://public-api.wordpress.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`WordPress.com token refresh error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as WpComTokenResponse;
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    };
  },
};

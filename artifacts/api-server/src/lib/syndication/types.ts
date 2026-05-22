import type { PlatformConnection } from "@workspace/db";

/**
 * Safely extract metadata from a platform connection.
 * Guards against the mysql2/Drizzle edge case where a JSON column is
 * returned as a raw string instead of a pre-parsed object.
 */
export function parseMeta(raw: PlatformConnection["metadata"]): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; }
    catch { return {}; }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

export type SyndicationPayload = {
  /** Short title derived from the first ~100 chars of stripped content. */
  title: string;
  /** Original post body. HTML for rich posts, plain text for legacy posts. */
  contentHtml: string;
  /** The original post body format so adapters can append the source footer safely. */
  contentFormat: "plain" | "html";
  /** Absolute canonical URL on this site, e.g. https://example.com/posts/42 */
  canonicalUrl: string;
  /** HTML footer for rich syndicated copies. */
  sourceFooterHtml: string;
  /** Plain-text footer for plain syndicated copies and markdown conversion. */
  sourceFooterText: string;
  /** Optional featured image URL from the post — used as a card thumbnail or image post depending on platform. */
  featuredImageUrl?: string | null;
  /** Per-platform social post draft text saved with the post. */
  socialPostDrafts?: { bluesky?: string; linkedin?: string; facebook?: string; instagram?: string } | null;
};

export type SyndicationDispatchOptions = {
  substackSendNewsletter?: boolean;
};

export type SyndicationResult = {
  externalId: string;
  externalUrl: string;
};

export type TokenRefreshResult = {
  accessToken: string;
  refreshToken?: string;
  /** ISO 8601 datetime string, e.g. new Date(Date.now() + ms).toISOString() */
  expiresAt?: string;
};

export class SyndicationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyndicationConfigurationError";
  }
}

export class SyndicationAuthExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyndicationAuthExpiredError";
  }
}

export interface PlatformAdapter {
  publish(
    connection: PlatformConnection,
    payload: SyndicationPayload,
    options?: SyndicationDispatchOptions,
  ): Promise<SyndicationResult>;
  /** Optional — only adapters whose platform issues expiring tokens implement this. */
  refreshToken?(connection: PlatformConnection): Promise<TokenRefreshResult>;
}

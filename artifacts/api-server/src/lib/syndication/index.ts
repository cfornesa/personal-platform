import {
  db,
  platformConnectionsTable,
  postSyndicationsTable,
  postsTable,
  siteSettingsTable,
  eq,
  and,
  inArray,
  formatMysqlDateTime,
  type PlatformConnection,
  type Post,
} from "@workspace/db";
import { encryptSecret } from "../crypto";
import { logger } from "../logger";
import type {
  PlatformAdapter,
  SyndicationDispatchOptions,
  SyndicationPayload,
  TokenRefreshResult,
} from "./types";
import { wordpressComAdapter } from "./wordpress-com";
import { wordpressSelfAdapter } from "./wordpress-self";
import { mediumAdapter } from "./medium";
import { bloggerAdapter } from "./blogger";
import { substackAdapter } from "./substack";
import { blueskyAdapter } from "./bluesky";
import { linkedinAdapter } from "./linkedin";
import { facebookAdapter } from "./facebook";
import { instagramAdapter } from "./instagram";
import { buildSourceFooter, rewriteRelativeImageUrls, shouldAppendSourceFooter } from "./content";

const ADAPTERS: Record<string, PlatformAdapter> = {
  wordpress_com: wordpressComAdapter,
  wordpress_self: wordpressSelfAdapter,
  medium: mediumAdapter,
  blogger: bloggerAdapter,
  substack: substackAdapter,
  bluesky: blueskyAdapter,
  linkedin: linkedinAdapter,
  facebook: facebookAdapter,
  instagram: instagramAdapter,
};

export function getAdapter(platform: string): PlatformAdapter {
  const adapter = ADAPTERS[platform];
  if (!adapter) throw new Error(`No syndication adapter for platform: ${platform}`);
  return adapter;
}

async function loadSiteTitle(): Promise<string | null> {
  try {
    const rows = await db
      .select({ siteTitle: siteSettingsTable.siteTitle })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, 1))
      .limit(1);
    return rows[0]?.siteTitle?.trim() || null;
  } catch {
    return null;
  }
}

async function buildPayload(post: Post, origin: string): Promise<SyndicationPayload> {
  const canonicalUrl = `${origin}/posts/${post.id}`;
  const sourceFooter = shouldAppendSourceFooter(post)
    ? buildSourceFooter(await loadSiteTitle(), canonicalUrl)
    : { html: "", text: "" };

  const extPost = post as Post & {
    title?: string | null;
    featuredImageUrl?: string | null;
    socialPostDrafts?: string | Record<string, string> | null;
  };

  let socialPostDrafts: SyndicationPayload["socialPostDrafts"] = null;
  if (extPost.socialPostDrafts) {
    if (typeof extPost.socialPostDrafts === "string") {
      try { socialPostDrafts = JSON.parse(extPost.socialPostDrafts); } catch { /* ignore */ }
    } else {
      socialPostDrafts = extPost.socialPostDrafts as SyndicationPayload["socialPostDrafts"];
    }
  }

  const rawFeaturedImageUrl = extPost.featuredImageUrl?.trim() || null;
  const featuredImageUrl = rawFeaturedImageUrl && rawFeaturedImageUrl.startsWith("/")
    ? `${origin}${rawFeaturedImageUrl}`
    : rawFeaturedImageUrl;

  const contentFormat = post.contentFormat === "plain" ? "plain" : "html" as const;
  const contentHtml = contentFormat === "html"
    ? rewriteRelativeImageUrls(post.content, origin)
    : post.content;

  return {
    title: extPost.title?.trim() ?? "",
    contentHtml,
    contentFormat,
    canonicalUrl,
    sourceFooterHtml: sourceFooter.html,
    sourceFooterText: sourceFooter.text,
    featuredImageUrl,
    socialPostDrafts,
  };
}

// Refresh the connection token if it expires within 5 minutes.
// Returns the updated connection row (with still-encrypted token fields).
async function maybeRefreshToken(
  connection: PlatformConnection,
  adapter: PlatformAdapter,
): Promise<PlatformConnection> {
  if (!adapter.refreshToken || !connection.expiresAt) return connection;

  const expiresMs = new Date(connection.expiresAt).getTime();
  const fiveMinutesMs = 5 * 60 * 1000;
  if (Date.now() < expiresMs - fiveMinutesMs) return connection;

  logger.info({ connectionId: connection.id, platform: connection.platform }, "Refreshing platform token");

  let refreshed: TokenRefreshResult;
  try {
    refreshed = await adapter.refreshToken(connection);
  } catch (err) {
    logger.warn({ err, connectionId: connection.id }, "Token refresh failed — proceeding with stale token");
    return connection;
  }

  const now = formatMysqlDateTime(new Date());
  const expiresAt = refreshed.expiresAt
    ? formatMysqlDateTime(new Date(refreshed.expiresAt))
    : null;

  const patch: Partial<typeof platformConnectionsTable.$inferInsert> = {
    encryptedAccessToken: encryptSecret(refreshed.accessToken),
    updatedAt: now,
  };
  if (expiresAt) patch.expiresAt = expiresAt;
  if (refreshed.refreshToken) patch.encryptedRefreshToken = encryptSecret(refreshed.refreshToken);

  await db
    .update(platformConnectionsTable)
    .set(patch)
    .where(eq(platformConnectionsTable.id, connection.id));

  return { ...connection, ...patch, expiresAt: expiresAt ?? connection.expiresAt };
}

async function runSyndication(
  postId: number,
  connectionIds: number[],
  userId: string,
  origin: string,
  options: SyndicationDispatchOptions,
): Promise<void> {
  const [post] = await db
    .select()
    .from(postsTable)
    .where(eq(postsTable.id, postId))
    .limit(1);

  if (!post) {
    logger.warn({ postId }, "Syndication skipped — post not found");
    return;
  }

  const connections = await db
    .select()
    .from(platformConnectionsTable)
    .where(
      and(
        inArray(platformConnectionsTable.id, connectionIds),
        eq(platformConnectionsTable.userId, userId),
        eq(platformConnectionsTable.enabled, 1),
      ),
    );

  if (connections.length === 0) return;

  const payload = await buildPayload(post, origin);

  for (const conn of connections) {
    // Insert a pending row first; idempotent via ON DUPLICATE KEY UPDATE.
    await db
      .insert(postSyndicationsTable)
      .values({ postId, platformConnectionId: conn.id, status: "pending" })
      .onDuplicateKeyUpdate({ set: { status: "pending" } });

    try {
      const adapter = getAdapter(conn.platform);
      const refreshedConn = await maybeRefreshToken(conn, adapter);
      const result = await adapter.publish(refreshedConn, payload, options);

      await db
        .update(postSyndicationsTable)
        .set({
          status: "success",
          externalId: result.externalId,
          externalUrl: result.externalUrl,
          syncedAt: formatMysqlDateTime(new Date()),
        })
        .where(
          and(
            eq(postSyndicationsTable.postId, postId),
            eq(postSyndicationsTable.platformConnectionId, conn.id),
          ),
        );

      logger.info(
        { postId, platform: conn.platform, externalUrl: result.externalUrl },
        "Post syndicated",
      );
    } catch (err) {
      const errorMessage = String(err).slice(0, 1000);
      await db
        .update(postSyndicationsTable)
        .set({ status: "failed", errorMessage })
        .where(
          and(
            eq(postSyndicationsTable.postId, postId),
            eq(postSyndicationsTable.platformConnectionId, conn.id),
          ),
        );

      logger.warn({ err, postId, platform: conn.platform }, "Syndication failed for platform");
    }
  }
}

/**
 * Fire-and-forget: dispatches syndication after post creation.
 * Runs asynchronously so it never delays the POST /posts response.
 */
export function enqueueSyndication(
  postId: number,
  connectionIds: number[],
  userId: string,
  origin: string,
  options: SyndicationDispatchOptions = {},
): void {
  if (connectionIds.length === 0) return;
  void Promise.resolve()
    .then(() => runSyndication(postId, connectionIds, userId, origin, options))
    .catch((err) => logger.error({ err, postId }, "Syndication dispatcher threw unexpectedly"));
}

import { mysqlTable, varchar, text, int, datetime, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users.ts";
import { feedSourcesTable } from "./feeds.ts";

export const postContentFormatSchema = z.enum(["plain", "html"]);

/**
 * `posts.status` — persisted string enum. Values:
 *   - `published`  — visible on the public timeline (default for owner-authored posts).
 *   - `pending`    — sitting in the moderation queue (created by the RSS
 *                    ingest worker; never shown publicly until an owner approves it).
 *   - `draft`      — saved by the owner but not yet queued for publishing.
 *   - `scheduled`  — set to auto-publish at a future `scheduled_at` datetime.
 *
 * Per AGENTS.md these values are part of the data contract; renaming or
 * adding values requires an explicit migration of every existing row.
 * New values confirmed by the owner on 2026-05-14.
 */
export const postStatusSchema = z.enum(["published", "pending", "draft", "scheduled"]);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const postsTable = mysqlTable(
  "posts",
  {
    id: int("id").autoincrement().primaryKey(),
    authorId: varchar("author_id", { length: 191 }).notNull(),
    authorUserId: varchar("author_user_id", { length: 191 }).references(() => usersTable.id, { onDelete: "set null" }),
    authorName: varchar("author_name", { length: 255 }).notNull(),
    authorImageUrl: varchar("author_image_url", { length: 2048 }),
    title: varchar("title", { length: 500 }),
    content: text("content").notNull(),
    // Plain-text shadow of `content`, kept in sync by every write path.
    // Backs the FULLTEXT index used by `/api/posts/search` so search hits
    // the words a reader actually sees instead of raw HTML tags. Nullable
    // so the runtime migration can land before the backfill completes.
    contentText: text("content_text"),
    contentFormat: varchar("content_format", { length: 16 }).notNull().default("plain"),
    status: varchar("status", { length: 16 }).notNull().default("published"),
    // FK → `feed_sources(id)`. ON DELETE SET NULL so unsubscribing
    // from a source does NOT delete already-imported posts; they stay
    // around but lose the back-pointer.
    sourceFeedId: int("source_feed_id").references(() => feedSourcesTable.id, {
      onDelete: "set null",
    }),
    sourceGuid: varchar("source_guid", { length: 1024 }),
    sourceCanonicalUrl: varchar("source_canonical_url", { length: 2048 }),
    // Nullable: only set when status='scheduled'. The post-scheduler
    // checks this column every 60s and flips status → 'published' once
    // the datetime has passed.
    scheduledAt: datetime("scheduled_at", { mode: "string", fsp: 3 }),
    // JSON-encoded number[] of platform_connection IDs to syndicate to
    // when the post transitions to 'published' (draft→published or
    // scheduler fires). Cleared after syndication is dispatched.
    pendingPlatformIds: text("pending_platform_ids"),
    featuredImageUrl: varchar("featured_image_url", { length: 2048 }),
    socialPostDrafts: text("social_post_drafts"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => ({
    statusIdx: index("posts_status_idx").on(t.status),
    sourceFeedIdx: index("posts_source_feed_idx").on(t.sourceFeedId),
    scheduledIdx: index("posts_scheduled_idx").on(t.status, t.scheduledAt),
    authorIdIdx: index("posts_author_id_idx").on(t.authorId),
    statusCreatedIdx: index("posts_status_created_idx").on(t.status, t.createdAt),
  }),
);

export const insertPostSchema = createInsertSchema(postsTable)
  .omit({
    id: true,
    createdAt: true,
    authorId: true,
    authorUserId: true,
    authorName: true,
    authorImageUrl: true,
    status: true,
    sourceFeedId: true,
    sourceGuid: true,
    sourceCanonicalUrl: true,
  })
  .extend({
    content: z.string().min(1).max(40000),
    contentFormat: postContentFormatSchema.default("html"),
  });

export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;

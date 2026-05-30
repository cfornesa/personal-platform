import { mysqlTable, varchar, text, int, datetime, char, uniqueIndex, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * `feed_sources` — RSS / Atom feeds the owner subscribes to.
 *
 * The cadence column is a persisted string enum: `daily | weekly | monthly`.
 * Per AGENTS.md the values are part of the data contract and never change
 * without an explicit migration of every existing row.
 */
export const feedCadenceSchema = z.enum(["daily", "weekly", "monthly"]);
export type FeedCadence = z.infer<typeof feedCadenceSchema>;

export const feedSourcesTable = mysqlTable("feed_sources", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  username: varchar("username", { length: 100 }),
  bio: text("bio"),
  authorName: varchar("author_name", { length: 255 }),
  imageUrl: varchar("image_url", { length: 2048 }),
  feedUrl: varchar("feed_url", { length: 2048 }).notNull(),
  siteUrl: varchar("site_url", { length: 2048 }),
  cadence: varchar("cadence", { length: 16 }).notNull().default("daily"),
  enabled: int("enabled").notNull().default(1),
  lastFetchedAt: datetime("last_fetched_at", { mode: "string", fsp: 3 }),
  // Computed at each successful refresh as `lastFetchedAt + cadenceInterval`.
  // The bulk-refresh sweep compares `now() >= nextFetchAt` so the
  // cadence gate is a single field comparison instead of recomputing
  // the interval every call. NULL means "never fetched" → treat as due.
  nextFetchAt: datetime("next_fetch_at", { mode: "string", fsp: 3 }),
  lastStatus: varchar("last_status", { length: 32 }),
  lastError: text("last_error"),
  itemsImported: int("items_imported").notNull().default(0),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export type FeedSource = typeof feedSourcesTable.$inferSelect;
export type InsertFeedSource = typeof feedSourcesTable.$inferInsert;

/**
 * `feed_items_seen` — dedup table. One row per `(source_id, guid_hash)`.
 *
 * `guid_hash` is the lowercase hex SHA-256 of either the feed item's
 * `guid` / `id` (when present and stable) or, as a fallback, the
 * concatenation of `link\n title`. Keeping the unique key narrow lets
 * MySQL's default 3072-byte index prefix limit cover any reasonable
 * source. Soft / hard deletion of a `feed_sources` row cascades.
 */
export const feedItemsSeenTable = mysqlTable(
  "feed_items_seen",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceId: int("source_id").notNull(),
    guidHash: char("guid_hash", { length: 64 }).notNull(),
    seenAt: datetime("seen_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    postId: int("post_id"),
  },
  (t) => ({
    uniq: uniqueIndex("feed_items_seen_source_guid_unique").on(t.sourceId, t.guidHash),
    bySource: index("feed_items_seen_source_idx").on(t.sourceId),
  }),
);

export type FeedItemSeen = typeof feedItemsSeenTable.$inferSelect;

/**
 * Body validators for the feed-sources REST API. Kept here so OpenAPI
 * codegen + route validators share one shape.
 */
export const createFeedSourceSchema = z.object({
  name: z.string().trim().min(1).max(255),
  bio: z.string().trim().max(500).optional().nullable(),
  authorName: z.string().trim().min(1).max(255).optional().nullable(),
  imageUrl: z.string().trim().max(2048).optional().nullable(),
  feedUrl: z.string().trim().url().max(2048),
  siteUrl: z.string().trim().url().max(2048).optional().nullable(),
  cadence: feedCadenceSchema.default("daily"),
  enabled: z.boolean().default(true),
});

export const updateFeedSourceSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  username: z.string().trim().regex(/^[a-z0-9_]{2,30}$/, "Username must be 2–30 lowercase letters, numbers, or underscores").optional().nullable(),
  bio: z.string().trim().max(500).optional().nullable(),
  authorName: z.string().trim().min(1).max(255).optional().nullable(),
  imageUrl: z.string().trim().max(2048).optional().nullable(),
  feedUrl: z.string().trim().url().max(2048).optional(),
  siteUrl: z.string().trim().url().max(2048).optional().nullable(),
  cadence: feedCadenceSchema.optional(),
  enabled: z.boolean().optional(),
});

export type CreateFeedSourceInput = z.infer<typeof createFeedSourceSchema>;
export type UpdateFeedSourceInput = z.infer<typeof updateFeedSourceSchema>;

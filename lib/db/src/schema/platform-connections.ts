import { mysqlTable, varchar, datetime, int, text, json, uniqueIndex, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users.ts";

export const platformConnectionsTable = mysqlTable(
  "platform_connections",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // confirmed enum: wordpress_com | wordpress_self | medium | blogger | substack | bluesky | linkedin | facebook | instagram
    platform: varchar("platform", { length: 32 }).notNull(),
    // AES-256-GCM payload: "<iv_b64>.<tag_b64>.<ciphertext_b64>"
    encryptedAccessToken: text("encrypted_access_token"),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    expiresAt: datetime("expires_at", { mode: "string", fsp: 3 }),
    // Platform-specific fields: { blogUrl?, siteUrl?, blogId?, authorId? }
    metadata: json("metadata"),
    enabled: int("enabled").notNull().default(1),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    // One connection per (user, platform) — reconnecting replaces the row.
    userPlatformUnique: uniqueIndex("platform_connections_user_platform_unique").on(
      table.userId,
      table.platform,
    ),
    userIdx: index("platform_connections_user_idx").on(table.userId),
  }),
);

export type PlatformConnection = typeof platformConnectionsTable.$inferSelect;
export type InsertPlatformConnection = typeof platformConnectionsTable.$inferInsert;

import { mysqlTable, varchar, text, int, datetime, boolean, uniqueIndex } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * `pages` — standalone CMS-style pages addressed at `/p/:slug`.
 * Orthogonal to `posts`: no FK reuse, no inclusion in feeds/search.
 * Title and slug are independent columns; the slug is the URL key.
 */
export const pagesTable = mysqlTable(
  "pages",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 96 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull(),
    contentFormat: varchar("content_format", { length: 16 }).notNull().default("html"),
    contentText: text("content_text"),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    authorUserId: varchar("author_user_id", { length: 191 }),
    showInNav: boolean("show_in_nav").notNull().default(true),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => ({
    slugUnique: uniqueIndex("pages_slug_unique").on(t.slug),
  }),
);

export type Page = typeof pagesTable.$inferSelect;
export type InsertPage = typeof pagesTable.$inferInsert;

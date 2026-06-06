import { mysqlTable, varchar, text, int, datetime, uniqueIndex, primaryKey, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * `categories` — owner-managed taxonomy. Each post may belong to zero or
 * more categories via the `post_categories` join table. Slugs are the
 * canonical addressable identifier (`/categories/:slug`); names are the
 * human label shown in chips and management UI.
 */
export const categoriesTable = mysqlTable(
  "categories",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 191 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => ({
    slugUnique: uniqueIndex("categories_slug_unique").on(t.slug),
  }),
);

export type Category = typeof categoriesTable.$inferSelect;
export type InsertCategory = typeof categoriesTable.$inferInsert;

/**
 * `post_categories` — many-to-many join. Composite PK ensures a post is
 * never assigned the same category twice; the secondary index on
 * `category_id` powers the `/categories/:slug/posts` lookup and the
 * `categories` slug filter on `/api/posts/search` without a table scan.
 */
export const postCategoriesTable = mysqlTable(
  "post_categories",
  {
    postId: int("post_id").notNull(),
    categoryId: int("category_id").notNull(),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.postId, t.categoryId] }),
    byCategory: index("post_categories_category_idx").on(t.categoryId),
  }),
);

export type PostCategory = typeof postCategoriesTable.$inferSelect;
export type InsertPostCategory = typeof postCategoriesTable.$inferInsert;

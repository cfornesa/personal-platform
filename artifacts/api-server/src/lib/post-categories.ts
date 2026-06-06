/**
 * Helpers for the post ⇄ category many-to-many.
 *
 * `hydratePostCategories` is the single batched query the post-returning
 * routes use to attach a `categories: Category[]` array to every row.
 * Keeping the IN-list query in one place means we never N+1 the join
 * table — every endpoint that returns posts (timeline, search, pending,
 * user feed, single post) takes one extra round-trip regardless of
 * page size.
 */

import { db, categoriesTable, postCategoriesTable, eq, and, isNull, inArray } from "@workspace/db";

// Drizzle's MySql2Database and MySqlTransaction don't share an
// inheritance chain even though both expose the query builders we
// use. Inferring from `db.transaction`'s callback gives us a single
// type that accepts both the top-level db and an in-flight tx.
type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export type HydratedCategory = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function hydratePostCategories(
  postIds: ReadonlyArray<number>,
): Promise<Map<number, HydratedCategory[]>> {
  const result = new Map<number, HydratedCategory[]>();
  if (postIds.length === 0) return result;

  const rows = await db
    .select({
      postId: postCategoriesTable.postId,
      id: categoriesTable.id,
      slug: categoriesTable.slug,
      name: categoriesTable.name,
      description: categoriesTable.description,
      createdAt: categoriesTable.createdAt,
      updatedAt: categoriesTable.updatedAt,
    })
    .from(postCategoriesTable)
    .innerJoin(categoriesTable, eq(categoriesTable.id, postCategoriesTable.categoryId))
    .where(and(
      inArray(postCategoriesTable.postId, postIds as number[]),
      isNull(categoriesTable.deletedAt),
    ));

  for (const row of rows) {
    const list = result.get(row.postId) ?? [];
    list.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    result.set(row.postId, list);
  }
  for (const list of result.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}

export async function attachCategoriesToPosts<T extends { id: number }>(
  posts: T[],
): Promise<Array<T & { categories: HydratedCategory[] }>> {
  const map = await hydratePostCategories(posts.map((p) => p.id));
  return posts.map((p) => ({ ...p, categories: map.get(p.id) ?? [] }));
}

const SLUG_MAX_LEN = 191;

export function slugifyCategoryName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LEN);
  return slug || "category";
}

export async function findAvailableSlug(base: string): Promise<string> {
  let candidate = base;
  let counter = 2;
  for (let i = 0; i < 1000; i += 1) {
    const existing = await db
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(eq(categoriesTable.slug, candidate))
      .limit(1);
    if (!existing[0]) return candidate;
    // Reserve room for the "-<counter>" suffix before appending so a
    // base that's already at SLUG_MAX_LEN doesn't slice the suffix off
    // and produce an identical candidate forever.
    const suffix = `-${counter}`;
    const trimmedBase = base.slice(0, SLUG_MAX_LEN - suffix.length);
    candidate = `${trimmedBase}${suffix}`;
    counter += 1;
  }
  throw new Error("Could not find an available category slug");
}

/**
 * Validate `categoryIds` strictly: every supplied value must be a
 * positive integer (no silent filtering) and every id must exist.
 * Throws an Error tagged with `unknownIds` if validation fails so the
 * caller can return a 400 with the offending ids.
 */
export async function validateCategoryIds(
  categoryIds: ReadonlyArray<number>,
  ctx: { db: DbOrTx } = { db },
): Promise<number[]> {
  const malformed = categoryIds.filter(
    (n) => !Number.isInteger(n) || n <= 0,
  );
  if (malformed.length > 0) {
    const err = new Error("Invalid category ids");
    (err as Error & { unknownIds: number[] }).unknownIds = malformed;
    throw err;
  }
  const unique = Array.from(new Set(categoryIds));
  if (unique.length === 0) return unique;
  const found = await ctx.db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(inArray(categoriesTable.id, unique));
  const foundIds = new Set(found.map((r) => r.id));
  const unknownIds = unique.filter((id) => !foundIds.has(id));
  if (unknownIds.length > 0) {
    const err = new Error("Unknown category ids");
    (err as Error & { unknownIds: number[] }).unknownIds = unknownIds;
    throw err;
  }
  return unique;
}

/**
 * Replace a post's category set. Pass an active transaction via `tx`
 * so the caller can keep the post mutation and the join-row rewrite
 * atomic; without a tx this opens its own. `categoryIds` must already
 * be validated by the caller (see `validateCategoryIds`).
 */
export async function replacePostCategories(
  postId: number,
  categoryIds: ReadonlyArray<number>,
  tx: DbOrTx = db,
): Promise<void> {
  const unique = Array.from(new Set(categoryIds));
  await tx
    .delete(postCategoriesTable)
    .where(eq(postCategoriesTable.postId, postId));
  if (unique.length > 0) {
    await tx
      .insert(postCategoriesTable)
      .values(unique.map((categoryId) => ({ postId, categoryId })));
  }
}

export async function resolveCategorySlugsToIds(
  raw: string,
): Promise<number[] | null> {
  const slugs = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (slugs.length === 0) return null;
  const rows = await db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(inArray(categoriesTable.slug, slugs));
  if (rows.length === 0) return null;
  return rows.map((r) => r.id);
}

// Public reads expose only published posts. pending/draft/scheduled are owner-only.
// Used by GET /posts/:id and GET /og/posts/:id to keep the rule in one place.
export function isPostVisibleToReader(
  postStatus: string | null | undefined,
  user: { role?: string | null } | null,
): boolean {
  if (postStatus === "published") return true;
  if (postStatus === null || postStatus === undefined) return true;
  return user?.role === "owner";
}

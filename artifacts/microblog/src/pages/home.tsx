import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listPosts, useListCategories, useListPublicFeedSources } from "@workspace/api-client-react";
import { PostCard } from "@/components/post/PostCard";
import { PostEditor } from "@/components/post/PostEditor";
import { FeedStatsWidget } from "@/components/layout/FeedStatsWidget";
import { MiniProfile } from "@/components/layout/MiniProfile";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useSiteSettings } from "@/hooks/use-site-settings";
import type { Post } from "@workspace/api-client-react";

const PAGE_SIZE = 5;

type SortMode = "newest" | "oldest" | "most-commented";
type FilterMode = "all" | "has-comments" | "has-media" | "rich-posts";
type CategoryFilter = "all" | "uncategorized" | string;
type SourceFilter = "all" | "original" | string;

function postHasMedia(post: Post) {
  if (post.contentFormat !== "html") {
    return false;
  }

  return /<(img|iframe)\b/i.test(post.content);
}

export default function Home() {
  const { isAuthenticated } = useCurrentUser();
  const { data: siteSettings } = useSiteSettings();
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const { data: categoriesData } = useListCategories();
  const { data: sourcesData } = useListPublicFeedSources();
  const categories = categoriesData?.categories ?? [];
  const sources = sourcesData?.sources ?? [];

  const apiCategory = categoryFilter !== "all" ? categoryFilter : undefined;
  const apiSource = sourceFilter !== "all" ? sourceFilter : undefined;

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["listPosts", { category: apiCategory, source: apiSource }],
    queryFn: ({ pageParam }) =>
      listPosts({
        page: pageParam as number,
        limit: PAGE_SIZE,
        ...(apiCategory ? { category: apiCategory } : {}),
        ...(apiSource ? { source: apiSource } : {}),
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.limit < lastPage.total
        ? lastPage.page + 1
        : undefined,
  });

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const [scrollToId] = useState<string | null>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get("scrollTo") ||
      (window.location.hash.startsWith("#post-") ? window.location.hash.slice(1) : null);
  });

  const allLoadedPosts = data?.pages.flatMap((p) => p.posts) ?? [];

  const targetPostId = scrollToId?.startsWith("post-")
    ? parseInt(scrollToId.replace("post-", ""), 10)
    : NaN;
  const isTargetLoaded = !isNaN(targetPostId) && allLoadedPosts.some((p) => p.id === targetPostId);

  useEffect(() => {
    if (!scrollToId?.startsWith("post-") || isTargetLoaded || isLoading || !hasNextPage || isFetchingNextPage) return;
    fetchNextPage();
  }, [scrollToId, isTargetLoaded, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (!scrollToId?.startsWith("post-") || !isTargetLoaded || hasScrolledRef.current) return;
    const el = document.getElementById(scrollToId);
    if (!el) return;
    hasScrolledRef.current = true;
    const scrollToEl = () => document.getElementById(scrollToId)?.scrollIntoView({ block: "start" });
    scrollToEl();
    const t1 = setTimeout(scrollToEl, 80);
    const t2 = setTimeout(scrollToEl, 200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [scrollToId, isTargetLoaded]);

  const visiblePosts = useMemo(() => {
    const basePosts = [...allLoadedPosts];

    const filteredPosts = basePosts.filter((post) => {
      switch (filterMode) {
        case "has-comments":
          return post.commentCount > 0;
        case "has-media":
          return postHasMedia(post);
        case "rich-posts":
          return post.contentFormat === "html";
        case "all":
        default:
          return true;
      }
    });

    filteredPosts.sort((left, right) => {
      switch (sortMode) {
        case "oldest":
          return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        case "most-commented":
          if (right.commentCount !== left.commentCount) {
            return right.commentCount - left.commentCount;
          }
          return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        case "newest":
        default:
          return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      }
    });

    return filteredPosts;
  }, [filterMode, allLoadedPosts, sortMode]);

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
        <main className="space-y-6">
          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            {isAuthenticated ? (
              <PostEditor />
            ) : null}

            {!isAuthenticated ? (
              <div className="border-b border-border bg-primary/5 p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    <line x1="9" y1="10" x2="15" y2="10"/>
                    <line x1="9" y1="14" x2="15" y2="14"/>
                  </svg>
                </div>
                <h2 className="font-serif text-2xl font-bold tracking-tight text-foreground mb-2">{siteSettings?.heroHeading ?? ""}</h2>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">{siteSettings?.heroSubheading ?? ""}</p>
                <Button asChild className="rounded-full px-8 font-semibold shadow-sm">
                  <Link href={siteSettings?.ctaHref ?? "#"}>{siteSettings?.ctaLabel ?? "Learn More"}</Link>
                </Button>
              </div>
            ) : null}

            {!isLoading ? (
              <div className="border-b border-border bg-muted/20 px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Posts</p>
                    <p className="text-sm text-muted-foreground">
                      Sort and filter through my posts.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Sort</span>
                      <select
                        value={sortMode}
                        onChange={(event) => setSortMode(event.target.value as SortMode)}
                        className="min-w-[170px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus:border-primary"
                      >
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                        <option value="most-commented">Most Commented</option>
                      </select>
                    </label>

                    <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Filter</span>
                      <select
                        value={filterMode}
                        onChange={(event) => setFilterMode(event.target.value as FilterMode)}
                        className="min-w-[170px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus:border-primary"
                      >
                        <option value="all">All Posts</option>
                        <option value="has-comments">Has Comments</option>
                        <option value="has-media">Has Media</option>
                        <option value="rich-posts">Rich Posts</option>
                      </select>
                    </label>

                    {categories.length > 0 && (
                      <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Category</span>
                        <select
                          value={categoryFilter}
                          onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
                          className="min-w-[170px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus:border-primary"
                        >
                          <option value="all">All Categories</option>
                          <option value="uncategorized">Uncategorized</option>
                          {categories.map((cat) => (
                            <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Source</span>
                      <select
                        value={sourceFilter}
                        onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
                        className="min-w-[170px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus:border-primary"
                      >
                        <option value="all">All Sources</option>
                        <option value="original">Original</option>
                        {sources.map((src) => (
                          <option key={src.id} value={String(src.id)}>{src.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            {isLoading ? (
              <div role="status" aria-label="Loading posts" className="divide-y divide-border/50">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="p-6 space-y-4 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-muted"></div>
                      <div className="space-y-2">
                        <div className="h-4 w-24 bg-muted rounded"></div>
                        <div className="h-3 w-16 bg-muted rounded"></div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-4 w-full bg-muted rounded"></div>
                      <div className="h-4 w-2/3 bg-muted rounded"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : allLoadedPosts.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <p>No posts yet. It's quiet here...</p>
              </div>
            ) : visiblePosts.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <p>No posts match that filter yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {visiblePosts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>
            )}

            <div ref={sentinelRef} />

            {isFetchingNextPage && (
              <div aria-live="polite" role="status" className="p-6 text-center text-sm text-muted-foreground animate-pulse">
                Loading more posts…
              </div>
            )}
          </div>
        </main>

        <aside className="space-y-6 mt-8 lg:mt-0">
          {isAuthenticated ? (
            <MiniProfile />
          ) : null}

          <FeedStatsWidget />

          <div className="rounded-2xl bg-muted/50 p-6 text-sm text-muted-foreground">
            <h3 className="font-semibold text-foreground mb-2">{siteSettings?.aboutHeading ?? ""}</h3>
            <p className="whitespace-pre-line">{siteSettings?.aboutBody ?? ""}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

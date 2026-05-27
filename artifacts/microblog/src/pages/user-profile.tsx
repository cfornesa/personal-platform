import { useRoute, Link } from "wouter";
import {
  useGetPostsByUser,
  getGetPostsByUserQueryKey,
  useGetUser,
  getGetUserQueryKey,
  useListPosts,
  getListPostsQueryKey,
} from "@workspace/api-client-react";
import { PostCard } from "@/components/post/PostCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, FileText, Globe, Instagram, Youtube, Twitter, Music2, Tv, Github, Linkedin, Rss } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserThemeScope } from "@/components/layout/UserThemeScope";

export default function UserProfile() {
  const [, params] = useRoute("/users/:userId");
  const rawUserId = params?.userId;

  // Strip leading @ for username lookups
  const profileId = rawUserId?.startsWith("@") ? rawUserId.substring(1) : rawUserId;

  const { data: user, isLoading: isUserLoading, error: userError } = useGetUser(profileId as string, {
    query: {
      queryKey: getGetUserQueryKey(profileId as string),
      enabled: !!profileId
    }
  });

  const isFeedSource = user?.sourceType === "feed";

  // Extract numeric source ID from "feed:N" for the source filter
  const feedSourceId = isFeedSource
    ? (user.id.startsWith("feed:") ? user.id.slice(5) : null)
    : null;

  // Human user posts
  const { data: userPostsPage, isLoading: isUserPostsLoading } = useGetPostsByUser(
    user?.id as string,
    { page: 1, limit: 50 },
    {
      query: {
        queryKey: getGetPostsByUserQueryKey(user?.id as string, { page: 1, limit: 50 }),
        enabled: !!user?.id && !isFeedSource,
      },
    }
  );

  // Feed source posts — uses the existing source filter on GET /api/posts
  const { data: feedPostsPage, isLoading: isFeedPostsLoading } = useListPosts(
    { source: feedSourceId ?? undefined, page: 1, limit: 50 },
    {
      query: {
        queryKey: getListPostsQueryKey({ source: feedSourceId ?? undefined, page: 1, limit: 50 }),
        enabled: isFeedSource && !!feedSourceId,
      },
    }
  );

  const postsPage = isFeedSource ? feedPostsPage : userPostsPage;
  const isPostsLoading = isFeedSource ? isFeedPostsLoading : isUserPostsLoading;

  if (!profileId || userError) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">User not found</h1>
        <Button asChild variant="outline">
          <Link href="/">Back to feed</Link>
        </Button>
      </div>
    );
  }

  const socialLinks = (user?.socialLinks as Record<string, string>) || {};
  const displayUrl = (user?.siteUrl ?? user?.website) || null;

  return (
    <UserThemeScope user={user}>
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Button asChild variant="ghost" className="gap-2 -ml-4 hover:bg-transparent hover:text-primary">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <div className="mb-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
        {isUserLoading ? (
          <div role="status" aria-label="Loading profile" className="flex items-center gap-6 animate-pulse">
            <div className="h-20 w-20 rounded-full bg-muted"></div>
            <div className="space-y-3">
              <div className="h-8 w-48 bg-muted rounded"></div>
              <div className="h-4 w-24 bg-muted rounded"></div>
            </div>
          </div>
        ) : user ? (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-6">
                <Avatar className="h-20 w-20 border-4 border-background shadow-sm">
                  <AvatarImage src={user.imageUrl || undefined} alt={user.name} />
                  <AvatarFallback className="bg-primary/10 text-primary text-2xl font-bold">
                    {isFeedSource
                      ? <Rss className="h-8 w-8" />
                      : user.name.charAt(0).toUpperCase()
                    }
                  </AvatarFallback>
                </Avatar>

                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-3xl font-bold font-serif tracking-tight text-foreground">{user.name}</h1>
                    {isFeedSource && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        <Rss className="h-3 w-3" />
                        Automated feed
                      </span>
                    )}
                  </div>
                  {user.username && (
                    <p className="text-muted-foreground font-medium">@{user.username}</p>
                  )}

                  {displayUrl && (
                    <div className="mt-2">
                      <a
                        href={displayUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-primary hover:underline transition-colors text-sm font-medium"
                      >
                        <Globe className="h-4 w-4" />
                        <span>
                          {displayUrl.replace(/^https?:\/\//, '')}
                        </span>
                      </a>
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-4 text-muted-foreground text-sm">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-4 w-4" />
                      <span className="font-medium">{user.postCount} {user.postCount === 1 ? 'post' : 'posts'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {!isFeedSource && Object.keys(socialLinks).length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {socialLinks.instagram && (
                  <Button variant="ghost" size="icon" asChild className="h-9 w-9 rounded-full hover:text-primary hover:bg-primary/10">
                    <a href={socialLinks.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                      <Instagram className="h-5 w-5" />
                    </a>
                  </Button>
                )}
                {socialLinks.twitter && (
                  <Button variant="ghost" size="icon" asChild className="h-9 w-9 rounded-full hover:text-primary hover:bg-primary/10">
                    <a href={socialLinks.twitter} target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)">
                      <Twitter className="h-5 w-5" />
                    </a>
                  </Button>
                )}
                {socialLinks.youtube && (
                  <Button variant="ghost" size="icon" asChild className="h-9 w-9 rounded-full hover:text-primary hover:bg-primary/10">
                    <a href={socialLinks.youtube} target="_blank" rel="noopener noreferrer" aria-label="YouTube">
                      <Youtube className="h-5 w-5" />
                    </a>
                  </Button>
                )}
                {socialLinks.tiktok && (
                  <Button variant="ghost" size="icon" asChild className="h-9 w-9 rounded-full hover:text-primary hover:bg-primary/10">
                    <a href={socialLinks.tiktok} target="_blank" rel="noopener noreferrer" aria-label="TikTok">
                      <Music2 className="h-5 w-5" />
                    </a>
                  </Button>
                )}
                {socialLinks.twitch && (
                  <Button variant="ghost" size="icon" asChild className="h-9 w-9 rounded-full hover:text-primary hover:bg-primary/10">
                    <a href={socialLinks.twitch} target="_blank" rel="noopener noreferrer" aria-label="Twitch">
                      <Tv className="h-5 w-5" />
                    </a>
                  </Button>
                )}
                {socialLinks.github && (
                  <Button variant="ghost" size="icon" asChild className="h-9 w-9 rounded-full hover:text-primary hover:bg-primary/10">
                    <a href={socialLinks.github} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                      <Github className="h-5 w-5" />
                    </a>
                  </Button>
                )}
                {socialLinks.linkedin && (
                  <Button variant="ghost" size="icon" asChild className="h-9 w-9 rounded-full hover:text-primary hover:bg-primary/10">
                    <a href={socialLinks.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
                      <Linkedin className="h-5 w-5" />
                    </a>
                  </Button>
                )}
              </div>
            )}

            {user.bio && (
              <div className="text-foreground leading-relaxed whitespace-pre-wrap pt-2">
                {user.bio}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm" data-testid="user-posts-section">
        <div className="border-b border-border bg-muted/30 px-6 py-4">
          <h2 className="font-serif text-xl font-bold tracking-tight">Recent Posts</h2>
        </div>

        {isPostsLoading ? (
          <div role="status" aria-label="Loading posts" className="divide-y divide-border">
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
        ) : postsPage?.posts.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p>{isFeedSource ? "No posts imported from this feed yet." : "This user hasn't posted anything yet."}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {postsPage?.posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </div>
    </UserThemeScope>
  );
}

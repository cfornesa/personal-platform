import { Link, useLocation } from "wouter";
import { MessageCircle, Pencil, Trash2, Maximize, Code, Share2, Rss, ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatPostDate } from "@/lib/format-date";
import type { Post, PostWithComments, PostsPage } from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useDeletePost,
  useUpdatePost,
  useUploadMedia,
  getListPostsQueryKey,
  getGetPostQueryKey,
  getGetPostsByUserQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useOwnerAiVendors } from "@/hooks/use-owner-ai-vendors";
import { useEnabledPlatformConnections } from "@/hooks/use-enabled-platform-connections";
import { ImmersiveMediaFrame } from "@/components/immersive/ImmersiveMediaFrame";
import { buildImmersiveImageHref } from "@/lib/immersive-view";
import { PostContent } from "./PostContent";
import { RichPostEditor } from "./RichPostEditor";
import { getUploadErrorMessage } from "./upload-error";
import { SharePostDialog } from "./SharePostDialog";
import { PostCategoryChips } from "./PostCategoryChips";

const PLATFORM_LABELS: Record<string, string> = {
  wordpress_com: "WordPress.com",
  wordpress_self: "WordPress",
  medium: "Medium",
  blogger: "Blogger",
  substack: "Substack",
};

interface PostCardProps {
  post: Post;
  isDetail?: boolean;
  /**
   * Optional search query carried over from `/search`. When set, the
   * rendered post body highlights matching tokens with `<mark>`. The
   * highlight is purely visual — the stored post HTML is never altered.
   */
  highlightQuery?: string | null;
}

type DisplayPostWithFeaturedImageMeta = Post & {
  featuredImageUrl?: string | null;
  featuredImageTitle?: string | null;
  featuredImageAltText?: string | null;
};

export function PostCard({ post, isDetail = false, highlightQuery }: PostCardProps) {
  const { currentUser, isOwner } = useCurrentUser();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { aiVendors, pieceVendors, preferredVendorAltText } = useOwnerAiVendors();
  const { connections: platformConnections } = useEnabledPlatformConnections();
  const [displayPost, setDisplayPost] = useState(post);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(post.content);

  const mergePost = (base: Post, patch: Partial<Post>): Post => ({
    ...base,
    ...patch,
    authorId: patch.authorId ?? base.authorId,
    authorName: patch.authorName ?? base.authorName,
    authorImageUrl: patch.authorImageUrl ?? base.authorImageUrl,
    content: patch.content ?? base.content,
    contentFormat: patch.contentFormat ?? base.contentFormat,
    commentCount: patch.commentCount ?? base.commentCount,
    createdAt: patch.createdAt ?? base.createdAt,
  });

  useEffect(() => {
    setDisplayPost((prev) =>
      prev.id === post.id &&
      prev.content === post.content &&
      prev.contentFormat === post.contentFormat
        ? prev
        : post,
    );
  }, [post]);

  const deletePost = useDeletePost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["listPosts"] });
        if (currentUser) {
          queryClient.invalidateQueries({ queryKey: getGetPostsByUserQueryKey(currentUser.id) });
        }
        toast({ title: "Post deleted" });
      },
      onError: () => {
        setIsDeleting(false);
        toast({ title: "Failed to delete post", variant: "destructive" });
      }
    }
  });

  const updatePost = useUpdatePost({
    mutation: {
      onSuccess: (updatedPost) => {
        setDisplayPost((existing) => mergePost(existing, updatedPost));
        queryClient.setQueriesData(
          { queryKey: getListPostsQueryKey() },
          (existing: PostsPage | undefined) =>
            existing
              ? {
                  ...existing,
                  posts: existing.posts.map((candidate) =>
                    candidate.id === updatedPost.id ? mergePost(candidate, updatedPost) : candidate,
                  ),
                }
              : existing,
        );

        if (currentUser) {
          queryClient.setQueriesData(
            { queryKey: getGetPostsByUserQueryKey(currentUser.id) },
            (existing: PostsPage | undefined) =>
              existing
                ? {
                    ...existing,
                    posts: existing.posts.map((candidate) =>
                      candidate.id === updatedPost.id ? mergePost(candidate, updatedPost) : candidate,
                    ),
                  }
                : existing,
          );
        }

        queryClient.setQueryData(
          getGetPostQueryKey(post.id),
          (existing: PostWithComments | undefined) =>
            existing
              ? {
                  ...existing,
                  post: mergePost(existing.post, updatedPost),
                }
              : existing,
        );

        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["listPosts"] });
        queryClient.invalidateQueries({ queryKey: getGetPostQueryKey(post.id) });
        if (currentUser) {
          queryClient.invalidateQueries({ queryKey: getGetPostsByUserQueryKey(currentUser.id) });
        }
        toast({ title: "Post updated" });
      },
      onError: () => {
        toast({ title: "Failed to update post", variant: "destructive" });
      },
    },
  });

  const uploadMedia = useUploadMedia({
    mutation: {
      onError: (error) => {
        toast({
          title: "Failed to upload image",
          description: getUploadErrorMessage(error),
          variant: "destructive",
        });
      },
    },
  });

  useEffect(() => {
    if (!isEditing) {
      setDraftContent(displayPost.content);
    }
  }, [displayPost.content, isEditing]);

  const handleDelete = () => {
    setIsDeleting(true);
    deletePost.mutate({ id: displayPost.id });
  };

  const handleEmbed = (event: React.MouseEvent) => {
    event.stopPropagation();
    const embedUrl = `${window.location.origin}/embed/posts/${displayPost.id}`;
    const iframeCode = `<iframe src="${embedUrl}" width="100%" height="400" frameborder="0" style="border: 1px solid #e5e7eb; border-radius: 12px;"></iframe>`;
    
    navigator.clipboard.writeText(iframeCode).then(() => {
      toast({ 
        title: "Embed code copied", 
        description: "Iframe code is ready to paste." 
      });
    }).catch(() => {
      toast({ 
        title: "Failed to copy", 
        description: "Please copy the URL manually: " + embedUrl,
        variant: "destructive"
      });
    });
  };

  const isOwnerAuthorPost =
    isOwner &&
    (currentUser?.id === displayPost.authorId ||
      currentUser?.id === (displayPost as Post & { authorUserId?: string | null }).authorUserId);

  // Owner controls (edit + delete) apply to imported posts too.
  const isFeedImportedPost = Boolean(
    (displayPost as Post & { sourceFeedId?: number | null }).sourceFeedId,
  );
  const sourceCanonicalUrl =
    (displayPost as Post & { sourceCanonicalUrl?: string | null }).sourceCanonicalUrl ?? null;
  const sourceFeedName =
    (displayPost as Post & { sourceFeedName?: string | null }).sourceFeedName ?? null;

  // For imported posts, show the blog name in the byline. The feed item's
  // individual author (authorName) is shown in the attribution line instead.
  const bylineName = isFeedImportedPost && sourceFeedName
    ? sourceFeedName
    : displayPost.authorName;

  // Show "by <author> via <blog>" when the recorded authorName differs from
  // the source blog name — i.e., the feed item declared its own author or the
  // owner set a custom author override. Falls back to "via <blog>" when they
  // are identical (no individual author info worth surfacing separately).
  const feedItemAuthor =
    isFeedImportedPost &&
    sourceFeedName &&
    displayPost.authorName !== sourceFeedName
      ? displayPost.authorName
      : null;

  const canDelete = isOwnerAuthorPost || (isOwner && isFeedImportedPost);
  const canEdit = isOwnerAuthorPost || (isOwner && isFeedImportedPost);

  const handleCommentClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (isDetail) {
      document.getElementById(`comments-${displayPost.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    setLocation(`/posts/${displayPost.id}`);
  };

  const handleEditStart = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setDraftContent(displayPost.content);
    setIsEditing(true);
  };

  const content = (
    <div className={`group relative flex gap-4 p-5 sm:p-6 transition-colors ${!isDetail && !isDeleting && !isEditing ? "hover:bg-accent/30" : ""} ${isDeleting ? "opacity-50 scale-95 transition-all duration-300" : "transition-all duration-300"}`}>
      <Link href={`/users/${displayPost.authorId}`} className="shrink-0 z-10" onClick={(e) => e.stopPropagation()}>
        <Avatar className="h-10 w-10 border border-border ring-2 ring-transparent transition-all group-hover:ring-primary/20">
          <AvatarImage src={displayPost.authorImageUrl || undefined} alt={bylineName} />
          <AvatarFallback className="bg-primary/10 text-primary font-medium">
            {(bylineName?.charAt(0) || "U").toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>

      <div className="flex-1 space-y-2 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={`/users/${displayPost.authorId}`}
              className="font-semibold text-foreground hover:underline z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {bylineName}
            </Link>
            <span className="text-muted-foreground text-xs font-medium">·</span>
            <span className="text-muted-foreground text-xs" title={new Date(displayPost.createdAt).toLocaleString()}>
              {formatPostDate(displayPost.createdAt)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {!isEditing && !isDetail ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 z-10 transition-colors order-last group-hover:order-first"
                onClick={(e) => {
                  e.stopPropagation();
                  setLocation(`/posts/${displayPost.id}`);
                }}
                disabled={isDeleting}
              >
                <Maximize className="h-4 w-4" />
                <span className="sr-only">Expand post</span>
              </Button>
            ) : null}

            {canEdit && !isEditing ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 z-10 transition-opacity order-1"
                onClick={handleEditStart}
                disabled={isDeleting}
              >
                <Pencil className="h-4 w-4" />
                <span className="sr-only">Edit post</span>
              </Button>
            ) : null}

            {canDelete && !isEditing ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 z-10 transition-opacity order-2"
                    onClick={(e) => e.stopPropagation()}
                    disabled={isDeleting}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete post</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent onClick={(e: React.MouseEvent) => e.stopPropagation()} className="z-[100]">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this post?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete your post and all its comments.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
        </div>

        <PostCategoryChips categories={(displayPost as Post & { categories?: { id: number; slug: string; name: string; description: string | null; createdAt: string; updatedAt: string }[] }).categories ?? null} />

        {isFeedImportedPost ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Rss className="h-3 w-3" />
            <span>
              {feedItemAuthor ? (
                <>by <span className="font-medium text-foreground">{feedItemAuthor}</span>{" "}via{" "}</>
              ) : "via "}
              <span className="font-medium text-foreground">{sourceFeedName ?? displayPost.authorName}</span>
            </span>
            {sourceCanonicalUrl ? (
              // mf2: u-url + u-syndication on the canonical link.
              <a
                href={sourceCanonicalUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="u-url u-syndication inline-flex items-center gap-0.5 text-primary hover:underline z-10"
                onClick={(e) => e.stopPropagation()}
              >
                Read original <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        ) : null}

        {isEditing ? (
          <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
            <RichPostEditor
              initialContent={draftContent}
              initialTitle={(displayPost as Post & { title?: string | null }).title ?? ""}
              initialCategoryIds={(displayPost as Post & { categories?: { id: number }[] }).categories?.map((c) => c.id) ?? []}
              initialFeaturedImageUrl={(displayPost as Post & { featuredImageUrl?: string | null }).featuredImageUrl ?? ""}
              submitLabel="Save"
              cancelLabel="Cancel"
              isSubmitting={updatePost.isPending || uploadMedia.isPending}
              aiVendors={aiVendors}
              pieceVendors={pieceVendors}
              preferredVendorAltText={preferredVendorAltText}
              platformConnections={platformConnections}
              onCancel={() => setIsEditing(false)}
              onUpload={async (file) => {
                const uploaded = await uploadMedia.mutateAsync({ data: { file } });
                return uploaded.url;
              }}
              onSubmit={({ title, platformIds, ...payload }) => {
                setDraftContent(payload.content);
                updatePost.mutate({
                  id: displayPost.id,
                  data: {
                    ...payload,
                    title: title || undefined,
                    platformIds: platformIds.length > 0 ? platformIds : undefined,
                  },
                });
              }}
            />
          </div>
        ) : (
          <>
            {(displayPost as DisplayPostWithFeaturedImageMeta).featuredImageUrl ? (
              <ImmersiveMediaFrame
                href={buildImmersiveImageHref((displayPost as DisplayPostWithFeaturedImageMeta).featuredImageUrl!, {
                  alt:
                    (displayPost as DisplayPostWithFeaturedImageMeta).featuredImageAltText?.trim() ||
                    undefined,
                  title:
                    (displayPost as DisplayPostWithFeaturedImageMeta).featuredImageTitle?.trim() ||
                    undefined,
                })}
                label="Open featured image in immersive view"
                className="mb-2"
              >
                <img
                  src={(displayPost as DisplayPostWithFeaturedImageMeta).featuredImageUrl!}
                  alt=""
                  className="w-full rounded-xl border border-border object-cover"
                />
              </ImmersiveMediaFrame>
            ) : null}
            {(displayPost as Post & { title?: string | null }).title ? (
              <h2 className="text-lg font-semibold leading-snug mb-1">
                {(displayPost as Post & { title?: string | null }).title}
              </h2>
            ) : null}
            <PostContent
              content={displayPost.content}
              contentFormat={displayPost.contentFormat}
              highlightQuery={highlightQuery}
            />
          </>
        )}

        <div className="flex items-center gap-2 pt-2">
          <div className="flex items-center">
            {!isDetail ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="relative z-10 -ml-3 h-auto gap-1.5 rounded-full px-3 py-2 text-muted-foreground transition-colors group-hover:text-primary"
                onClick={handleCommentClick}
                disabled={isEditing}
              >
                <MessageCircle className="h-4 w-4" />
                <span className="text-xs font-medium">{displayPost.commentCount}</span>
                <span className="sr-only">View comments</span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="relative z-10 -ml-3 h-auto rounded-full px-3 py-2 text-sm font-medium text-muted-foreground"
                onClick={handleCommentClick}
                disabled={isEditing}
              >
                <MessageCircle className="mr-1.5 h-4 w-4" />
                {displayPost.commentCount} {displayPost.commentCount === 1 ? "comment" : "comments"}
              </Button>
            )}
          </div>

          {!isEditing ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="relative z-10 h-auto gap-1.5 rounded-full px-3 py-2 text-muted-foreground transition-colors hover:text-primary hover:bg-primary/10"
                onClick={handleEmbed}
                disabled={isDeleting}
              >
                <Code className="h-4 w-4" />
                <span className="hidden sm:inline text-xs font-medium uppercase tracking-tight">Embed</span>
              </Button>

              <SharePostDialog post={displayPost}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="relative z-10 h-auto gap-1.5 rounded-full px-3 py-2 text-muted-foreground transition-colors hover:text-primary hover:bg-primary/10"
                  disabled={isDeleting}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Share2 className="h-4 w-4" />
                  <span className="hidden sm:inline text-xs font-medium uppercase tracking-tight">Share</span>
                </Button>
              </SharePostDialog>
            </div>
          ) : null}
        </div>

        {(displayPost.syndications?.length ?? 0) > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pt-1 pb-1">
            {displayPost.syndications!.map((s) =>
              s.externalUrl ? (
                <a
                  key={s.platform}
                  href={s.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative z-10 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                  {PLATFORM_LABELS[s.platform] ?? s.platform}
                </a>
              ) : (
                <span key={s.platform} className="text-xs text-muted-foreground">
                  {PLATFORM_LABELS[s.platform] ?? s.platform}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (isDetail) {
    return <div className="border-b border-border bg-card">{content}</div>;
  }

  return (
    <div className={`border-b border-border bg-card relative overflow-hidden block ${isEditing ? "" : "cursor-pointer"}`}>
      {!isEditing ? (
      <Link href={`/posts/${displayPost.id}`} className="absolute inset-0 z-0">
        <span className="sr-only">View post</span>
      </Link>
      ) : null}
      {content}
    </div>
  );
}

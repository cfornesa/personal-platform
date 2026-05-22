import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPendingPosts,
  useApprovePost,
  useRejectPost,
  useApproveAllFromFeedSource,
  useUpdatePost,
  useUploadMedia,
  getListPendingPostsQueryKey,
  getListPostsQueryKey,
  getListFeedSourcesQueryKey,
  type PendingPost,
  type PendingPostsPage,
  type ProcessAiTextBodyVendor,
} from "@workspace/api-client-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useOwnerAiVendors } from "@/hooks/use-owner-ai-vendors";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { CheckCircle2, XCircle, Inbox, ExternalLink, Rss, CheckCheck, Pencil } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PostContent } from "@/components/post/PostContent";
import { RichPostEditor } from "@/components/post/RichPostEditor";
import { getUploadErrorMessage } from "@/components/post/upload-error";

function formatPubDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

type SourceGroup = {
  sourceFeedId: number | null;
  sourceFeedName: string | null;
  posts: PendingPost[];
};

function groupBySource(posts: PendingPost[]): SourceGroup[] {
  const map = new Map<string, SourceGroup>();
  for (const p of posts) {
    const key = p.sourceFeedId == null ? "manual" : `f:${p.sourceFeedId}`;
    let group = map.get(key);
    if (!group) {
      group = {
        sourceFeedId: p.sourceFeedId ?? null,
        sourceFeedName: p.sourceFeedName ?? null,
        posts: [],
      };
      map.set(key, group);
    }
    group.posts.push(p);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.sourceFeedId == null) return 1;
    if (b.sourceFeedId == null) return -1;
    return (a.sourceFeedName ?? "").localeCompare(b.sourceFeedName ?? "");
  });
}

type PendingPostCardProps = {
  post: PendingPost;
  isMutating: boolean;
  aiVendors: Array<{ id: ProcessAiTextBodyVendor; label: string }>;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
};

// Per-row component so each card owns its own edit state and editor
// instance — keeps the editor unmounted (and out of memory) for posts
// the owner isn't actively touching.
function PendingPostCard({ post, isMutating, aiVendors, onApprove, onReject }: PendingPostCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);

  const updatePost = useUpdatePost({
    mutation: {
      onSuccess: (updatedPost) => {
        // Patch the cached pending queue in place so the trimmed body
        // shows immediately without a refetch round-trip and without
        // dropping the row out of its current group.
        queryClient.setQueriesData(
          { queryKey: getListPendingPostsQueryKey() },
          (existing: PendingPostsPage | undefined) =>
            existing
              ? {
                  ...existing,
                  posts: existing.posts.map((candidate) =>
                    candidate.id === updatedPost.id
                      ? {
                          ...candidate,
                          content: updatedPost.content,
                          contentFormat:
                            updatedPost.contentFormat as PendingPost["contentFormat"],
                        }
                      : candidate,
                  ),
                }
              : existing,
        );
        setIsEditing(false);
        toast({ title: "Edits saved", description: "Click Approve to publish." });
      },
      onError: () => toast({ title: "Failed to save edits", variant: "destructive" }),
    },
  });

  const uploadMedia = useUploadMedia({
    mutation: {
      onError: (error) => toast({
        title: "Failed to upload image",
        description: getUploadErrorMessage(error),
        variant: "destructive",
      }),
    },
  });

  const isSavingEdit = updatePost.isPending || uploadMedia.isPending;
  const disableActions = isMutating || isSavingEdit;

  return (
    <Card data-testid={`pending-post-${post.id}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <span>{post.authorName}</span>
          <span className="text-muted-foreground text-xs font-normal">
            • {formatPubDate(post.createdAt)}
          </span>
        </CardTitle>
        {post.sourceCanonicalUrl ? (
          <CardDescription>
            <a
              href={post.sourceCanonicalUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Read original <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="border-t pt-3">
          {isEditing ? (
            <RichPostEditor
              initialContent={post.content}
              submitLabel="Save edits"
              cancelLabel="Cancel"
              isSubmitting={isSavingEdit}
              aiVendors={aiVendors}
              onCancel={() => setIsEditing(false)}
              onUpload={async (file) => {
                const uploaded = await uploadMedia.mutateAsync({ data: { file } });
                return uploaded.url;
              }}
              onSubmit={(payload) => {
                updatePost.mutate({ id: post.id, data: payload });
              }}
            />
          ) : (
            <PostContent content={post.content} contentFormat={post.contentFormat} />
          )}
        </div>
        {!isEditing ? (
          <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(true)}
              disabled={disableActions}
              data-testid={`button-edit-pending-${post.id}`}
            >
              <Pencil className="mr-1.5 h-4 w-4" /> Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReject(post.id)}
              disabled={disableActions}
            >
              <XCircle className="mr-1.5 h-4 w-4" /> Reject
            </Button>
            <Button
              size="sm"
              onClick={() => onApprove(post.id)}
              disabled={disableActions}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function AdminPendingPage() {
  const { isOwner, isLoading: isUserLoading } = useCurrentUser();
  const { aiVendors } = useOwnerAiVendors();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [approvingSourceId, setApprovingSourceId] = useState<number | null>(null);

  useEffect(() => {
    if (!isUserLoading && !isOwner) {
      setLocation("/");
    }
  }, [isOwner, isUserLoading, setLocation]);

  const queue = useListPendingPosts(undefined, {
    query: { enabled: isOwner, queryKey: getListPendingPostsQueryKey() },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListPendingPostsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["listPosts"] });
    queryClient.invalidateQueries({ queryKey: getListFeedSourcesQueryKey() });
  };

  const approve = useApprovePost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Approved", description: "Now visible on the public timeline." });
        invalidate();
      },
      onError: () => toast({ title: "Approve failed", variant: "destructive" }),
    },
  });

  const reject = useRejectPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rejected", description: "Post discarded." });
        invalidate();
      },
      onError: () => toast({ title: "Reject failed", variant: "destructive" }),
    },
  });

  const approveAll = useApproveAllFromFeedSource({
    mutation: {
      onSettled: () => setApprovingSourceId(null),
      onSuccess: (data) => {
        toast({
          title:
            data.approved === 0
              ? "Nothing to approve"
              : `Approved ${data.approved} item${data.approved === 1 ? "" : "s"}`,
          description:
            data.approved === 0
              ? "No pending items from this source."
              : "Items are now visible on the public timeline.",
        });
        invalidate();
      },
      onError: () => toast({ title: "Bulk approve failed", variant: "destructive" }),
    },
  });

  const posts: PendingPost[] = queue.data?.posts ?? [];
  const total = queue.data?.total ?? 0;
  const groups = useMemo(() => groupBySource(posts), [posts]);

  if (isUserLoading) {
    return <div className="container mx-auto max-w-3xl px-4 py-16 text-center">Loading…</div>;
  }
  if (!isOwner) return null;

  const handleApproveAllFromGroup = (sourceFeedId: number) => {
    setApprovingSourceId(sourceFeedId);
    approveAll.mutate({ id: sourceFeedId });
  };

  const isMutating = approve.isPending || reject.isPending;

  return (
    <AdminLayout
      title="Review queue"
      description={
        total === 0
          ? "Nothing waiting. New items from your feed sources will appear here."
          : `${total} item${total === 1 ? "" : "s"} waiting on your approval.`
      }
    >
      <div className="space-y-8">
        {posts.length === 0 && !queue.isLoading ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Inbox className="mx-auto h-10 w-10 mb-3 opacity-30" />
              <p>Queue is empty.</p>
            </CardContent>
          </Card>
        ) : null}

        {groups.map((group) => {
          const groupKey = group.sourceFeedId == null ? "manual" : `f:${group.sourceFeedId}`;
          const groupLabel =
            group.sourceFeedId == null
              ? "Manual posts"
              : group.sourceFeedName ?? "Unknown source";
          return (
            <section key={groupKey} data-testid={`pending-group-${groupKey}`} className="space-y-3">
              <div className="flex items-center justify-between gap-3 border-b pb-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Rss className="h-4 w-4 text-muted-foreground" />
                  {groupLabel}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({group.posts.length})
                  </span>
                </h2>
                {group.sourceFeedId != null ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={approvingSourceId === group.sourceFeedId}
                        data-testid={`button-approve-all-${group.sourceFeedId}`}
                      >
                        <CheckCheck className="mr-1.5 h-4 w-4" />
                        Approve all from this source
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Approve all pending from {groupLabel}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {group.posts.length} item{group.posts.length === 1 ? "" : "s"} will be
                          published immediately and become visible on the public timeline.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleApproveAllFromGroup(group.sourceFeedId!)}
                        >
                          Approve all
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </div>

              <div className="space-y-4">
                {group.posts.map((post) => (
                  <PendingPostCard
                    key={post.id}
                    post={post}
                    isMutating={isMutating}
                    aiVendors={aiVendors}
                    onApprove={(id) => approve.mutate({ id })}
                    onReject={(id) => reject.mutate({ id })}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </AdminLayout>
  );
}

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useCreatePost,
  useUpdatePost,
  useDeletePost,
  useUploadMedia,
  getListPostsQueryKey,
  getGetDraftPostsQueryKey,
  getGetFeedStatsQueryKey,
  getGetPostsByUserQueryKey,
  type Post,
  type UpdatePostBody,
  type UpdatePostBodyStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useOwnerAiVendors } from "@/hooks/use-owner-ai-vendors";
import { useEnabledPlatformConnections } from "@/hooks/use-enabled-platform-connections";
import { RichPostEditor } from "./RichPostEditor";
import { getUploadErrorMessage } from "./upload-error";
import { DayPicker } from "react-day-picker";
import { addHours, addMinutes, format, parseISO } from "date-fns";
import { Clock, FileText, PenSquare, Send, Trash2, X } from "lucide-react";
import "react-day-picker/style.css";

type Mode = "publish" | "draft" | "schedule";

type PostEditorProps = {
  initialPost?: Post;
  initialScheduledDate?: Date;
  defaultExpanded?: boolean;
  onSuccess?: () => void;
  onClose?: () => void;
};

function buildScheduledAt(day: Date, timeStr: string): Date | null {
  const [h, m] = timeStr.split(":").map(Number);
  if (h === undefined || m === undefined) return null;
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

function statusBadgeVariant(status?: string): "default" | "secondary" | "outline" {
  if (status === "draft") return "secondary";
  if (status === "scheduled") return "outline";
  return "default";
}

function statusBadgeLabel(status?: string): string {
  if (status === "draft") return "Draft";
  if (status === "scheduled") return "Scheduled";
  return "Published";
}

function initialModeFromPost(post: Post): Mode {
  if (post.status === "scheduled") return "schedule";
  if (post.status === "draft") return "draft";
  return "publish";
}

export function PostEditor({
  initialPost,
  initialScheduledDate,
  defaultExpanded,
  onSuccess,
  onClose,
}: PostEditorProps = {}) {
  const isEditMode = !!initialPost;

  const { currentUser, isOwner } = useCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { aiVendors, pieceVendors, preferredVendorTextImprove, preferredVendorAltText } = useOwnerAiVendors();
  const { connections: platformConnections } = useEnabledPlatformConnections();

  const [isExpanded, setIsExpanded] = useState(
    isEditMode || !!initialScheduledDate || !!defaultExpanded,
  );
  const [mode, setMode] = useState<Mode>(() => {
    if (isEditMode) return initialModeFromPost(initialPost);
    return initialScheduledDate ? "schedule" : "publish";
  });
  const [scheduledDay, setScheduledDay] = useState<Date | undefined>(() => {
    if (initialScheduledDate) return initialScheduledDate;
    if (initialPost?.scheduledAt) {
      try { return parseISO(initialPost.scheduledAt); } catch { return undefined; }
    }
    return undefined;
  });
  const [scheduledTime, setScheduledTime] = useState<string>(() => {
    if (initialScheduledDate) return format(initialScheduledDate, "HH:mm");
    if (initialPost?.scheduledAt) {
      try { return format(parseISO(initialPost.scheduledAt), "HH:mm"); } catch { /* fall through */ }
    }
    return format(addMinutes(new Date(), 30), "HH:mm");
  });
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDraftPostsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["ownerPosts"] });
    queryClient.invalidateQueries({ queryKey: ["listPosts"] });
    queryClient.invalidateQueries({ queryKey: getGetFeedStatsQueryKey() });
    if (currentUser) {
      queryClient.invalidateQueries({ queryKey: getGetPostsByUserQueryKey(currentUser.id) });
    }
  }

  const createPost = useCreatePost({
    mutation: {
      onSuccess: (_data, variables) => {
        const status = (variables.data as { status?: string }).status;
        setIsExpanded(false);
        setMode("publish");
        setScheduledDay(undefined);
        setScheduleError(null);
        invalidateAll();
        const message =
          status === "draft" ? "Draft saved" :
          status === "scheduled" ? `Post scheduled for ${scheduledDay ? format(scheduledDay, "MMM d") : "later"}` :
          "Post published";
        toast({ title: message });
        onSuccess?.();
      },
      onError: () => {
        toast({ title: "Failed to save post", variant: "destructive" });
      },
    },
  });

  const updatePost = useUpdatePost({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "Post updated" });
        onClose?.();
        onSuccess?.();
      },
      onError: () => {
        toast({ title: "Failed to update post", variant: "destructive" });
      },
    },
  });

  const deletePost = useDeletePost({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "Post deleted" });
        onClose?.();
        onSuccess?.();
      },
      onError: () => {
        toast({ title: "Failed to delete post", variant: "destructive" });
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

  if (!currentUser || !isOwner) return null;
  if (isEditMode && !initialPost) return null;

  const minScheduleDate = addMinutes(new Date(), 30);
  const isRssPost = isEditMode && !!initialPost!.sourceFeedId;

  type SubmitPayload = {
    title: string;
    content: string;
    contentFormat: "html";
    categoryIds: number[];
    platformIds: number[];
    substackSendNewsletter: boolean;
    featuredImageUrl: string | null;
    socialPostDrafts: { bluesky?: string; linkedin?: string; facebook?: string; instagram?: string } | null;
  };

  function handleSubmit({ platformIds, substackSendNewsletter, title, featuredImageUrl, socialPostDrafts, ...rest }: SubmitPayload) {
    if (mode === "schedule") {
      if (!scheduledDay) { setScheduleError("Please select a date."); return; }
      const scheduledAt = buildScheduledAt(scheduledDay, scheduledTime);
      if (!scheduledAt) { setScheduleError("Please enter a valid time."); return; }
      if (scheduledAt.getTime() < Date.now() + 1_800_000) {
        setScheduleError("Scheduled time must be at least 30 minutes in the future.");
        return;
      }
      setScheduleError(null);
      if (isEditMode) {
        updatePost.mutate({
          id: initialPost!.id,
          data: {
            ...rest,
            title: title || undefined,
            platformIds: platformIds.length > 0 ? platformIds : undefined,
            status: "scheduled" as UpdatePostBodyStatus,
            scheduledAt: scheduledAt.toISOString(),
            featuredImageUrl,
            socialPostDrafts,
          } as UpdatePostBody,
        });
      } else {
        createPost.mutate({
          data: {
            ...rest,
            title: title || undefined,
            platformIds,
            substackSendNewsletter,
            status: "scheduled" as const,
            scheduledAt: scheduledAt.toISOString(),
            featuredImageUrl: featuredImageUrl ?? undefined,
            socialPostDrafts: socialPostDrafts ?? undefined,
          },
        });
      }
    } else if (mode === "draft") {
      if (isEditMode) {
        updatePost.mutate({
          id: initialPost!.id,
          data: {
            ...rest,
            title: title || undefined,
            platformIds: platformIds.length > 0 ? platformIds : undefined,
            status: "draft" as UpdatePostBodyStatus,
            featuredImageUrl,
            socialPostDrafts,
          } as UpdatePostBody,
        });
      } else {
        createPost.mutate({
          data: {
            ...rest,
            title: title || undefined,
            platformIds,
            substackSendNewsletter,
            status: "draft" as const,
            featuredImageUrl: featuredImageUrl ?? undefined,
            socialPostDrafts: socialPostDrafts ?? undefined,
          },
        });
      }
    } else {
      // publish
      if (isEditMode) {
        updatePost.mutate({
          id: initialPost!.id,
          data: {
            ...rest,
            title: title || undefined,
            platformIds: platformIds.length > 0 ? platformIds : undefined,
            status: initialPost!.status !== "published"
              ? ("published" as UpdatePostBodyStatus)
              : undefined,
            featuredImageUrl,
            socialPostDrafts,
          } as UpdatePostBody,
        });
      } else {
        createPost.mutate({
          data: {
            ...rest,
            title: title || undefined,
            platformIds,
            substackSendNewsletter,
            featuredImageUrl: featuredImageUrl ?? undefined,
            socialPostDrafts: socialPostDrafts ?? undefined,
          },
        });
      }
    }
  }

  const submitLabel =
    mode === "draft" ? "Save Draft" :
    mode === "schedule" ? "Schedule" :
    isEditMode
      ? (initialPost!.status !== "published" ? "Publish Now" : "Save")
      : "Post";

  const modeToggle = (
    <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
      <button
        type="button"
        onClick={() => { setMode("publish"); setScheduleError(null); }}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          mode === "publish" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Send className="h-3 w-3" />
        {isEditMode && initialPost!.status === "published" ? "Published" : "Publish Now"}
      </button>
      <button
        type="button"
        onClick={() => { setMode("draft"); setScheduleError(null); }}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          mode === "draft" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <FileText className="h-3 w-3" />
        Draft
      </button>
      <button
        type="button"
        onClick={() => { setMode("schedule"); setScheduleError(null); }}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          mode === "schedule" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Clock className="h-3 w-3" />
        Schedule
      </button>
    </div>
  );

  const schedulePicker = mode === "schedule" && (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <DayPicker
        mode="single"
        selected={scheduledDay}
        onSelect={setScheduledDay}
        disabled={{ before: minScheduleDate }}
        defaultMonth={scheduledDay ?? minScheduleDate}
        className="!p-0"
      />
      <div className="flex items-center gap-2 border-t border-border pt-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <label className="text-xs text-muted-foreground">Time:</label>
        <input
          type="time"
          value={scheduledTime}
          onChange={(e) => { setScheduledTime(e.target.value); setScheduleError(null); }}
          className="text-sm border border-border rounded px-2 py-0.5 bg-background"
        />
      </div>
      {scheduledDay && scheduledTime && (
        <p className="text-xs text-muted-foreground">
          Will publish on {format(scheduledDay, "EEEE, MMMM d, yyyy")} at {scheduledTime}
        </p>
      )}
      {scheduleError && <p className="text-xs text-destructive">{scheduleError}</p>}
    </div>
  );

  const richEditor = (
    <RichPostEditor
      initialContent={initialPost?.content ?? ""}
      initialTitle={initialPost?.title ?? undefined}
      initialCategoryIds={initialPost?.categories?.map((c) => c.id) ?? []}
      initialPlatformIds={initialPost?.pendingPlatformIds ?? []}
      initialFeaturedImageUrl={initialPost?.featuredImageUrl}
      initialSocialPostDrafts={initialPost?.socialPostDrafts}
      placeholder={isEditMode ? "Edit post content…" : "Publish a post with formatting, images, or embeds..."}
      submitLabel={submitLabel}
      cancelLabel="Cancel"
      isSubmitting={createPost.isPending || updatePost.isPending || uploadMedia.isPending}
      aiVendors={aiVendors}
      pieceVendors={pieceVendors}
      preferredVendorTextImprove={preferredVendorTextImprove}
      preferredVendorAltText={preferredVendorAltText}
      onCancel={() => {
        if (isEditMode) {
          onClose?.();
        } else {
          setIsExpanded(false);
          setMode("publish");
          setScheduledDay(undefined);
          setScheduleError(null);
        }
      }}
      onUpload={async (file) => {
        const uploaded = await uploadMedia.mutateAsync({ data: { file } });
        return uploaded.url;
      }}
      platformConnections={platformConnections}
      onSubmit={handleSubmit}
    />
  );

  // Edit mode: always-visible inline panel
  if (isEditMode) {
    return (
      <div className="mb-6 rounded-lg border border-border bg-card p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="min-w-0">
            <p className="text-base font-semibold truncate">
              {initialPost!.title || "Edit Post"}
            </p>
            {initialPost!.scheduledAt && initialPost!.status === "scheduled" && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Scheduled for {format(parseISO(initialPost!.scheduledAt), "MMM d, yyyy 'at' HH:mm")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={statusBadgeVariant(initialPost!.status)}>
              {statusBadgeLabel(initialPost!.status)}
            </Badge>
            {onClose && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {isRssPost ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            This is an imported RSS post and cannot be edited here.
          </div>
        ) : (
          <div className="space-y-3">
            {modeToggle}
            {schedulePicker}
            {richEditor}
            {/* Delete */}
            <div className="border-t border-border pt-3">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Delete this post?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deletePost.mutate({ id: initialPost!.id })}
                    disabled={deletePost.isPending}
                  >
                    Confirm
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete post
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Create mode: collapsible composer with avatar
  return (
    <div className="border-b border-border bg-card p-5 sm:p-6">
      <div className="flex gap-4">
        <Avatar className="h-10 w-10 shrink-0 border border-border">
          <AvatarImage src={currentUser.imageUrl || undefined} alt={currentUser.name || "User"} />
          <AvatarFallback className="bg-primary/10 text-primary font-medium">
            {currentUser.name?.charAt(0) || "U"}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          {!isExpanded ? (
            <div className="rounded-2xl border border-border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Ready to publish something new?</p>
                  <p className="text-sm text-muted-foreground">
                    Open the composer only when you want it, then write with formatting, images, and embeds.
                  </p>
                </div>
                <Button
                  type="button"
                  className="rounded-full px-5 font-semibold self-start sm:self-auto"
                  onClick={() => setIsExpanded(true)}
                >
                  <PenSquare className="mr-2 h-4 w-4" />
                  Start a post
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {modeToggle}
              {schedulePicker}
              {richEditor}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

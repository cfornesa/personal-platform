import { useState } from "react";
import {
  useListPosts,
  useGetDraftPosts,
  type Post,
  ListPostsView,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PostEditor } from "@/components/post/PostEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  addWeeks,
  startOfWeek,
  addDays,
  format,
  isSameDay,
  parseISO,
  isToday,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  CalendarDays,
} from "lucide-react";

function postDisplayDate(post: Post): Date {
  if (post.status === "scheduled" && post.scheduledAt) {
    try { return parseISO(post.scheduledAt); } catch { /* fall through */ }
  }
  return new Date(post.createdAt);
}

function StatusBadge({ post }: { post: Post }) {
  if (post.status === "draft") {
    return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Draft</Badge>;
  }
  if (post.status === "scheduled") {
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500 text-amber-700">Planned</Badge>;
  }
  if (post.sourceFeedId) {
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500 text-blue-700">Imported</Badge>;
  }
  return <Badge variant="default" className="text-[10px] px-1.5 py-0">Published</Badge>;
}

function PostCard({ post, onClick, showDay }: { post: Post; onClick: () => void; showDay?: boolean }) {
  const displayDate = postDisplayDate(post);
  const timeStr = format(displayDate, "h:mm a");
  const dayStr = format(displayDate, "EEE, MMM d");
  const isEditable = true;
  const title = post.title || (post.content.replace(/<[^>]+>/g, " ").trim().slice(0, 60) || "New Post");

  return (
    <div
      className={`group rounded border border-border bg-card px-2.5 py-2 text-xs space-y-1 ${isEditable ? "cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors" : ""}`}
      onClick={isEditable ? onClick : undefined}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="font-medium line-clamp-2 leading-snug flex-1">{title}</span>
        {isEditable && (
          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-0.5" />
        )}
      </div>
      <StatusBadge post={post} />
      <span className="text-muted-foreground block">
        {showDay ? `${dayStr} · ${timeStr}` : timeStr}
      </span>
      {post.status === "scheduled" && post.scheduledAt && !showDay && (
        <p className="text-muted-foreground">
          {format(parseISO(post.scheduledAt), "MMM d, yyyy")}
        </p>
      )}
      {post.syndications && post.syndications.length > 0 && (
        <p className="text-muted-foreground">
          Also on: {post.syndications.map((s) => s.platform.replace(/_/g, ".")).join(", ")}
        </p>
      )}
      {post.pendingPlatformIds && post.pendingPlatformIds.length > 0 && post.status !== "published" && (
        <p className="text-muted-foreground italic">Sync pending</p>
      )}
    </div>
  );
}

function DraftCard({ post, onClick }: { post: Post; onClick: () => void }) {
  const title = post.title || (post.content.replace(/<[^>]+>/g, " ").trim().slice(0, 80) || "New Post");
  const updatedAt = format(new Date(post.createdAt), "MMM d");
  return (
    <Card
      className="shrink-0 w-56 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors p-3 space-y-1.5"
      onClick={onClick}
    >
      <p className="text-sm font-medium line-clamp-2 leading-snug">{title}</p>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Draft</Badge>
        <span className="text-xs text-muted-foreground">{updatedAt}</span>
      </div>
      {post.pendingPlatformIds && post.pendingPlatformIds.length > 0 && (
        <p className="text-xs text-muted-foreground italic">Sync pending</p>
      )}
    </Card>
  );
}

function closeAll(
  setEditingPost: (p: Post | null) => void,
  setComposeOpen: (v: boolean) => void,
  setComposeForDay: (d: Date | null) => void,
) {
  setEditingPost(null);
  setComposeOpen(false);
  setComposeForDay(null);
}

export default function AdminPostsPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [composeForDay, setComposeForDay] = useState<Date | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const today = new Date();
  const weekStart = startOfWeek(addWeeks(today, weekOffset));
  const weekEnd = addDays(weekStart, 6);

  const fromStr = format(weekStart, "yyyy-MM-dd");
  const toStr = format(weekEnd, "yyyy-MM-dd");

  const { data: calendarData } = useListPosts({
    view: ListPostsView.owner,
    from: fromStr,
    to: toStr,
  });

  const { data: draftsData } = useGetDraftPosts();

  const calendarPosts = calendarData?.posts ?? [];
  const drafts = draftsData?.posts ?? [];

  const dateRange = `${format(weekStart, "MMM d")}–${format(weekEnd, "MMM d, yyyy")}`;
  const weekLabel = weekOffset === 0 ? `${dateRange} (This week)` : dateRange;

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function openEditor(post: Post) {
    closeAll(setEditingPost, setComposeOpen, setComposeForDay);
    setEditingPost(post);
  }

  function openCompose() {
    closeAll(setEditingPost, setComposeOpen, setComposeForDay);
    setComposeOpen(true);
  }

  function openComposeForDay(day: Date) {
    closeAll(setEditingPost, setComposeOpen, setComposeForDay);
    setComposeForDay(day);
  }

  const navButtons = (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setWeekOffset(0)}
        className="text-xs px-2"
        disabled={weekOffset === 0}
      >
        Today
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => setWeekOffset((o) => o - 1)}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => setWeekOffset((o) => o + 1)}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  return (
    <AdminLayout
      title="Posts"
      description="Manage drafts, schedule future posts, and view your publishing calendar."
    >
      {/* Inline post editor — shown at top whenever any post is being edited */}
      {editingPost && (
        <PostEditor
          initialPost={editingPost}
          onClose={() => setEditingPost(null)}
          onSuccess={() => setEditingPost(null)}
        />
      )}

      {/* New post composer (global) */}
      {composeOpen && (
        <PostEditor
          defaultExpanded
          onSuccess={() => setComposeOpen(false)}
          onClose={() => setComposeOpen(false)}
        />
      )}

      {/* Compose for a specific day */}
      {composeForDay && (
        <PostEditor
          initialScheduledDate={composeForDay}
          onSuccess={() => setComposeForDay(null)}
          onClose={() => setComposeForDay(null)}
        />
      )}

      {/* Drafts section */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-semibold text-sm">Drafts</h3>
          {drafts.length > 0 && (
            <Badge variant="secondary" className="text-xs">{drafts.length}</Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto text-xs"
            onClick={openCompose}
          >
            <Plus className="h-3 w-3 mr-1" />
            New Post
          </Button>
        </div>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drafts saved yet.</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {drafts.map((post) => (
              <DraftCard key={post.id} post={post} onClick={() => openEditor(post)} />
            ))}
          </div>
        )}
      </section>

      {/* Calendar section */}
      <section>
        {/* Heading row */}
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold text-sm">Calendar</h3>
        </div>

        {/* Date range + nav controls */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{weekLabel}</span>
          </div>
          {navButtons}
        </div>

        {/* Desktop: 7-column grid with per-day Schedule buttons */}
        <div className="hidden lg:grid grid-cols-7 gap-1.5 min-h-[300px]">
          {weekDays.map((day) => {
            const dayPosts = calendarPosts.filter((p) => isSameDay(postDisplayDate(p), day));
            const isTodayDay = isToday(day);

            return (
              <div key={day.toISOString()} className="flex flex-col gap-1.5">
                <div
                  className={`text-center py-1 rounded text-xs font-medium ${
                    isTodayDay
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  <div>{format(day, "EEE")}</div>
                  <div className={isTodayDay ? "" : "text-foreground font-bold"}>
                    {format(day, "d")}
                  </div>
                </div>

                <div className="flex flex-col gap-1 flex-1">
                  {dayPosts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onClick={() => openEditor(post)}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => openComposeForDay(day)}
                  className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-primary/50 rounded py-1 transition-colors"
                >
                  <Plus className="h-2.5 w-2.5" />
                  Schedule
                </button>
              </div>
            );
          })}
        </div>

        {/* Mobile/tablet: vertical list, day+time embedded in each card */}
        <div className="lg:hidden space-y-3">
          {weekDays
            .filter((day) => calendarPosts.some((p) => isSameDay(postDisplayDate(p), day)))
            .map((day) => {
              const dayPosts = calendarPosts.filter((p) => isSameDay(postDisplayDate(p), day));
              return (
                <div key={day.toISOString()} className="space-y-2">
                  {dayPosts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onClick={() => openEditor(post)}
                      showDay
                    />
                  ))}
                </div>
              );
            })}
          {calendarPosts.length === 0 && (
            <p className="text-sm text-muted-foreground">No posts this week.</p>
          )}
        </div>
      </section>
    </AdminLayout>
  );
}

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListFeedSources,
  useCreateFeedSource,
  useUpdateFeedSource,
  useDeleteFeedSource,
  useRefreshFeedSource,
  useRefreshAllFeedSources,
  useApproveAllFromFeedSource,
  useUploadFeedSourceProfilePhoto,
  getListFeedSourcesQueryKey,
  getListPendingPostsQueryKey,
  getListPostsQueryKey,
  type FeedSource,
  type CreateFeedSourceBodyCadence,
} from "@workspace/api-client-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FeaturedImagePicker } from "@/components/media/FeaturedImagePicker";
import { getUploadErrorMessage } from "@/components/post/upload-error";
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
import { Trash2, RefreshCw, Plus, Rss, ExternalLink, CheckCircle2, Pencil, X, Camera, ImageIcon } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";

const CADENCE_OPTIONS: CreateFeedSourceBodyCadence[] = ["daily", "weekly", "monthly"];
const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/avif";

function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "Never";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString();
}

export default function AdminFeedsPage() {
  const { isOwner, isLoading: isUserLoading } = useCurrentUser();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);

  // New-source form state.
  const [newName, setNewName] = useState("");
  const [newBio, setNewBio] = useState("");
  const [newAuthorName, setNewAuthorName] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [newSiteUrl, setNewSiteUrl] = useState("");
  const [newCadence, setNewCadence] = useState<CreateFeedSourceBodyCadence>("daily");

  // Inline-edit state — which source card is open for editing.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAuthorName, setEditAuthorName] = useState("");
  const [editFeedUrl, setEditFeedUrl] = useState("");
  const [editSiteUrl, setEditSiteUrl] = useState("");

  // Per-row "currently being refreshed / approved" tracking so the
  // spinners are scoped to one row instead of disabling the page.
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [approvingAllId, setApprovingAllId] = useState<number | null>(null);
  const [photoUploadSourceId, setPhotoUploadSourceId] = useState<number | null>(null);
  const [libraryPhotoSource, setLibraryPhotoSource] = useState<FeedSource | null>(null);

  useEffect(() => {
    if (!isUserLoading && !isOwner) {
      setLocation("/");
    }
  }, [isOwner, isUserLoading, setLocation]);

  const sourcesQuery = useListFeedSources({
    query: { enabled: isOwner, queryKey: getListFeedSourcesQueryKey() },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListFeedSourcesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPendingPostsQueryKey() });
    // Bulk-approve flips pending → published so the public timeline
    // changes too. Invalidate it to avoid stale list rendering.
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["listPosts"] });
  };

  const createMutation = useCreateFeedSource({
    mutation: {
      onSuccess: () => {
        toast({ title: "Feed source added" });
        setNewName("");
        setNewBio("");
        setNewAuthorName("");
        setNewFeedUrl("");
        setNewSiteUrl("");
        setNewCadence("daily");
        invalidateAll();
      },
      onError: () => {
        toast({ title: "Failed to add feed source", variant: "destructive" });
      },
    },
  });

  const updateMutation = useUpdateFeedSource({
    mutation: {
      onSuccess: () => invalidateAll(),
      onError: () => toast({ title: "Failed to update source", variant: "destructive" }),
    },
  });

  const uploadPhotoMutation = useUploadFeedSourceProfilePhoto({
    mutation: {
      onSuccess: () => {
        toast({ title: "Feed profile photo updated" });
        invalidateAll();
      },
      onError: (error) => {
        toast({
          title: "Upload failed",
          description: getUploadErrorMessage(error),
          variant: "destructive",
        });
      },
    },
  });

  const deleteMutation = useDeleteFeedSource({
    mutation: {
      onSuccess: () => {
        toast({ title: "Feed source deleted" });
        invalidateAll();
      },
      onError: () => toast({ title: "Failed to delete source", variant: "destructive" }),
    },
  });

  const refreshOneMutation = useRefreshFeedSource({
    mutation: {
      onSettled: () => setRefreshingId(null),
      onSuccess: (data) => {
        // The server queues the fetch on a background worker and
        // returns immediately, so we report "queued" instead of
        // "imported N items". The actual outcome (imported counts,
        // upstream errors) lands in the source row's last_status /
        // last_error and shows up after the list refreshes.
        // `alreadyInProgress` is set when the background queue still
        // has an earlier fetch for the same source running; we tell
        // the user nothing was re-queued so the duplicate-click case
        // doesn't read as a successful new fetch.
        if (data.status === "ok" && data.alreadyInProgress) {
          toast({
            title: "Refresh already in progress",
            description: "An earlier fetch for this source is still running.",
          });
        } else {
          toast({
            title: data.status === "ok" ? "Refresh queued" : "Refresh failed",
            description:
              data.status === "ok"
                ? "Fetching in the background — reload the page in a moment to see new items."
                : data.error ?? "Unknown error",
            variant: data.status === "ok" ? "default" : "destructive",
          });
        }
        invalidateAll();
      },
      onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
    },
  });

  const approveAllMutation = useApproveAllFromFeedSource({
    mutation: {
      onSettled: () => setApprovingAllId(null),
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
        invalidateAll();
      },
      onError: () => toast({ title: "Bulk approve failed", variant: "destructive" }),
    },
  });

  const refreshAllMutation = useRefreshAllFeedSources({
    mutation: {
      onSettled: () => setIsRefreshingAll(false),
      onSuccess: (data) => {
        toast({
          title: "All sources refreshed",
          description: `${data.attempted} source(s) attempted • ${data.totalImported} item(s) imported`,
        });
        invalidateAll();
      },
      onError: () => toast({ title: "Refresh-all failed", variant: "destructive" }),
    },
  });

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim() || !newFeedUrl.trim()) {
      toast({ title: "Name and feed URL are required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      data: {
        name: newName.trim(),
        bio: newBio.trim() || null,
        authorName: newAuthorName.trim() || null,
        feedUrl: newFeedUrl.trim(),
        siteUrl: newSiteUrl.trim() || null,
        cadence: newCadence,
        enabled: true,
      },
    });
  };

  const handleToggleEnabled = (source: FeedSource) => {
    updateMutation.mutate({
      id: source.id,
      data: { enabled: !source.enabled },
    });
  };

  const handleCadenceChange = (source: FeedSource, cadence: CreateFeedSourceBodyCadence) => {
    updateMutation.mutate({
      id: source.id,
      data: { cadence },
    });
  };

  const handleRefresh = (source: FeedSource) => {
    setRefreshingId(source.id);
    refreshOneMutation.mutate({ id: source.id });
  };

  const handleRefreshAll = () => {
    setIsRefreshingAll(true);
    refreshAllMutation.mutate({ params: { force: "1" } });
  };

  const handleDelete = (source: FeedSource) => {
    deleteMutation.mutate({ id: source.id });
  };

  const handleApproveAll = (source: FeedSource) => {
    setApprovingAllId(source.id);
    approveAllMutation.mutate({ id: source.id });
  };

  const handleChooseUpload = (source: FeedSource) => {
    setPhotoUploadSourceId(source.id);
    photoInputRef.current?.click();
  };

  const handlePhotoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !photoUploadSourceId) return;

    uploadPhotoMutation.mutate({
      id: photoUploadSourceId,
      data: { file },
    });
  };

  const handleSelectLibraryPhoto = (url: string) => {
    if (!libraryPhotoSource) return;
    updateMutation.mutate(
      {
        id: libraryPhotoSource.id,
        data: { imageUrl: url },
      },
      {
        onSuccess: () => {
          setLibraryPhotoSource(null);
          toast({ title: "Feed profile photo updated" });
        },
      },
    );
  };

  const handleStartEdit = (source: FeedSource) => {
    setEditingId(source.id);
    setEditName(source.name);
    setEditUsername(source.username ?? "");
    setEditBio(source.bio ?? "");
    setEditAuthorName(source.authorName ?? "");
    setEditFeedUrl(source.feedUrl);
    setEditSiteUrl(source.siteUrl ?? "");
  };

  const handleSaveEdit = (sourceId: number) => {
    if (!editName.trim() || !editFeedUrl.trim()) {
      toast({ title: "Name and feed URL are required", variant: "destructive" });
      return;
    }
    updateMutation.mutate(
      {
        id: sourceId,
        data: {
          name: editName.trim(),
          username: editUsername.trim() || null,
          bio: editBio.trim() || null,
          authorName: editAuthorName.trim() || null,
          feedUrl: editFeedUrl.trim(),
          siteUrl: editSiteUrl.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setEditingId(null);
          toast({ title: "Feed source updated" });
        },
      },
    );
  };

  if (isUserLoading) {
    return <div className="container mx-auto max-w-3xl px-4 py-16 text-center">Loading…</div>;
  }
  if (!isOwner) return null;

  const sources = sourcesQuery.data?.sources ?? [];

  return (
    <AdminLayout
      title="Feed sources"
      description="Subscribe to other sites' RSS / Atom feeds. New items land in the pending review queue."
    >
      <div className="mb-4 flex justify-end">
        <Button
          variant="outline"
          onClick={handleRefreshAll}
          disabled={isRefreshingAll || sources.length === 0}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingAll ? "animate-spin" : ""}`} />
          Refresh all
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" /> Add a source
          </CardTitle>
          <CardDescription>
            Paste an RSS or Atom URL. The first refresh is queued automatically.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleCreate}>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="feed-name">Name</Label>
                <Input
                  id="feed-name"
                  placeholder="e.g. Some Blog"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={255}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="feed-cadence">Refresh cadence</Label>
                <select
                  id="feed-cadence"
                  value={newCadence}
                  onChange={(e) => setNewCadence(e.target.value as CreateFeedSourceBodyCadence)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {CADENCE_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="feed-url">Feed URL</Label>
              <Input
                id="feed-url"
                placeholder="https://example.com/feed.xml"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                maxLength={2048}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="feed-site">Site URL (optional)</Label>
              <Input
                id="feed-site"
                placeholder="https://example.com"
                value={newSiteUrl}
                onChange={(e) => setNewSiteUrl(e.target.value)}
                maxLength={2048}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="feed-bio">Bio (optional)</Label>
              <textarea
                id="feed-bio"
                placeholder="Short description shown on the feed's profile page"
                value={newBio}
                onChange={(e) => setNewBio(e.target.value)}
                maxLength={500}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="feed-author">Author Name (optional)</Label>
              <Input
                id="feed-author"
                placeholder="e.g. Jane Doe"
                value={newAuthorName}
                onChange={(e) => setNewAuthorName(e.target.value)}
                maxLength={255}
              />
              <p className="text-xs text-muted-foreground">
                Overrides the author shown on all posts imported from this source. Defaults to the source name if left blank.
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end border-t pt-4">
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Adding…" : "Add source"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscribed sources</CardTitle>
          <CardDescription>
            {sources.length === 0
              ? "No sources yet. Add one above to get started."
              : `${sources.length} source${sources.length === 1 ? "" : "s"} configured.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sources.map((source) => (
            <div
              key={source.id}
              className="rounded-lg border border-border p-4 space-y-3"
              data-testid={`feed-source-${source.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 gap-3">
                  <Avatar className="h-12 w-12 border border-border">
                    <AvatarImage src={source.imageUrl || undefined} alt={source.name} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      <Rss className="h-5 w-5" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold truncate">{source.name}</h3>
                    {source.enabled ? null : (
                      <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">disabled</span>
                    )}
                  </div>
                  {source.username ? (
                    <p className="text-xs text-muted-foreground">
                      <a href={`/users/@${source.username}`} className="hover:underline text-primary">
                        @{source.username}
                      </a>
                      {" "}· <span className="text-muted-foreground">profile page</span>
                    </p>
                  ) : null}
                  {source.authorName ? (
                    <p className="text-xs text-muted-foreground">Author: {source.authorName}</p>
                  ) : null}
                  <a
                    href={source.feedUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="block truncate text-xs text-muted-foreground hover:underline"
                  >
                    {source.feedUrl}
                  </a>
                  {source.siteUrl ? (
                    <a
                      href={source.siteUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                    >
                      Visit site <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleChooseUpload(source)}
                    disabled={uploadPhotoMutation.isPending && photoUploadSourceId === source.id}
                    aria-label="Upload feed profile photo"
                    title="Upload feed profile photo"
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setLibraryPhotoSource(source)}
                    aria-label="Choose feed profile photo from library"
                    title="Choose feed profile photo from library"
                  >
                    <ImageIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => editingId === source.id ? setEditingId(null) : handleStartEdit(source)}
                    aria-label={editingId === source.id ? "Cancel edit" : "Edit source"}
                    title={editingId === source.id ? "Cancel edit" : "Edit source"}
                  >
                    {editingId === source.id ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRefresh(source)}
                    disabled={refreshingId === source.id}
                    aria-label="Refresh source"
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshingId === source.id ? "animate-spin" : ""}`} />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Delete source">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this feed source?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The source and its dedup history will be removed. Any items already imported (pending or
                          published) are kept.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(source)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              {editingId === source.id ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={255}
                        placeholder="Source name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Username (optional)</Label>
                      <Input
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value.toLowerCase())}
                        maxLength={30}
                        placeholder="e.g. myblog"
                      />
                      <p className="text-xs text-muted-foreground">Sets <code>/users/@handle</code> profile URL. 2–30 chars: a–z, 0–9, _</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Bio (optional)</Label>
                    <textarea
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      maxLength={500}
                      placeholder="Short description shown on the feed's profile page"
                      rows={2}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Author Name (optional)</Label>
                      <Input
                        value={editAuthorName}
                        onChange={(e) => setEditAuthorName(e.target.value)}
                        maxLength={255}
                        placeholder="e.g. Jane Doe"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Site URL (optional)</Label>
                      <Input
                        value={editSiteUrl}
                        onChange={(e) => setEditSiteUrl(e.target.value)}
                        maxLength={2048}
                        placeholder="https://example.com"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Feed URL</Label>
                    <Input
                      value={editFeedUrl}
                      onChange={(e) => setEditFeedUrl(e.target.value)}
                      maxLength={2048}
                      placeholder="https://example.com/feed.xml"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={updateMutation.isPending}
                      onClick={() => handleSaveEdit(source.id)}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3 text-xs">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Cadence</Label>
                  <select
                    value={source.cadence}
                    onChange={(e) => handleCadenceChange(source, e.target.value as CreateFeedSourceBodyCadence)}
                    className="h-8 w-full rounded border border-input bg-background px-2 text-xs"
                  >
                    {CADENCE_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Enabled</Label>
                  <Button
                    type="button"
                    variant={source.enabled ? "default" : "outline"}
                    size="sm"
                    className="h-8 w-full"
                    onClick={() => handleToggleEnabled(source)}
                  >
                    {source.enabled ? "On" : "Off"}
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Imported</Label>
                  <div className="h-8 flex items-center text-sm">{source.itemsImported}</div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground border-t pt-2">
                Last fetch: {formatTimestamp(source.lastFetchedAt)}
                {source.nextFetchAt
                  ? ` • next due: ${formatTimestamp(source.nextFetchAt)}`
                  : ""}
                {source.lastStatus ? ` • status: ${source.lastStatus}` : ""}
                {source.lastError ? (
                  <div className="text-destructive mt-1 break-words">Error: {source.lastError}</div>
                ) : null}
              </div>

              <div className="flex justify-end pt-1">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={approvingAllId === source.id}
                    >
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />
                      {approvingAllId === source.id
                        ? "Approving…"
                        : "Approve all pending from this source"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Approve every pending item from {source.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Every queued item from this source will be flipped to published and
                        appear on the public timeline immediately. New items imported in
                        future refreshes still go through the regular review queue.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleApproveAll(source)}>
                        Approve all
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <input
        ref={photoInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        aria-label="Choose feed profile photo"
        className="hidden"
        onChange={handlePhotoFileChange}
      />
      <FeaturedImagePicker
        open={!!libraryPhotoSource}
        onOpenChange={(open) => {
          if (!open) setLibraryPhotoSource(null);
        }}
        currentUrl={libraryPhotoSource?.imageUrl || undefined}
        dialogTitle="Choose Feed Profile Photo"
        finalActionLabel="Use as feed profile photo"
        closeWarningDescription="You have selected a feed profile photo but have not saved it yet."
        onSelect={handleSelectLibraryPhoto}
      />
    </AdminLayout>
  );
}

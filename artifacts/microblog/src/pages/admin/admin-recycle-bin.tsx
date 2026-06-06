import { useState } from "react";
import {
  useGetRecycleBin,
  useRestoreTrashedPost,
  useRestoreTrashedPiece,
  useRestoreTrashedMedia,
  useRestoreTrashedExhibit,
  useRestoreTrashedPage,
  useRestoreTrashedCategory,
  usePermanentDeleteTrashedPost,
  usePermanentDeleteTrashedPiece,
  usePermanentDeleteTrashedMedia,
  usePermanentDeleteTrashedExhibit,
  usePermanentDeleteTrashedPage,
  usePermanentDeleteTrashedCategory,
  useBulkPermanentDelete,
  getGetRecycleBinQueryKey,
  getListArtPiecesQueryKey,
  type TrashedPost,
  type TrashedPiece,
  type TrashedMedia,
  type TrashedExhibit,
  type TrashedPage,
  type TrashedCategory,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

type TabId = "posts" | "pieces" | "images" | "exhibits" | "pages" | "categories";

function toUtcDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function relativeTime(s: string | null | undefined): string {
  const d = toUtcDate(s);
  if (!d) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
}

function badge(n: number) {
  return n > 0 ? ` (${n})` : "";
}

export default function AdminRecycleBinPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const recycleBin = useGetRecycleBin();
  const posts = recycleBin.data?.posts ?? [];
  const pieces = recycleBin.data?.pieces ?? [];
  const media = recycleBin.data?.media ?? [];
  const exhibits = recycleBin.data?.exhibits ?? [];
  const pages = recycleBin.data?.pages ?? [];
  const categories = recycleBin.data?.categories ?? [];

  const [activeTab, setActiveTab] = useState<TabId>("posts");

  const [selectedPostIds, setSelectedPostIds] = useState<Set<number>>(new Set());
  const [selectedPieceIds, setSelectedPieceIds] = useState<Set<number>>(new Set());
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<number>>(new Set());
  const [selectedExhibitIds, setSelectedExhibitIds] = useState<Set<number>>(new Set());
  const [selectedPageIds, setSelectedPageIds] = useState<Set<number>>(new Set());
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<number>>(new Set());

  const [confirmPermanent, setConfirmPermanent] = useState<{
    type: "single-post" | "single-piece" | "single-media" | "single-exhibit" | "single-page" | "single-category" | "bulk";
    id?: number;
    label?: string;
    count?: number;
  } | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetRecycleBinQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListArtPiecesQueryKey() });
  }

  const restorePost = useRestoreTrashedPost({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Post restored" }); }, onError: () => toast({ title: "Failed to restore post", variant: "destructive" }) } });
  const restorePiece = useRestoreTrashedPiece({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Piece restored" }); }, onError: () => toast({ title: "Failed to restore piece", variant: "destructive" }) } });
  const restoreMedia = useRestoreTrashedMedia({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Image restored" }); }, onError: () => toast({ title: "Failed to restore image", variant: "destructive" }) } });
  const restoreExhibit = useRestoreTrashedExhibit({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Exhibit restored" }); }, onError: () => toast({ title: "Failed to restore exhibit", variant: "destructive" }) } });
  const restorePage = useRestoreTrashedPage({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Page restored" }); }, onError: () => toast({ title: "Failed to restore page", variant: "destructive" }) } });
  const restoreCategory = useRestoreTrashedCategory({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Category restored" }); }, onError: () => toast({ title: "Failed to restore category", variant: "destructive" }) } });

  const permDeletePost = usePermanentDeleteTrashedPost({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Post permanently deleted" }); }, onError: () => toast({ title: "Failed to delete", variant: "destructive" }) } });
  const permDeletePiece = usePermanentDeleteTrashedPiece({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Piece permanently deleted" }); }, onError: () => toast({ title: "Failed to delete", variant: "destructive" }) } });
  const permDeleteMedia = usePermanentDeleteTrashedMedia({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Image permanently deleted" }); }, onError: () => toast({ title: "Failed to delete", variant: "destructive" }) } });
  const permDeleteExhibit = usePermanentDeleteTrashedExhibit({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Exhibit permanently deleted" }); }, onError: () => toast({ title: "Failed to delete", variant: "destructive" }) } });
  const permDeletePage = usePermanentDeleteTrashedPage({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Page permanently deleted" }); }, onError: () => toast({ title: "Failed to delete", variant: "destructive" }) } });
  const permDeleteCategory = usePermanentDeleteTrashedCategory({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Category permanently deleted" }); }, onError: () => toast({ title: "Failed to delete", variant: "destructive" }) } });

  const bulkDelete = useBulkPermanentDelete({
    mutation: {
      onSuccess: () => {
        invalidate();
        setSelectedPostIds(new Set());
        setSelectedPieceIds(new Set());
        setSelectedMediaIds(new Set());
        setSelectedExhibitIds(new Set());
        setSelectedPageIds(new Set());
        setSelectedCategoryIds(new Set());
        toast({ title: "Items permanently deleted" });
      },
      onError: () => toast({ title: "Failed to delete items", variant: "destructive" }),
    },
  });

  function handleConfirm() {
    if (!confirmPermanent) return;
    const { type, id } = confirmPermanent;
    if (type === "single-post" && id != null) permDeletePost.mutate({ id });
    else if (type === "single-piece" && id != null) permDeletePiece.mutate({ id });
    else if (type === "single-media" && id != null) permDeleteMedia.mutate({ id });
    else if (type === "single-exhibit" && id != null) permDeleteExhibit.mutate({ id });
    else if (type === "single-page" && id != null) permDeletePage.mutate({ id });
    else if (type === "single-category" && id != null) permDeleteCategory.mutate({ id });
    else if (type === "bulk") {
      bulkDelete.mutate({
        data: {
          postIds: selectedPostIds.size > 0 ? [...selectedPostIds] : undefined,
          pieceIds: selectedPieceIds.size > 0 ? [...selectedPieceIds] : undefined,
          mediaIds: selectedMediaIds.size > 0 ? [...selectedMediaIds] : undefined,
          exhibitIds: selectedExhibitIds.size > 0 ? [...selectedExhibitIds] : undefined,
          pageIds: selectedPageIds.size > 0 ? [...selectedPageIds] : undefined,
          categoryIds: selectedCategoryIds.size > 0 ? [...selectedCategoryIds] : undefined,
        },
      });
    }
    setConfirmPermanent(null);
  }

  const totalSelected =
    selectedPostIds.size + selectedPieceIds.size + selectedMediaIds.size +
    selectedExhibitIds.size + selectedPageIds.size + selectedCategoryIds.size;

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "posts", label: "Posts", count: posts.length },
    { id: "pieces", label: "Art Pieces", count: pieces.length },
    { id: "images", label: "Images", count: media.length },
    { id: "exhibits", label: "Exhibits", count: exhibits.length },
    { id: "pages", label: "Pages", count: pages.length },
    { id: "categories", label: "Categories", count: categories.length },
  ];

  function toggle<T>(set: Set<T>, id: T, checked: boolean): Set<T> {
    const next = new Set(set);
    checked ? next.add(id) : next.delete(id);
    return next;
  }

  return (
    <AdminLayout title="Recycle Bin" description="Review, restore, or permanently delete trashed content.">
      <div className="flex flex-wrap gap-1 mb-4 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}{badge(tab.count)}
          </button>
        ))}
      </div>

      {totalSelected > 0 ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <span className="text-sm font-medium">{totalSelected} selected</span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                Promise.all([
                  ...[...selectedPostIds].map((id) => restorePost.mutateAsync({ id })),
                  ...[...selectedPieceIds].map((id) => restorePiece.mutateAsync({ id })),
                  ...[...selectedMediaIds].map((id) => restoreMedia.mutateAsync({ id })),
                  ...[...selectedExhibitIds].map((id) => restoreExhibit.mutateAsync({ id })),
                  ...[...selectedPageIds].map((id) => restorePage.mutateAsync({ id })),
                  ...[...selectedCategoryIds].map((id) => restoreCategory.mutateAsync({ id })),
                ]).then(() => {
                  setSelectedPostIds(new Set()); setSelectedPieceIds(new Set());
                  setSelectedMediaIds(new Set()); setSelectedExhibitIds(new Set());
                  setSelectedPageIds(new Set()); setSelectedCategoryIds(new Set());
                  toast({ title: "Items restored" });
                  invalidate();
                }).catch(() => toast({ title: "Some items failed to restore", variant: "destructive" }));
              }}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Restore Selected
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmPermanent({ type: "bulk", count: totalSelected })}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Permanently Delete Selected
            </Button>
          </div>
        </div>
      ) : null}

      {activeTab === "posts" && (
        posts.length === 0 ? <Empty label="deleted posts" /> : (
          <div className="space-y-2">
            {posts.map((p) => (
              <GenericRow
                key={p.id}
                label={p.title || p.content.slice(0, 80)}
                sublabel={`Status: ${p.status}`}
                deletedAt={p.deletedAt}
                checked={selectedPostIds.has(p.id)}
                onCheck={(v) => setSelectedPostIds(toggle(selectedPostIds, p.id, v))}
                onRestore={() => restorePost.mutate({ id: p.id })}
                onPermanentDelete={() => setConfirmPermanent({ type: "single-post", id: p.id, label: p.title || `Post #${p.id}` })}
              />
            ))}
          </div>
        )
      )}

      {activeTab === "pieces" && (
        pieces.length === 0 ? <Empty label="deleted art pieces" /> : (
          <div className="space-y-2">
            {pieces.map((p) => (
              <PieceRow
                key={p.id}
                piece={p}
                checked={selectedPieceIds.has(p.id)}
                onCheck={(v) => setSelectedPieceIds(toggle(selectedPieceIds, p.id, v))}
                onRestore={() => restorePiece.mutate({ id: p.id })}
                onPermanentDelete={() => setConfirmPermanent({ type: "single-piece", id: p.id, label: p.title })}
              />
            ))}
          </div>
        )
      )}

      {activeTab === "images" && (
        media.length === 0 ? <Empty label="deleted images" /> : (
          <div className="space-y-2">
            {media.map((a) => (
              <MediaRow
                key={a.id}
                asset={a}
                checked={selectedMediaIds.has(a.id)}
                onCheck={(v) => setSelectedMediaIds(toggle(selectedMediaIds, a.id, v))}
                onRestore={() => restoreMedia.mutate({ id: a.id })}
                onPermanentDelete={() => setConfirmPermanent({ type: "single-media", id: a.id, label: a.title || a.filename })}
              />
            ))}
          </div>
        )
      )}

      {activeTab === "exhibits" && (
        exhibits.length === 0 ? <Empty label="deleted exhibits" /> : (
          <div className="space-y-2">
            {exhibits.map((e) => (
              <GenericRow
                key={e.id}
                label={e.name}
                sublabel={`/${e.slug}`}
                deletedAt={e.deletedAt}
                checked={selectedExhibitIds.has(e.id)}
                onCheck={(v) => setSelectedExhibitIds(toggle(selectedExhibitIds, e.id, v))}
                onRestore={() => restoreExhibit.mutate({ id: e.id })}
                onPermanentDelete={() => setConfirmPermanent({ type: "single-exhibit", id: e.id, label: e.name })}
              />
            ))}
          </div>
        )
      )}

      {activeTab === "pages" && (
        pages.length === 0 ? <Empty label="deleted pages" /> : (
          <div className="space-y-2">
            {pages.map((p) => (
              <GenericRow
                key={p.id}
                label={p.title}
                sublabel={`/p/${p.slug} · ${p.status}`}
                deletedAt={p.deletedAt}
                checked={selectedPageIds.has(p.id)}
                onCheck={(v) => setSelectedPageIds(toggle(selectedPageIds, p.id, v))}
                onRestore={() => restorePage.mutate({ id: p.id })}
                onPermanentDelete={() => setConfirmPermanent({ type: "single-page", id: p.id, label: p.title })}
              />
            ))}
          </div>
        )
      )}

      {activeTab === "categories" && (
        categories.length === 0 ? <Empty label="deleted categories" /> : (
          <div className="space-y-2">
            {categories.map((c) => (
              <GenericRow
                key={c.id}
                label={c.name}
                sublabel={`/categories/${c.slug}`}
                deletedAt={c.deletedAt}
                checked={selectedCategoryIds.has(c.id)}
                onCheck={(v) => setSelectedCategoryIds(toggle(selectedCategoryIds, c.id, v))}
                onRestore={() => restoreCategory.mutate({ id: c.id })}
                onPermanentDelete={() => setConfirmPermanent({ type: "single-category", id: c.id, label: c.name })}
              />
            ))}
          </div>
        )
      )}

      <AlertDialog open={confirmPermanent !== null} onOpenChange={(open) => { if (!open) setConfirmPermanent(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmPermanent?.type === "bulk"
                ? `Permanently delete ${confirmPermanent.count} item${(confirmPermanent.count ?? 0) > 1 ? "s" : ""}?`
                : `Permanently delete "${confirmPermanent?.label}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The item{confirmPermanent?.type === "bulk" ? "s" : ""} will be removed forever.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirm}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-12 text-center text-sm text-muted-foreground">No {label}.</p>;
}

function GenericRow({
  label, sublabel, deletedAt, checked, onCheck, onRestore, onPermanentDelete,
}: {
  label: string;
  sublabel?: string;
  deletedAt?: string | null;
  checked: boolean;
  onCheck: (v: boolean) => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <Checkbox checked={checked} onCheckedChange={(v) => onCheck(Boolean(v))} aria-label="Select item" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {sublabel ? `${sublabel} · ` : ""}Deleted {relativeTime(deletedAt)}
        </p>
      </div>
      <RowActions onRestore={onRestore} onPermanentDelete={onPermanentDelete} />
    </div>
  );
}

function PieceRow({
  piece, checked, onCheck, onRestore, onPermanentDelete,
}: {
  piece: TrashedPiece;
  checked: boolean;
  onCheck: (v: boolean) => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <Checkbox checked={checked} onCheckedChange={(v) => onCheck(Boolean(v))} aria-label="Select art piece" />
      {piece.thumbnailUrl ? (
        <img src={piece.thumbnailUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{piece.title}</p>
        <p className="text-xs text-muted-foreground uppercase">{piece.engine} · Deleted {relativeTime(piece.deletedAt)}</p>
      </div>
      <RowActions onRestore={onRestore} onPermanentDelete={onPermanentDelete} />
    </div>
  );
}

function MediaRow({
  asset, checked, onCheck, onRestore, onPermanentDelete,
}: {
  asset: TrashedMedia;
  checked: boolean;
  onCheck: (v: boolean) => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <Checkbox checked={checked} onCheckedChange={(v) => onCheck(Boolean(v))} aria-label="Select image" />
      <img src={asset.url} alt={asset.altText ?? ""} className="h-10 w-10 shrink-0 rounded object-cover bg-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{asset.title || asset.filename}</p>
        <p className="text-xs text-muted-foreground">{asset.mimeType} · Deleted {relativeTime(asset.deletedAt)}</p>
      </div>
      <RowActions onRestore={onRestore} onPermanentDelete={onPermanentDelete} />
    </div>
  );
}

function RowActions({ onRestore, onPermanentDelete }: { onRestore: () => void; onPermanentDelete: () => void }) {
  return (
    <div className="flex shrink-0 gap-2">
      <Button size="sm" variant="outline" onClick={onRestore}>
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
        Restore
      </Button>
      <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={onPermanentDelete}>
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        Delete forever
      </Button>
    </div>
  );
}

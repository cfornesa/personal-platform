import { useMemo, useState } from "react";
import { getListExhibitsQueryKey, useListExhibits, type ExhibitWithCounts } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ExhibitLibraryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (exhibit: { slug: string; name: string }) => void;
};

function ExhibitPreview({ exhibit }: { exhibit: ExhibitWithCounts }) {
  const itemCount = exhibit.pieceCount + exhibit.imageCount;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{exhibit.name}</h3>
        {exhibit.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{exhibit.description}</p>
        ) : null}
      </div>
      <dl className="space-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-xs uppercase tracking-widest text-muted-foreground/70 w-24 shrink-0 pt-0.5">Layout</dt>
          <dd>{exhibit.rows} × {exhibit.cols} grid</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-xs uppercase tracking-widest text-muted-foreground/70 w-24 shrink-0 pt-0.5">Works</dt>
          <dd>{itemCount} item{itemCount === 1 ? "" : "s"} ({exhibit.pieceCount} piece{exhibit.pieceCount === 1 ? "" : "s"}, {exhibit.imageCount} image{exhibit.imageCount === 1 ? "" : "s"})</dd>
        </div>
        {exhibit.artistStatement ? (
          <div className="flex gap-2">
            <dt className="text-xs uppercase tracking-widest text-muted-foreground/70 w-24 shrink-0 pt-0.5">Statement</dt>
            <dd className="line-clamp-3">{exhibit.artistStatement}</dd>
          </div>
        ) : null}
      </dl>
      <p className="text-xs text-muted-foreground/60">
        Inserted as a non-interactive embed — viewers can click through to the full interactive exhibit.
      </p>
    </div>
  );
}

export function ExhibitLibraryDialog({
  open,
  onOpenChange,
  onInsert,
}: ExhibitLibraryDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const exhibits = useListExhibits({
    query: {
      queryKey: getListExhibitsQueryKey(),
      enabled: open,
    },
  });

  const filtered = useMemo(() => {
    const rows: ExhibitWithCounts[] = exhibits.data?.exhibits ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((exhibit) => exhibit.name.toLowerCase().includes(q));
  }, [exhibits.data?.exhibits, query]);

  const selected = filtered.find((exhibit) => exhibit.id === selectedId) ?? filtered[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[90vw] max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Insert saved exhibit</DialogTitle>
          <DialogDescription>
            Pick an exhibit from your library and insert a non-interactive embed into this post.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[18rem_1fr] overflow-y-auto min-h-0">
          <div className="space-y-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search exhibits..."
            />
            <div className="max-h-[24rem] space-y-2 overflow-auto rounded-xl border border-border p-2">
              {exhibits.isLoading ? (
                <p className="p-3 text-sm text-muted-foreground">Loading exhibits…</p>
              ) : filtered.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No exhibits match this search.</p>
              ) : (
                filtered.map((exhibit) => (
                  <button
                    key={exhibit.id}
                    type="button"
                    onClick={() => setSelectedId(exhibit.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      selected?.id === exhibit.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <p className="font-medium">{exhibit.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {exhibit.pieceCount + exhibit.imageCount} item{exhibit.pieceCount + exhibit.imageCount === 1 ? "" : "s"} · {exhibit.rows}×{exhibit.cols}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-3">
            {selected ? (
              <ExhibitPreview exhibit={selected} />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Select an exhibit to preview it here.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onInsert({ slug: selected.slug, name: selected.name });
              onOpenChange(false);
            }}
          >
            Insert exhibit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

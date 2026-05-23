import { useMemo, useState } from "react";
import { getListArtPiecesQueryKey, useListArtPieces } from "@workspace/api-client-react";
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
import { ArtPieceRenderer } from "./ArtPieceRenderer";

type ArtPieceLibraryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (piece: { id: number; title: string; prompt: string; currentVersionId: number }) => void;
};

export function ArtPieceLibraryDialog({
  open,
  onOpenChange,
  onInsert,
}: ArtPieceLibraryDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const pieces = useListArtPieces({
    query: {
      queryKey: getListArtPiecesQueryKey(),
      enabled: open,
    },
  });

  const filtered = useMemo(() => {
    const rows = pieces.data?.pieces ?? [];
    const q = query.trim().toLowerCase();
    if (!q) {
      return rows.filter((piece) => piece.status === "active" && piece.currentVersionId);
    }
    return rows.filter((piece) =>
      piece.status === "active" &&
      piece.currentVersionId &&
      [piece.title, piece.prompt].some((value) => value.toLowerCase().includes(q)),
    );
  }, [pieces.data?.pieces, query]);

  const selected = filtered.find((piece) => piece.id === selectedId) ?? filtered[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[90vw] max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Insert saved piece</DialogTitle>
          <DialogDescription>
            Pick a reusable interactive piece from your library and insert its embed into this post.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[18rem_1fr] overflow-y-auto min-h-0">
          <div className="space-y-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pieces..."
            />
            <div className="max-h-[24rem] space-y-2 overflow-auto rounded-xl border border-border p-2">
              {pieces.isLoading ? (
                <p className="p-3 text-sm text-muted-foreground">Loading pieces…</p>
              ) : filtered.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No saved pieces match this search.</p>
              ) : (
                filtered.map((piece) => (
                  <button
                    key={piece.id}
                    type="button"
                    onClick={() => setSelectedId(piece.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      selected?.id === piece.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <p className="font-medium">{piece.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{piece.prompt}</p>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-3">
            {selected?.currentVersion ? (
              <>
                <div>
                  <h3 className="text-lg font-semibold">{selected.title}</h3>
                  <p className="text-sm text-muted-foreground">{selected.prompt}</p>
                </div>
                <ArtPieceRenderer
                  engine={selected.currentVersion.engine}
                  code={selected.currentVersion.generatedCode}
                  htmlCode={selected.currentVersion.htmlCode}
                  cssCode={selected.currentVersion.cssCode}
                  title={selected.prompt}
                />
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Select a piece to preview it here.
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
            disabled={!selected?.currentVersionId}
            onClick={() => {
              if (!selected?.currentVersionId) return;
              onInsert({
                id: selected.id,
                title: selected.title,
                prompt: selected.prompt,
                currentVersionId: selected.currentVersionId,
              });
              onOpenChange(false);
            }}
          >
            Insert piece
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

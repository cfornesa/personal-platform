import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Plus, LayoutGrid, AlertTriangle, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useListExhibits,
  useCreateExhibit,
  useUpdateExhibit,
  useDeleteExhibit,
  getListExhibitsQueryKey,
  type ExhibitWithCounts,
} from "@workspace/api-client-react";

export function ExhibitsManagementCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const list = useListExhibits({
    query: { queryKey: getListExhibitsQueryKey() },
  });
  const exhibits: ExhibitWithCounts[] = list.data?.exhibits ?? [];

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListExhibitsQueryKey() });

  const create = useCreateExhibit({
    mutation: {
      onSuccess: () => {
        setNewName("");
        setNewDescription("");
        invalidate();
        toast({ title: "Exhibit created" });
      },
      onError: () => toast({ title: "Failed to create exhibit", variant: "destructive" }),
    },
  });

  return (
    <Card className="mb-6" id="exhibits">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5" /> Exhibits
        </CardTitle>
        <CardDescription>
          Named collections of art pieces and images. Each exhibit gets a Three.js museum wall at{" "}
          <code>/immersive/exhibits/&lt;slug&gt;</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = newName.trim();
            if (!trimmed) return;
            const description = newDescription.trim();
            create.mutate({
              data: {
                name: trimmed,
                description: description.length > 0 ? description : null,
              },
            });
          }}
          className="space-y-2"
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-exhibit">New exhibit</Label>
            <Input
              id="new-exhibit"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Abstract Studies"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-exhibit-description">Description (optional)</Label>
            <Textarea
              id="new-exhibit-description"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Short description shown on the exhibit wall"
              rows={2}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending || !newName.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        </form>

        {exhibits.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No exhibits yet. Create one above to start curating artwork.
          </p>
        ) : (
          <ul className="space-y-2">
            {exhibits.map((exhibit) => (
              <ExhibitRow key={exhibit.id} exhibit={exhibit} onChanged={invalidate} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const MAX_ROWS = 4;
const MAX_COLS = 8;

function validColOptions(rows: number, total: number): number[] {
  const minCols = total === 0 ? 1 : Math.ceil(total / rows);
  const options: number[] = [];
  for (let c = minCols; c <= MAX_COLS; c++) options.push(c);
  if (options.length === 0) options.push(1);
  return options;
}

function ExhibitRow({
  exhibit,
  onChanged,
}: {
  exhibit: ExhibitWithCounts;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(exhibit.name);
  const [draftSlug, setDraftSlug] = useState(exhibit.slug);
  const [draftDescription, setDraftDescription] = useState(exhibit.description ?? "");
  const [draftArtistStatement, setDraftArtistStatement] = useState(exhibit.artistStatement ?? "");
  const [draftBiography, setDraftBiography] = useState(exhibit.biography ?? "");
  const [draftRows, setDraftRows] = useState(exhibit.rows ?? 1);
  const [draftCols, setDraftCols] = useState(exhibit.cols ?? 1);

  const update = useUpdateExhibit({
    mutation: {
      onSuccess: () => {
        setIsEditing(false);
        onChanged();
        toast({ title: "Exhibit updated" });
      },
      onError: () => toast({ title: "Failed to update exhibit", variant: "destructive" }),
    },
  });
  const remove = useDeleteExhibit({
    mutation: {
      onSuccess: () => {
        onChanged();
        toast({ title: "Exhibit deleted" });
      },
      onError: () => toast({ title: "Failed to delete exhibit", variant: "destructive" }),
    },
  });

  const slugChanged = draftSlug.trim() !== exhibit.slug;
  const totalItems = exhibit.pieceCount + exhibit.imageCount;
  const savedRows = exhibit.rows ?? 1;
  const savedCols = exhibit.cols ?? 1;
  const isStale = savedRows * savedCols < totalItems;

  if (isEditing) {
    return (
      <li className="rounded-xl border border-border p-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`name-${exhibit.id}`} className="text-xs">Name</Label>
            <Input
              id={`name-${exhibit.id}`}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`slug-${exhibit.id}`} className="text-xs">Slug</Label>
            <Input
              id={`slug-${exhibit.id}`}
              value={draftSlug}
              onChange={(e) => setDraftSlug(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`desc-${exhibit.id}`} className="text-xs">Description</Label>
          <Textarea
            id={`desc-${exhibit.id}`}
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            rows={2}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`artist-statement-${exhibit.id}`} className="text-xs">Artist Statement</Label>
          <Textarea
            id={`artist-statement-${exhibit.id}`}
            value={draftArtistStatement}
            onChange={(e) => setDraftArtistStatement(e.target.value)}
            rows={3}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`biography-${exhibit.id}`} className="text-xs">Biography</Label>
          <Textarea
            id={`biography-${exhibit.id}`}
            value={draftBiography}
            onChange={(e) => setDraftBiography(e.target.value)}
            rows={3}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Rows</Label>
            <select
              value={draftRows}
              onChange={(e) => {
                const r = Number(e.target.value);
                setDraftRows(r);
                const validCols = validColOptions(r, totalItems);
                if (!validCols.includes(draftCols)) setDraftCols(validCols[0] ?? 1);
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              {Array.from({ length: MAX_ROWS }, (_, i) => i + 1).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Columns</Label>
            <select
              value={draftCols}
              onChange={(e) => setDraftCols(Number(e.target.value))}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              {validColOptions(draftRows, totalItems).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Grid fits {draftRows * draftCols} items
          {totalItems > 0 && draftRows * draftCols < totalItems
            ? ` — ${totalItems - draftRows * draftCols} item${totalItems - draftRows * draftCols === 1 ? "" : "s"} will be hidden`
            : totalItems > 0
            ? ` (${totalItems} assigned)`
            : ""}
        </p>
        {slugChanged ? (
          <p className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Changing the slug breaks any external link to{" "}
              <code>/immersive/exhibits/{exhibit.slug}</code>. The new URL will be{" "}
              <code>/immersive/exhibits/{draftSlug.trim() || exhibit.slug}</code>.
            </span>
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                id: exhibit.id,
                data: {
                  name: draftName.trim() || undefined,
                  slug: draftSlug.trim() || undefined,
                  description: draftDescription.trim().length > 0 ? draftDescription.trim() : null,
                  artistStatement: draftArtistStatement.trim().length > 0 ? draftArtistStatement.trim() : null,
                  biography: draftBiography.trim().length > 0 ? draftBiography.trim() : null,
                  rows: draftRows,
                  cols: draftCols,
                },
              })
            }
          >
            Save
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
          {exhibit.name}
        </div>
        {exhibit.description ? (
          <p className="text-xs text-foreground/80 mt-0.5">{exhibit.description}</p>
        ) : null}
        {exhibit.artistStatement ? (
          <p className="text-xs text-muted-foreground mt-0.5 italic truncate">Artist: {exhibit.artistStatement}</p>
        ) : null}
        <p className="text-xs text-muted-foreground mt-0.5">
          /{exhibit.slug} · {exhibit.pieceCount}{" "}
          {exhibit.pieceCount === 1 ? "piece" : "pieces"} · {exhibit.imageCount}{" "}
          {exhibit.imageCount === 1 ? "image" : "images"} · {savedRows}×{savedCols} grid
        </p>
        {isStale && totalItems > 0 ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Layout shows {savedRows * savedCols}/{totalItems} items — edit to update
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {totalItems > 0 ? (
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <a href={`/immersive/exhibits/${exhibit.slug}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        ) : null}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsEditing(true)}>
          <Pencil className="h-4 w-4" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Move &ldquo;{exhibit.name}&rdquo; to the Recycle Bin?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {totalItems === 0
                  ? "This exhibit has no items."
                  : `${totalItems} ${totalItems === 1 ? "item" : "items"} will be hidden with the exhibit — the artwork itself stays intact.`}
                {" "}You can restore it or permanently delete it from the Recycle Bin.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => remove.mutate({ id: exhibit.id })}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Move to Recycle Bin
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

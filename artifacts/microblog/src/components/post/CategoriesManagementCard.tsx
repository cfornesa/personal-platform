import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Plus, Tag, AlertTriangle } from "lucide-react";
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
  useListCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  getListCategoriesQueryKey,
  type CategoryWithPostCount,
} from "@workspace/api-client-react";

export function CategoriesManagementCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const list = useListCategories({
    query: { queryKey: getListCategoriesQueryKey() },
  });
  const categories: CategoryWithPostCount[] = list.data?.categories ?? [];

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });

  const create = useCreateCategory({
    mutation: {
      onSuccess: () => {
        setNewName("");
        setNewDescription("");
        invalidate();
        toast({ title: "Category created" });
      },
      onError: () => toast({ title: "Failed to create category", variant: "destructive" }),
    },
  });

  return (
    <Card className="mb-6" id="categories">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-5 w-5" /> Categories
        </CardTitle>
        <CardDescription>
          Group your posts by topic. Categories appear under every post and on the search filters.
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
            <Label htmlFor="new-category">New category</Label>
            <Input
              id="new-category"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Photography"
              data-testid="new-category-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-category-description">Description (optional)</Label>
            <Textarea
              id="new-category-description"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Short description shown on the category page"
              rows={2}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending || !newName.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        </form>

        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No categories yet. Create one above to start organizing posts.
          </p>
        ) : (
          <ul className="space-y-2">
            {categories.map((cat) => (
              <CategoryRow key={cat.id} category={cat} onChanged={invalidate} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CategoryRow({
  category,
  onChanged,
}: {
  category: CategoryWithPostCount;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(category.name);
  const [draftSlug, setDraftSlug] = useState(category.slug);
  const [draftDescription, setDraftDescription] = useState(category.description ?? "");

  const update = useUpdateCategory({
    mutation: {
      onSuccess: () => {
        setIsEditing(false);
        onChanged();
        toast({ title: "Category updated" });
      },
      onError: () => toast({ title: "Failed to update category", variant: "destructive" }),
    },
  });
  const remove = useDeleteCategory({
    mutation: {
      onSuccess: () => {
        onChanged();
        toast({ title: "Category deleted" });
      },
      onError: () => toast({ title: "Failed to delete category", variant: "destructive" }),
    },
  });

  const slugChanged = draftSlug.trim() !== category.slug;

  if (isEditing) {
    return (
      <li className="rounded-xl border border-border p-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`name-${category.id}`} className="text-xs">Name</Label>
            <Input
              id={`name-${category.id}`}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`slug-${category.id}`} className="text-xs">Slug</Label>
            <Input
              id={`slug-${category.id}`}
              value={draftSlug}
              onChange={(e) => setDraftSlug(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`desc-${category.id}`} className="text-xs">Description</Label>
          <Textarea
            id={`desc-${category.id}`}
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            rows={2}
          />
        </div>
        {slugChanged ? (
          <p className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Changing the slug breaks any external link to{" "}
              <code>/categories/{category.slug}</code>. The new URL will be{" "}
              <code>/categories/{draftSlug.trim() || category.slug}</code>.
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
                id: category.id,
                data: {
                  name: draftName.trim() || undefined,
                  slug: draftSlug.trim() || undefined,
                  description: draftDescription.trim().length > 0 ? draftDescription.trim() : null,
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
          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          {category.name}
        </div>
        {category.description ? (
          <p className="text-xs text-foreground/80 mt-0.5">{category.description}</p>
        ) : null}
        <p className="text-xs text-muted-foreground mt-0.5">
          /{category.slug} · {category.postCount}{" "}
          {category.postCount === 1 ? "post" : "posts"}
        </p>
      </div>
      <div className="flex items-center gap-1">
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
                Move &ldquo;{category.name}&rdquo; to the Recycle Bin?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {category.postCount === 0
                  ? "No posts use this category."
                  : `${category.postCount} ${category.postCount === 1 ? "post" : "posts"} tagged with this — the tag is restored on recovery.`}
                {" "}You can restore it or permanently delete it from the Recycle Bin.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => remove.mutate({ id: category.id })}
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

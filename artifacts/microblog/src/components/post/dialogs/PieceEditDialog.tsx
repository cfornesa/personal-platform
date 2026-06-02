import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  initialDescription: string;
  aiProfileId: number | null;
  onSave: (description: string) => Promise<void>;
  onAiImprove: (text: string) => Promise<string | null>;
  onReplace: () => void;
  onRemove: () => void;
};

export function PieceEditDialog({
  open,
  onOpenChange,
  initialTitle,
  initialDescription,
  aiProfileId,
  onSave,
  onAiImprove,
  onReplace,
  onRemove,
}: Props) {
  const [description, setDescription] = useState(initialDescription);
  const [isImproving, setIsImproving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDescription(initialDescription);
      setIsImproving(false);
      setIsSaving(false);
    }
  }, [open, initialDescription]);

  async function handleImprove() {
    const input = description.trim() || initialTitle.trim();
    if (!input) return;
    setIsImproving(true);
    try {
      const result = await onAiImprove(input);
      if (result !== null) setDescription(result);
    } finally {
      setIsImproving(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSave(description);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit piece</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {initialTitle && (
            <p className="text-sm font-medium text-foreground truncate" title={initialTitle}>
              {initialTitle}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="piece-desc">Description</Label>
            <div className="flex gap-1.5">
              <textarea
                id="piece-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe this piece…"
                rows={4}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-auto w-9 shrink-0 self-start"
                disabled={isImproving}
                title={aiProfileId !== null ? "Improve description with AI" : "No text generation AI profile configured — go to Admin → AI to add one"}
                onClick={() => void handleImprove()}
              >
                {isImproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="destructive" onClick={() => { onRemove(); onOpenChange(false); }}>
            Remove
          </Button>
          <Button type="button" variant="outline" onClick={() => { onReplace(); }}>
            Replace
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

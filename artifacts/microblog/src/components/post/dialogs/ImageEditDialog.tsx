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
  initialSrc: string;
  initialAlt: string;
  altTextVendor: string | null;
  onSave: (alt: string) => Promise<void>;
  onAiGenerate: () => Promise<string | null>;
  onReplace: () => void;
  onRemove: () => void;
};

export function ImageEditDialog({
  open,
  onOpenChange,
  initialSrc,
  initialAlt,
  altTextVendor,
  onSave,
  onAiGenerate,
  onReplace,
  onRemove,
}: Props) {
  const [alt, setAlt] = useState(initialAlt);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAlt(initialAlt);
      setIsGenerating(false);
      setIsSaving(false);
    }
  }, [open, initialAlt]);

  async function handleGenerate() {
    setIsGenerating(true);
    try {
      const result = await onAiGenerate();
      if (result !== null) setAlt(result);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSave(alt);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit image</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {initialSrc && (
            <img
              src={initialSrc}
              alt={alt || "Image preview"}
              className="h-32 w-full rounded-md border border-border object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="img-alt">Alt text</Label>
            <div className="flex gap-1.5">
              <textarea
                id="img-alt"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                placeholder="Describe this image…"
                maxLength={500}
                rows={3}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
              {altTextVendor && (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-auto w-9 shrink-0 self-start"
                  disabled={isGenerating}
                  title="Generate alt text with AI"
                  onClick={() => void handleGenerate()}
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </Button>
              )}
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

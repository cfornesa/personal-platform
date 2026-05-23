import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseIframeEmbed } from "../embed-utils";

type IframeAttrs = ReturnType<typeof parseIframeEmbed>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (attrs: NonNullable<IframeAttrs>) => void;
  initialCode?: string;
  onRemove?: () => void;
};

export function EmbedDialog({ open, onOpenChange, onApply, initialCode, onRemove }: Props) {
  const [code, setCode] = useState(initialCode ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCode(initialCode ?? "");
      setError(null);
    }
  }, [open, initialCode]);

  function handleApply() {
    const attrs = parseIframeEmbed(code.trim());
    if (!attrs) {
      setError("That code doesn't contain a valid iframe.");
      return;
    }
    onApply(attrs);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initialCode ? "Edit embed" : "Insert embed"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <textarea
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            placeholder="Paste the iframe embed code here…"
            rows={6}
            autoFocus
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          {onRemove && initialCode && (
            <Button type="button" variant="destructive" onClick={() => { onRemove(); onOpenChange(false); }}>
              Remove
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply} disabled={!code.trim()}>
            {initialCode ? "Update" : "Insert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

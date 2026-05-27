import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialHref?: string;
  initialLinkText?: string;
  initialOpenInNewTab?: boolean;
  onApply: (href: string, openInNewTab: boolean, linkText: string) => void;
  onRemove?: () => void;
};

export function LinkDialog({ open, onOpenChange, initialHref, initialLinkText, initialOpenInNewTab, onApply, onRemove }: Props) {
  const [href, setHref] = useState(initialHref ?? "https://");
  const [linkText, setLinkText] = useState(initialLinkText ?? "");
  const [openInNewTab, setOpenInNewTab] = useState(initialOpenInNewTab ?? false);

  useEffect(() => {
    if (open) {
      setHref(initialHref ?? "https://");
      setLinkText(initialLinkText ?? "");
      setOpenInNewTab(initialOpenInNewTab ?? false);
    }
  }, [open, initialHref, initialLinkText, initialOpenInNewTab]);

  function handleApply() {
    const trimmed = href.trim();
    if (!trimmed) return;
    onApply(trimmed, openInNewTab, linkText.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initialHref ? "Edit link" : "Insert link"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="link-text">Link text</Label>
            <input
              id="link-text"
              type="text"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApply()}
              placeholder="Descriptive link text"
              autoFocus
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-url">URL</Label>
            <input
              id="link-url"
              type="url"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApply()}
              placeholder="https://example.com"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={openInNewTab}
              onCheckedChange={(v) => setOpenInNewTab(v === true)}
            />
            Open in new tab
          </label>
        </div>
        <DialogFooter className="gap-2">
          {onRemove && initialHref && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                onRemove();
                onOpenChange(false);
              }}
            >
              Remove link
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply} disabled={!href.trim()}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

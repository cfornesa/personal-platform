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
import { parseYouTubeUrl } from "../embed-utils";

type IframeAttrs = ReturnType<typeof parseYouTubeUrl>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (attrs: NonNullable<IframeAttrs>) => void;
  initialUrl?: string;
  onRemove?: () => void;
};

export function YouTubeDialog({ open, onOpenChange, onApply, initialUrl, onRemove }: Props) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl ?? "");
      setError(null);
    }
  }, [open, initialUrl]);

  const videoId = (() => {
    try {
      const u = new URL(url.trim());
      if (u.hostname === "youtu.be") return u.pathname.slice(1);
      if (u.hostname.endsWith("youtube.com")) {
        if (u.pathname === "/watch") return u.searchParams.get("v") ?? "";
        const match = u.pathname.match(/\/(shorts|embed)\/([a-zA-Z0-9_-]{11})/);
        if (match) return match[2]!;
      }
    } catch {
      // not a valid URL yet
    }
    return null;
  })();

  const thumbnailUrl =
    videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)
      ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      : null;

  function handleApply() {
    const attrs = parseYouTubeUrl(url.trim());
    if (!attrs) {
      setError("Paste a valid youtube.com or youtu.be link.");
      return;
    }
    onApply(attrs);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initialUrl ? "Edit YouTube embed" : "Insert YouTube video"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="yt-url">YouTube URL</Label>
            <input
              id="yt-url"
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleApply()}
              placeholder="https://www.youtube.com/watch?v=…"
              autoFocus
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
          {thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt="Video thumbnail"
              className="w-full rounded-md border border-border object-cover"
            />
          )}
        </div>
        <DialogFooter className="gap-2">
          {onRemove && initialUrl && (
            <Button type="button" variant="destructive" onClick={() => { onRemove(); onOpenChange(false); }}>
              Remove
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply} disabled={!url.trim()}>
            {initialUrl ? "Update" : "Insert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

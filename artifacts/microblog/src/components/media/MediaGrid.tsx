import { useEffect, useState } from "react";
import { Copy, Loader2, Save, Sparkles, Trash2 } from "lucide-react";
import type { MediaAsset } from "@workspace/api-client-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Props = {
  assets: MediaAsset[];
  mode: "select" | "manage";
  selectedUrl?: string;
  onSelect?: (asset: MediaAsset) => void;
  onDelete?: (asset: MediaAsset) => void;
  isDeleting?: boolean;
  onSaveDetails?: (asset: MediaAsset, values: { title: string; altText: string }) => Promise<void>;
  onGenerateAltText?: (asset: MediaAsset, currentAltText: string) => Promise<string>;
};

function getAssetTitle(asset: MediaAsset) {
  return asset.title?.trim() || asset.filename;
}

type MediaDetailsDialogProps = {
  asset: MediaAsset | null;
  open: boolean;
  isDeleting?: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (asset: MediaAsset) => void;
  onSaveDetails?: (asset: MediaAsset, values: { title: string; altText: string }) => Promise<void>;
  onGenerateAltText?: (asset: MediaAsset, currentAltText: string) => Promise<string>;
};

function MediaDetailsDialog({
  asset,
  open,
  isDeleting,
  onOpenChange,
  onDelete,
  onSaveDetails,
  onGenerateAltText,
}: MediaDetailsDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [altText, setAltText] = useState("");
  const [savedTitle, setSavedTitle] = useState("");
  const [savedAltText, setSavedAltText] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);

  useEffect(() => {
    if (!asset || !open) return;
    const nextTitle = asset.title ?? "";
    const nextAltText = asset.altText ?? "";
    setTitle(nextTitle);
    setAltText(nextAltText);
    setSavedTitle(nextTitle);
    setSavedAltText(nextAltText);
    setDimensions(null);
    setSavingId(null);
    setGeneratingId(null);
    setIsDeleteConfirmOpen(false);
    setIsCloseConfirmOpen(false);
  }, [asset, open]);

  if (!asset) return null;
  const currentAsset = asset;

  const isDirty = title !== savedTitle || altText !== savedAltText;

  async function handleSave() {
    if (!onSaveDetails) return;
    setSavingId(currentAsset.id);
    try {
      await onSaveDetails(currentAsset, { title, altText });
      setSavedTitle(title);
      setSavedAltText(altText);
    } finally {
      setSavingId(null);
    }
  }

  async function handleGenerate() {
    if (!onGenerateAltText) return;
    setGeneratingId(currentAsset.id);
    try {
      const generated = await onGenerateAltText(currentAsset, altText);
      setAltText(generated);
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleCopyUrl() {
    const absoluteUrl = new URL(currentAsset.url, window.location.origin).toString();
    await navigator.clipboard.writeText(absoluteUrl);
    toast({ title: "Image URL copied" });
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen && isDirty) {
      setIsCloseConfirmOpen(true);
      return;
    }
    onOpenChange(nextOpen);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title.trim() || getAssetTitle(asset)}</DialogTitle>
            <DialogDescription className="sr-only">
              Preview image metadata and edit title or alt text.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex max-h-[48vh] items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
              <img
                src={asset.url}
                alt={altText || getAssetTitle(asset)}
                className="max-h-[48vh] w-auto max-w-full object-contain"
                onLoad={(event) => {
                  const image = event.currentTarget;
                  setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
                }}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`media-title-${asset.id}`}>Title</Label>
                <Input
                  id={`media-title-${asset.id}`}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={255}
                  placeholder="Image title"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Dimensions</Label>
                <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                  {dimensions ? `${dimensions.width} x ${dimensions.height}` : "Loading..."}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`media-alt-${asset.id}`}>Alt text</Label>
              <div className="flex gap-2">
                <Textarea
                  id={`media-alt-${asset.id}`}
                  value={altText}
                  onChange={(event) => setAltText(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Describe this image for screen readers"
                />
                {onGenerateAltText && (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-10 w-10 shrink-0"
                    onClick={() => void handleGenerate()}
                    disabled={generatingId === asset.id}
                    aria-label="Generate alt text with AI"
                    title="Generate alt text with AI"
                  >
                    {generatingId === asset.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>

            <dl className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-medium text-muted-foreground">Filename</dt>
                <dd className="break-all">{asset.filename}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">MIME type</dt>
                <dd>{asset.mimeType}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Uploaded</dt>
                <dd>{new Date(asset.uploadedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Local URL</dt>
                <dd className="break-all">{asset.url}</dd>
              </div>
            </dl>
          </div>

          <DialogFooter className="gap-2">
            {onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setIsDeleteConfirmOpen(true)}
                disabled={isDeleting}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => void handleCopyUrl()}>
              <Copy className="mr-2 h-4 w-4" />
              Copy URL
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={!onSaveDetails || !isDirty || savingId === asset.id}
            >
              {savingId === asset.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this image?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove "{getAssetTitle(asset)}" from the Image Library. Posts that already reference this image may no longer display it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDelete?.(asset);
                setIsDeleteConfirmOpen(false);
                onOpenChange(false);
              }}
            >
              Delete image
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isCloseConfirmOpen} onOpenChange={setIsCloseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved image details?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved title or alt text changes for this image. Closing now will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setIsCloseConfirmOpen(false);
                onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function MediaGrid({ assets, mode, selectedUrl, onSelect, onDelete, isDeleting, onSaveDetails, onGenerateAltText }: Props) {
  const [activeAsset, setActiveAsset] = useState<MediaAsset | null>(null);

  if (assets.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        No images uploaded yet
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {assets.map((asset) => {
        const isSelected = asset.url === selectedUrl;
        const title = getAssetTitle(asset);
        return (
          <div key={asset.id} className="group relative">
            <button
              type="button"
              onClick={() => {
                if (mode === "select") {
                  onSelect?.(asset);
                } else {
                  setActiveAsset(asset);
                }
              }}
              className={cn(
                "relative w-full overflow-hidden rounded-md border bg-muted transition-all cursor-pointer",
                mode === "select" && "hover:ring-2 hover:ring-primary/50 focus:outline-none focus:ring-2 focus:ring-primary",
                mode === "manage" && "hover:ring-2 hover:ring-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/30",
                (isSelected || (mode === "manage" && activeAsset?.id === asset.id)) && "ring-2 ring-primary",
              )}
              aria-label={`${mode === "select" ? "Select" : "Open"} ${title}`}
              aria-pressed={isSelected || (mode === "manage" && activeAsset?.id === asset.id)}
            >
              <img
                src={asset.url}
                alt={asset.altText || title}
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
              {isSelected && (
                <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                  <div className="rounded-full bg-primary p-0.5">
                    <svg className="h-3 w-3 text-primary-foreground" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              )}
            </button>
            <p className="mt-1 truncate px-0.5 text-xs font-medium">
              {title}
            </p>
            <p className="truncate px-0.5 text-[10px] text-muted-foreground">
              {new Date(asset.uploadedAt).toLocaleDateString()}
            </p>
          </div>
        );
      })}
      <MediaDetailsDialog
        asset={activeAsset}
        open={!!activeAsset}
        onOpenChange={(open) => { if (!open) setActiveAsset(null); }}
        isDeleting={isDeleting}
        onDelete={onDelete}
        onSaveDetails={onSaveDetails}
        onGenerateAltText={onGenerateAltText}
      />
    </div>
  );
}

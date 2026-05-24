import { useRef, useState } from "react";
import { ImagePlus, Link, Images, Save, Sparkles, Upload } from "lucide-react";
import {
  useDescribeImage,
  useImportMedia,
  useListMedia,
  useUpdateMediaAltText,
  useUploadMedia,
  getListMediaQueryKey,
  type MediaAsset,
  type DescribeImageBodyVendor,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ImmersiveMediaFrame } from "@/components/immersive/ImmersiveMediaFrame";
import { useToast } from "@/hooks/use-toast";
import { MediaGrid } from "./MediaGrid";
import { getUploadErrorMessage } from "@/components/post/upload-error";
import { buildImmersiveImageHref } from "@/lib/immersive-view";
import { cn } from "@/lib/utils";

type Tab = "library" | "upload" | "url";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (url: string, altText?: string) => void;
  currentUrl?: string;
  dialogTitle?: string;
  finalActionLabel?: string;
  closeWarningDescription?: string;
  /** Preferred vendor id for AI alt text generation. */
  altTextVendor?: string | null;
};

const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/avif";

export function FeaturedImagePicker({
  open,
  onOpenChange,
  onSelect,
  currentUrl,
  dialogTitle = "Set Featured Image",
  finalActionLabel = "Use this image",
  closeWarningDescription = "You have selected an image or started an upload/import, but have not inserted it yet.",
  altTextVendor,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("library");
  const [urlInput, setUrlInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [altTextDraft, setAltTextDraft] = useState("");
  const [isDirtyTitle, setIsDirtyTitle] = useState(false);
  const [isDirtyAlt, setIsDirtyAlt] = useState(false);
  const [pendingAsset, setPendingAsset] = useState<MediaAsset | null>(null);
  const [isCloseWarningOpen, setIsCloseWarningOpen] = useState(false);
  const [isGeneratingAlt, setIsGeneratingAlt] = useState(false);
  const [isSavingAlt, setIsSavingAlt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: assets = [], isLoading: isLoadingLibrary } = useListMedia({
    query: { enabled: open, queryKey: getListMediaQueryKey() },
  });

  const { mutateAsync: uploadMedia, isPending: isUploading } = useUploadMedia();
  const { mutateAsync: importMedia, isPending: isImporting } = useImportMedia();
  const { mutateAsync: updateAltText } = useUpdateMediaAltText();
  const { mutateAsync: describeImage } = useDescribeImage();

  function filenameFromMediaUrl(url: string) {
    return url.split("/").pop()?.split("?")[0] ?? "";
  }

  function makeLocalAsset(input: {
    url: string;
    title?: string | null;
    mimeType: string;
    altText?: string | null;
  }): MediaAsset {
    return {
      id: -Date.now(),
      url: input.url,
      filename: filenameFromMediaUrl(input.url),
      title: input.title ?? null,
      mimeType: input.mimeType,
      altText: input.altText ?? null,
      uploadedAt: new Date().toISOString(),
    };
  }

  function syncAltText(asset: MediaAsset) {
    setSelectedAsset(asset);
    setTitleDraft(asset.title ?? "");
    setAltTextDraft(asset.altText ?? "");
    setIsDirtyTitle(false);
    setIsDirtyAlt(false);
  }

  function resetStagedState() {
    setUrlInput("");
    setSelectedFile(null);
    setSelectedAsset(null);
    setTitleDraft("");
    setAltTextDraft("");
    setIsDirtyTitle(false);
    setIsDirtyAlt(false);
    setPendingAsset(null);
  }

  function hasUnfinishedImageAction() {
    return Boolean(selectedFile || urlInput.trim() || selectedAsset || isDirtyTitle || isDirtyAlt);
  }

  function closePickerDiscardingState() {
    resetStagedState();
    setIsCloseWarningOpen(false);
    onOpenChange(false);
  }

  function handleSelectAsset(asset: MediaAsset) {
    if ((isDirtyTitle || isDirtyAlt) && selectedAsset) {
      setPendingAsset(asset);
      return;
    }
    syncAltText(asset);
  }

  function handleDiscardAndSwitch() {
    if (pendingAsset) {
      syncAltText(pendingAsset);
      setPendingAsset(null);
    }
  }

  async function handleSaveAltAndSwitch() {
    if (selectedAsset) {
      await saveMediaDetails(selectedAsset);
    }
    if (pendingAsset) {
      syncAltText(pendingAsset);
      setPendingAsset(null);
    }
  }

  async function saveMediaDetails(asset: MediaAsset) {
    if (!asset.filename) {
      toast({ title: "Save failed", description: "Could not identify the media file.", variant: "destructive" });
      return;
    }
    setIsSavingAlt(true);
    try {
      await updateAltText({
        fileName: asset.filename,
        data: {
          title: titleDraft.trim() || null,
          altText: altTextDraft.trim() || null,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
      setSelectedAsset({ ...asset, title: titleDraft.trim() || null, altText: altTextDraft.trim() || null });
      setIsDirtyTitle(false);
      setIsDirtyAlt(false);
      toast({ title: "Image details saved" });
    } catch {
      toast({ title: "Save failed", description: "Could not save image details.", variant: "destructive" });
    } finally {
      setIsSavingAlt(false);
    }
  }

  async function handleGenerateAlt() {
    if (!selectedAsset || !altTextVendor) return;
    setIsGeneratingAlt(true);
    try {
      const result = await describeImage({
        data: {
          imageUrl: selectedAsset.url,
          vendor: altTextVendor as DescribeImageBodyVendor,
          ...(altTextDraft.trim() ? { existingAltText: altTextDraft.trim() } : {}),
        },
      });
      setAltTextDraft(result.altText);
      setIsDirtyAlt(result.altText !== (selectedAsset.altText ?? ""));
    } catch (error: any) {
      const code = error?.data?.code ?? error?.response?.data?.code;
      if (code === "vision_not_supported") {
        toast({
          title: "Vision not supported",
          description: "This AI model does not support image analysis. Choose a vision-capable model in Admin → AI → Task Preferences.",
          variant: "destructive",
        });
      } else {
        toast({ title: "AI failed", description: "Could not generate alt text.", variant: "destructive" });
      }
    } finally {
      setIsGeneratingAlt(false);
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setSelectedFile(file);
  }

  async function handleUploadSelectedFile() {
    if (!selectedFile) return;
    try {
      const result = await uploadMedia({ data: { file: selectedFile } });
      queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
      syncAltText(makeLocalAsset({
        url: result.url,
        title: result.title,
        mimeType: result.mimeType,
      }));
      setSelectedFile(null);
      toast({ title: "Image uploaded", description: "Add a description, then use the image." });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: getUploadErrorMessage(error),
        variant: "destructive",
      });
    }
  }

  async function handleUrlSubmit() {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    try {
      const result = await importMedia({
        data: {
          imageUrl: trimmed,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
      syncAltText(makeLocalAsset({
        url: result.url,
        title: result.title,
        mimeType: result.mimeType,
      }));
      setUrlInput("");
      toast({ title: "Image imported", description: "Add or generate a description, then use the image." });
    } catch (error) {
      toast({
        title: "Import failed",
        description: getUploadErrorMessage(error),
        variant: "destructive",
      });
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Images }[] = [
    { id: "library", label: "Library", icon: Images },
    { id: "upload", label: "Upload", icon: ImagePlus },
    { id: "url", label: "URL", icon: Link },
  ];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            if (hasUnfinishedImageAction()) {
              setIsCloseWarningOpen(true);
              return;
            }
            resetStagedState();
          }
          onOpenChange(nextOpen);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription className="sr-only">
              Choose an existing image, upload a file, or import an external image URL.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1 border-b border-border pb-0">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 pb-2 text-sm transition-colors border-b-2 -mb-px",
                  activeTab === id
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-[240px]">
            {activeTab === "library" && (
              <div className="space-y-3">
                {isLoadingLibrary ? (
                  <div className="flex h-40 items-center justify-center">
                    <Spinner className="h-5 w-5" />
                  </div>
                ) : (
                  <MediaGrid
                    assets={assets}
                    mode="select"
                    selectedUrl={selectedAsset?.url ?? currentUrl}
                    onSelect={handleSelectAsset}
                  />
                )}
                {!selectedAsset && assets.length > 0 && (
                  <p className="text-center text-xs text-muted-foreground">Select an image to use it as the featured image</p>
                )}
              </div>
            )}

            {activeTab === "upload" && (
              <div className="flex flex-col items-center justify-center gap-4 py-8">
                <div
                  className="flex w-full cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border p-8 transition-colors hover:border-primary/50 hover:bg-muted/30"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Click to upload an image"
                >
                  {isUploading ? (
                    <>
                      <Spinner className="h-6 w-6" />
                      <p className="text-sm text-muted-foreground">Uploading…</p>
                    </>
                  ) : (
                    <>
                      <ImagePlus className="h-8 w-8 text-muted-foreground" />
                      <div className="text-center">
                        <p className="text-sm font-medium">Click to upload</p>
                        <p className="mt-1 text-xs text-muted-foreground">PNG, JPEG, WebP, GIF, AVIF · max 8 MB</p>
                      </div>
                    </>
                  )}
                </div>
                {selectedFile && (
                  <div className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => void handleUploadSelectedFile()}
                      disabled={isUploading}
                      className="shrink-0 gap-2"
                    >
                      <Upload className="h-4 w-4" />
                      {isUploading ? "Uploading..." : "Upload image"}
                    </Button>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES}
                  aria-label="Choose image file"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={isUploading}
                />
              </div>
            )}

            {activeTab === "url" && (
              <div className="flex flex-col gap-3 py-4">
                <label className="text-sm font-medium" htmlFor="featured-image-url-input">
                  External image URL
                </label>
                <div className="flex gap-2">
                  <input
                    id="featured-image-url-input"
                    type="url"
                    placeholder="https://example.com/image.jpg"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleUrlSubmit()}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <Button
                    type="button"
                    onClick={() => void handleUrlSubmit()}
                    disabled={!urlInput.trim() || isImporting}
                  >
                    {isImporting ? "Importing..." : "Import image"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Imports a local copy for reuse. PNG, JPEG, WebP, GIF, AVIF · max 8 MB.
                </p>
                {urlInput.trim() && (
                  <img
                    src={urlInput.trim()}
                    alt="Preview"
                    className="mt-1 h-24 w-full rounded-md border border-border object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    onLoad={(e) => { (e.target as HTMLImageElement).style.display = ""; }}
                  />
                )}
              </div>
            )}

            {selectedAsset && (
              <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
                <div className="mb-3 flex gap-3">
                  <ImmersiveMediaFrame
                    href={buildImmersiveImageHref(selectedAsset.url, {
                      alt: altTextDraft || selectedAsset.title || selectedAsset.filename,
                      title: titleDraft || selectedAsset.title || selectedAsset.filename,
                    })}
                    label="Open selected image in immersive view"
                    className="shrink-0"
                    buttonClassName="bottom-2 right-2 h-8 min-w-8 px-2 text-[10px]"
                  >
                    <img
                      src={selectedAsset.url}
                      alt={altTextDraft || selectedAsset.title || selectedAsset.filename}
                      className="h-20 w-28 rounded border border-border object-cover"
                    />
                  </ImmersiveMediaFrame>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{selectedAsset.title || selectedAsset.filename}</p>
                    <p className="break-all text-xs text-muted-foreground">{selectedAsset.url}</p>
                  </div>
                </div>
                <div className="mb-3 space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="selected-image-title">
                    Title
                  </label>
                  <input
                    id="selected-image-title"
                    type="text"
                    value={titleDraft}
                    onChange={(e) => {
                      setTitleDraft(e.target.value);
                      setIsDirtyTitle(e.target.value !== (selectedAsset.title ?? ""));
                    }}
                    placeholder="Image title"
                    maxLength={255}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Image description</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={altTextDraft}
                    onChange={(e) => {
                      setAltTextDraft(e.target.value);
                      setIsDirtyAlt(e.target.value !== (selectedAsset.altText ?? ""));
                    }}
                    placeholder="Describe this image for screen readers"
                    maxLength={500}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  {altTextVendor && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5"
                      onClick={handleGenerateAlt}
                      disabled={isGeneratingAlt}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {isGeneratingAlt ? "Generating..." : "AI"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={cn("shrink-0 gap-1.5", (isDirtyTitle || isDirtyAlt) && "border-primary text-primary")}
                    onClick={() => saveMediaDetails(selectedAsset)}
                    disabled={(!isDirtyTitle && !isDirtyAlt) || isSavingAlt}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {isSavingAlt ? "Saving..." : "Save"}
                  </Button>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    onClick={async () => {
                      if (isDirtyTitle || isDirtyAlt) {
                        await saveMediaDetails(selectedAsset);
                      }
                      onSelect(selectedAsset.url, altTextDraft || undefined);
                      resetStagedState();
                      onOpenChange(false);
                    }}
                    disabled={isSavingAlt}
                  >
                    {finalActionLabel}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingAsset} onOpenChange={(v) => { if (!v) setPendingAsset(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved image details</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this image. What would you like to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingAsset(null)}>Keep editing</AlertDialogCancel>
            <AlertDialogCancel onClick={handleDiscardAndSwitch}>Discard</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveAltAndSwitch}>Save &amp; switch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isCloseWarningOpen} onOpenChange={setIsCloseWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard image changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {closeWarningDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={closePickerDiscardingState}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

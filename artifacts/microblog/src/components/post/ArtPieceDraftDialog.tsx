import { useCallback, useEffect, useState } from "react";
import type { GeneratedArtPieceDraft } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArtPieceRenderer } from "./ArtPieceRenderer";

type ArtPieceDraftDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: GeneratedArtPieceDraft | null;
  prompt: string;
  isSaving: boolean;
  onSaveAndInsert: () => void;
};

export function ArtPieceDraftDialog({
  open,
  onOpenChange,
  draft,
  prompt,
  isSaving,
  onSaveAndInsert,
}: ArtPieceDraftDialogProps) {
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  const [isPreviewValid, setIsPreviewValid] = useState(false);
  const [viewTab, setViewTab] = useState<"preview" | "html" | "css" | "js">("preview");

  const handleStatusChange = useCallback(
    (status: { valid: boolean; error: string | null; warning?: string | null }) => {
      setIsPreviewValid(status.valid);
      setPreviewError(status.error);
      setPreviewWarning(status.warning ?? null);
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      setPreviewError(null);
      setPreviewWarning(null);
      setIsPreviewValid(false);
      setViewTab("preview");
    }
  }, [open, draft?.draftToken]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[90vw] max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{draft?.title ?? "Generated piece"}</DialogTitle>
          <DialogDescription>
            Review the generated interactive piece, regenerate it from the same prompt, or save it to your library and insert it into the post.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 border-b border-border pb-2">
          <button
            type="button"
            onClick={() => setViewTab("preview")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${viewTab === "preview" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setViewTab("html")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${viewTab === "html" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            HTML
          </button>
          <button
            type="button"
            onClick={() => setViewTab("css")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${viewTab === "css" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            CSS
          </button>
          <button
            type="button"
            onClick={() => setViewTab("js")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${viewTab === "js" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            JS
          </button>
        </div>

        <div className="overflow-y-auto min-h-0 space-y-4">
          {open && draft && viewTab === "preview" ? (
            <>
              <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                <p><span className="font-medium text-foreground">Prompt:</span> {prompt}</p>
                <p className="mt-1">
                  <span className="font-medium text-foreground">Runtime:</span> {draft.engine}
                  {draft.vendorLabel ? ` via ${draft.vendorLabel}` : ""}
                  {draft.model ? ` (${draft.model})` : ""}
                </p>
                <p className="mt-1">
                  <span className="font-medium text-foreground">Attempts:</span> {draft.attemptCount} / {draft.maxAttempts}
                </p>
                {draft.notes ? (
                  <p className="mt-1"><span className="font-medium text-foreground">Notes:</span> {draft.notes}</p>
                ) : null}
              </div>
              <ArtPieceRenderer
                engine={draft.engine}
                code={draft.generatedCode}
                htmlCode={draft.htmlCode}
                cssCode={draft.cssCode}
                onStatusChange={handleStatusChange}
                diagnostics
              />
              {previewError ? (
                <p className="text-sm text-destructive">
                  This draft is server-validated, but the browser preview still failed: {previewError}
                </p>
              ) : null}
              {!previewError && previewWarning ? (
                <p className="text-sm text-amber-700">
                  Preview warning: {previewWarning}
                </p>
              ) : null}
            </>
          ) : null}
          {open && draft && viewTab === "html" ? (
            <pre className="p-4 text-xs font-mono bg-muted/50 rounded-lg overflow-x-auto whitespace-pre-wrap">
              {draft.htmlCode || "(No HTML code provided)"}
            </pre>
          ) : null}
          {open && draft && viewTab === "css" ? (
            <pre className="p-4 text-xs font-mono bg-muted/50 rounded-lg overflow-x-auto whitespace-pre-wrap">
              {draft.cssCode || "(No CSS code provided)"}
            </pre>
          ) : null}
          {open && draft && viewTab === "js" ? (
            <pre className="p-4 text-xs font-mono bg-muted/50 rounded-lg overflow-x-auto whitespace-pre-wrap">
              {draft.generatedCode}
            </pre>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={!draft || isSaving || !isPreviewValid} onClick={onSaveAndInsert}>
            {isSaving ? "Saving..." : "Save to library and insert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

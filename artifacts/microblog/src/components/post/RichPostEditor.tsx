import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2, Code2, ImagePlus, Link2, MoreHorizontal, Pilcrow, Redo2, Sparkles, Undo2, Youtube } from "lucide-react";
import {
  ApiError,
  type ArtPieceEngine,
  generateArtPiece as requestGeneratedArtPiece,
  useCreateArtPiece,
  useDescribeImage,
  useListArtPieces,
  useProcessAiText,
  useUpdateArtPiece,
  useUpdateMediaAltText,
  type GeneratedArtPieceDraft,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  normalizePieceEmbedUrls,
  ensureNormalizedParagraphHtml as ensureParagraphHtml,
} from "@/lib/content-normalization";
import { useSiteSettings } from "@/hooks/use-site-settings";
import { IframeEmbed } from "./iframe-embed";
import { CategoryMultiSelect } from "./CategoryMultiSelect";
import { PlatformMultiSelect } from "./PlatformMultiSelect";
import { getAiFailureMessage } from "./ai-error";
import type { EnabledPlatformConnection } from "@/hooks/use-enabled-platform-connections";
import { ArtPieceDraftDialog } from "./ArtPieceDraftDialog";
import { ArtPieceGenerationDialog, type ArtPieceGenerationState } from "./ArtPieceGenerationDialog";
import { ArtPieceLibraryDialog } from "./ArtPieceLibraryDialog";
import { ExhibitLibraryDialog } from "./ExhibitLibraryDialog";
import { FeaturedImagePicker } from "@/components/media/FeaturedImagePicker";
import { partitionEditorContent } from "@/lib/editor-utils";
import { LinkDialog } from "./dialogs/LinkDialog";
import { EmbedDialog } from "./dialogs/EmbedDialog";
import { YouTubeDialog } from "./dialogs/YouTubeDialog";
import { ImageInsertDialog } from "./dialogs/ImageInsertDialog";
import { ImageEditDialog } from "./dialogs/ImageEditDialog";
import { PieceEditDialog } from "./dialogs/PieceEditDialog";
import { persistArtPieceThumbnail } from "@/lib/art-piece-thumbnail";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type RichPostEditorProps = {
  initialContent: string;
  initialTitle?: string;
  placeholder?: string;
  submitLabel: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  /** Initial selected category ids (empty array == no categories). */
  initialCategoryIds?: number[];
  /** Initial selected platform ids (empty array == no platforms pre-selected). */
  initialPlatformIds?: number[];
  /**
   * When omitted, the category multiselect is hidden — used by
   * non-owner edit surfaces (none today) and by tests that want a
   * minimal editor.
   */
  showCategories?: boolean;
  textProfiles?: Array<{ id: number; label: string }>;
  /** Subset of textProfiles that support piece generation. */
  pieceProfiles?: Array<{ id: number; label: string }>;
  /** Pre-selected profile ID for text improvement (skips dropdown). */
  preferredTextImproveProfileId?: number | null;
  /** Pre-selected profile ID for image alt text generation. */
  preferredAltTextProfileId?: number | null;
  /** Enabled platform connections to show in the "Share to:" selector. Omit to hide it. */
  platformConnections?: EnabledPlatformConnection[];
  /** Initial featured image URL (for edit mode). */
  initialFeaturedImageUrl?: string | null;
  /** Initial per-platform social post drafts (for edit mode). */
  initialSocialPostDrafts?: { bluesky?: string; linkedin?: string; facebook?: string; instagram?: string } | null;
  onCancel?: () => void;
  onSubmit: (payload: {
    title: string;
    content: string;
    contentFormat: "html";
    categoryIds: number[];
    platformIds: number[];
    substackSendNewsletter: boolean;
    featuredImageUrl: string | null;
    socialPostDrafts: { bluesky?: string; linkedin?: string; facebook?: string; instagram?: string } | null;
  }) => void;
  /**
   * Optional live-content listener. Fires on every editor update so a
   * parent can mirror the current HTML and persist it via its own save
   * button (used by the page editor — its Save/Publish buttons aren't
   * the editor's onSubmit).
   */
  onContentChange?: (html: string) => void;
  onUpload: (file: File) => Promise<string>;
  /** Set to false to hide the internal title input (e.g. when the parent already renders its own title field). */
  showTitle?: boolean;
};

function getEditorTextLength(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

function extractFirstImageSrc(html: string): string | null {
  const document = new DOMParser().parseFromString(html, "text/html");
  const src = document.querySelector("img[src]")?.getAttribute("src")?.trim();
  return src || null;
}

function isPieceEmbedSrc(src: string): boolean {
  try {
    const path = src.startsWith("http") ? new URL(src).pathname : src;
    return path.startsWith("/embed/pieces/");
  } catch {
    return false;
  }
}

function buildPieceIframeAttrs(piece: {
  id: number;
  title: string;
  prompt: string;
  currentVersionId: number;
}) {
  return {
    src: `/embed/pieces/${piece.id}`,
    width: "100%",
    height: "480",
    title: piece.title,
    ariaLabel: piece.prompt || undefined,
    loading: "lazy",
    frameborder: "0",
    sandbox: "allow-scripts allow-same-origin",
  };
}

function buildExhibitIframeAttrs(exhibit: { slug: string; name: string }) {
  return {
    src: `/immersive/exhibits/${exhibit.slug}?embed=1`,
    width: "100%",
    height: "480",
    title: exhibit.name,
    loading: "lazy",
    frameborder: "0",
    sandbox: "allow-scripts allow-same-origin",
  };
}

const MAX_PIECE_GENERATION_ATTEMPTS = 3;

export function RichPostEditor({
  initialContent,
  initialTitle = "",
  placeholder = "Write something worth lingering on...",
  submitLabel,
  cancelLabel = "Cancel",
  isSubmitting = false,
  initialCategoryIds = [],
  initialPlatformIds = [],
  showCategories = true,
  textProfiles = [],
  pieceProfiles = [],
  preferredTextImproveProfileId,
  preferredAltTextProfileId,
  platformConnections,
  initialFeaturedImageUrl,
  initialSocialPostDrafts,
  onCancel,
  onSubmit,
  onContentChange,
  onUpload,
  showTitle = true,
}: RichPostEditorProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(initialTitle);
  const [featuredImageUrl, setFeaturedImageUrl] = useState<string>(initialFeaturedImageUrl ?? "");
  const [featuredImageSource, setFeaturedImageSource] = useState<"manual" | "auto" | null>(
    initialFeaturedImageUrl?.trim() ? "manual" : null,
  );
  const [socialPostDrafts, setSocialPostDrafts] = useState<{ bluesky: string; linkedin: string; facebook: string; instagram: string }>({
    bluesky: initialSocialPostDrafts?.bluesky ?? "",
    linkedin: initialSocialPostDrafts?.linkedin ?? "",
    facebook: initialSocialPostDrafts?.facebook ?? "",
    instagram: initialSocialPostDrafts?.instagram ?? "",
  });
  const [textLength, setTextLength] = useState(getEditorTextLength(initialContent));
  const [categoryIds, setCategoryIds] = useState<number[]>(initialCategoryIds);
  const [platformIds, setPlatformIds] = useState<number[]>(initialPlatformIds ?? []);
  const [substackSendNewsletter, setSubstackSendNewsletter] = useState(false);
  const artPiecesList = useListArtPieces();
  const hasPieces = (artPiecesList.data?.pieces?.length ?? 0) > 0;

  const [selectedAiProfileId, setSelectedAiProfileId] = useState<number | null>(textProfiles[0]?.id ?? null);
  const [selectedAiMode, setSelectedAiMode] = useState<"text" | "piece">("text");
  const [selectedPieceEngine, setSelectedPieceEngine] = useState<ArtPieceEngine>("p5");
  const [pieceDraft, setPieceDraft] = useState<GeneratedArtPieceDraft | null>(null);
  const [pieceDraftPrompt, setPieceDraftPrompt] = useState("");
  const [isPieceDraftOpen, setIsPieceDraftOpen] = useState(false);
  const [savingPieceDraftToken, setSavingPieceDraftToken] = useState<string | null>(null);
  const [isPersistingPieceThumbnail, setIsPersistingPieceThumbnail] = useState(false);
  const [isPieceLibraryOpen, setIsPieceLibraryOpen] = useState(false);
  const [isExhibitLibraryOpen, setIsExhibitLibraryOpen] = useState(false);
  const [pieceGenerationState, setPieceGenerationState] = useState<ArtPieceGenerationState | null>(null);
  const [isFeaturedPickerOpen, setIsFeaturedPickerOpen] = useState(false);
  const [isCancelWarningOpen, setIsCancelWarningOpen] = useState(false);
  const [pendingNavUrl, setPendingNavUrl] = useState<string | null>(null);
  const origPushStateRef = useRef(window.history.pushState.bind(window.history));
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDialogInitialText, setLinkDialogInitialText] = useState("");
  const [embedDialogOpen, setEmbedDialogOpen] = useState(false);
  const [youTubeDialogOpen, setYouTubeDialogOpen] = useState(false);
  const [isHtmlMode, setIsHtmlMode] = useState(false);
  const [htmlSource, setHtmlSource] = useState("");
  const [imageInsertDialogOpen, setImageInsertDialogOpen] = useState(false);
  type ImageEditState = { src: string; alt: string; pos: number };
  type PieceEditState = { src: string; ariaLabel: string; title: string; pos: number };
  type EmbedEditState = { initialCode: string; pos: number };
  type YouTubeEditState = { initialUrl: string; pos: number };
  const [imageEditState, setImageEditState] = useState<ImageEditState | null>(null);
  const [pieceEditState, setPieceEditState] = useState<PieceEditState | null>(null);
  const [embedEditState, setEmbedEditState] = useState<EmbedEditState | null>(null);
  const [youTubeEditState, setYouTubeEditState] = useState<YouTubeEditState | null>(null);
  const pieceGenerationAbortRef = useRef<AbortController | null>(null);
  const processAiText = useProcessAiText({
    mutation: {
      onError: (error: any) => {
        const message = getAiFailureMessage(error);
        toast({ title: "AI request failed", description: message, variant: "destructive" });
      },
    },
  });
  const createArtPiece = useCreateArtPiece();
  const { mutateAsync: describeImageForBubble } = useDescribeImage();
  const { mutateAsync: updateMediaAltText } = useUpdateMediaAltText();
  const { mutateAsync: updateArtPieceForBubble } = useUpdateArtPiece();

  const { data: siteSettings } = useSiteSettings();
  const canonicalOrigin = 
    (window as any).__CANONICAL_ORIGIN__ || 
    siteSettings?.allowedOrigins?.[0] || 
    window.location.origin;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Image,
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Underline,
      IframeEmbed,
    ],
    content: ensureParagraphHtml(initialContent, canonicalOrigin),
    editorProps: {
      attributes: {
        class:
          "wysiwyg-editor-content min-h-[220px] rounded-b-2xl border border-t-0 border-border bg-background px-4 py-4 pb-16 text-base leading-relaxed focus:outline-none prose prose-neutral dark:prose-invert max-w-none prose-p:my-3 prose-h1:mt-7 prose-h1:mb-4 prose-h2:mt-6 prose-h2:mb-3 prose-h3:mt-5 prose-h3:mb-2 prose-h4:mt-4 prose-h4:mb-2 prose-h5:mt-4 prose-h5:mb-2 prose-h6:mt-4 prose-h6:mb-2 prose-strong:font-extrabold prose-strong:text-foreground prose-img:rounded-xl prose-img:border prose-img:border-border prose-iframe:w-full prose-iframe:rounded-xl prose-iframe:border prose-iframe:border-border",
      },
    },
    onUpdate({ editor: nextEditor }) {
      setTextLength(nextEditor.getText().trim().length);
      onContentChange?.(nextEditor.getHTML());
    },
  });

  async function handleSavePieceDraftAndInsert() {
    if (!pieceDraft || !editor) return;
    if (savingPieceDraftToken === pieceDraft.draftToken) return;
    setSavingPieceDraftToken(pieceDraft.draftToken);
    let pieceWasSaved = false;
    try {
      const response = await createArtPiece.mutateAsync({
        data: {
          draftToken: pieceDraft.draftToken,
        },
      });
      pieceWasSaved = true;
      setIsPieceDraftOpen(false);
      setPieceDraft(null);
      setSavingPieceDraftToken(null);
      setIsPersistingPieceThumbnail(true);
      await persistArtPieceThumbnail(response);
      editor.chain().focus().insertIframe(
        buildPieceIframeAttrs({
          id: response.id,
          title: response.title,
          prompt: response.prompt,
          currentVersionId: response.currentVersionId!,
        }),
      ).run();
      toast({
        title: "Piece saved",
        description: "The new piece was saved with a thumbnail and embedded into the post.",
      });
    } catch (error) {
      const message = getAiFailureMessage(error);
      toast({
        title: pieceWasSaved ? "Thumbnail generation failed" : "Saving piece failed",
        description: pieceWasSaved
          ? message || "The piece was saved, but its exhibit thumbnail could not be created."
          : message,
        variant: "destructive",
      });
    } finally {
      setIsPersistingPieceThumbnail(false);
      if (!pieceWasSaved) {
        setSavingPieceDraftToken((current) => current === pieceDraft.draftToken ? null : current);
      }
    }
  }

  useEffect(() => {
    if (!editor) {
      return;
    }

    const nextContent = ensureParagraphHtml(initialContent, canonicalOrigin);
    if (editor.getHTML() !== nextContent) {
      editor.commands.setContent(nextContent, { emitUpdate: true });
    }
  }, [editor, initialContent, canonicalOrigin]);

  useEffect(() => {
    if (textProfiles.length === 0) {
      if (selectedAiProfileId !== null) setSelectedAiProfileId(null);
      return;
    }
    if (!textProfiles.some((p) => p.id === selectedAiProfileId)) {
      setSelectedAiProfileId(textProfiles[0]!.id);
    }
    if (selectedAiMode === "piece") {
      if (pieceProfiles.length === 0 && !hasPieces) {
        setSelectedAiMode("text");
      } else if (pieceProfiles.length > 0 && !pieceProfiles.some((p) => p.id === selectedAiProfileId) && pieceProfiles[0]) {
        setSelectedAiProfileId(pieceProfiles[0].id);
      }
    }
  }, [textProfiles, hasPieces, pieceProfiles, selectedAiProfileId, selectedAiMode]);

  useEffect(() => {
    if (preferredTextImproveProfileId != null && textProfiles.some((p) => p.id === preferredTextImproveProfileId)) {
      setSelectedAiProfileId(preferredTextImproveProfileId);
    }
  }, [preferredTextImproveProfileId]);

  const substackConnection = (platformConnections ?? []).find((connection) => connection.platform === "substack");
  const isSubstackSelected = substackConnection ? platformIds.includes(substackConnection.id) : false;

  useEffect(() => {
    if (!isSubstackSelected && substackSendNewsletter) {
      setSubstackSendNewsletter(false);
    }
  }, [isSubstackSelected, substackSendNewsletter]);

  useEffect(() => () => {
    pieceGenerationAbortRef.current?.abort();
    pieceGenerationAbortRef.current = null;
  }, []);

  const initialEditorContent = ensureParagraphHtml(initialContent, canonicalOrigin);
  const initialSocialNormalized = {
    bluesky: initialSocialPostDrafts?.bluesky ?? "",
    linkedin: initialSocialPostDrafts?.linkedin ?? "",
    facebook: initialSocialPostDrafts?.facebook ?? "",
    instagram: initialSocialPostDrafts?.instagram ?? "",
  };
  const isDirty =
    title !== (initialTitle ?? "") ||
    featuredImageUrl !== (initialFeaturedImageUrl ?? "") ||
    JSON.stringify(categoryIds) !== JSON.stringify(initialCategoryIds ?? []) ||
    JSON.stringify(socialPostDrafts) !== JSON.stringify(initialSocialNormalized) ||
    (editor ? (isHtmlMode ? htmlSource !== initialEditorContent : editor.getHTML() !== initialEditorContent) : false);

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const orig = origPushStateRef.current;
    if (!isDirty) {
      window.history.pushState = orig;
      return;
    }
    window.history.pushState = function (data, title, url) {
      const dest = typeof url === "string" ? url : String(url ?? "");
      if (dest && dest !== window.location.pathname + window.location.search) {
        setPendingNavUrl(dest);
      } else {
        orig(data, title, url);
      }
    };
    return () => {
      window.history.pushState = orig;
    };
  }, [isDirty]);

  function handleInsertLink() {
    if (!editor) return;
    const { selection } = editor.state;
    const selected = selection.empty
      ? ""
      : editor.state.doc.textBetween(selection.from, selection.to, " ");
    setLinkDialogInitialText(selected);
    setLinkDialogOpen(true);
  }

  function handleInsertEmbed() {
    if (!editor) return;
    setEmbedDialogOpen(true);
  }

  function handleInsertYouTube() {
    if (!editor) return;
    setYouTubeDialogOpen(true);
  }

  function handleEditorContentClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!editor || isHtmlMode) return;
    const target = event.target as Element;
    if (!editor.view.dom.contains(target)) return;

    if (target.closest("a")) {
      const anchorEl = target.closest("a");
      const existingText = anchorEl?.textContent?.trim() ?? "";
      setLinkDialogInitialText(existingText);
      setLinkDialogOpen(true);
      return;
    }

    const imgEl = target.closest("img");
    if (imgEl) {
      const src = imgEl.getAttribute("src") ?? "";
      const alt = imgEl.getAttribute("alt") ?? "";
      const posResult = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      let pos = -1;
      if (posResult) {
        for (const p of [posResult.pos, posResult.pos - 1, posResult.inside]) {
          if (p >= 0 && editor.state.doc.nodeAt(p)?.type.name === "image") { pos = p; break; }
        }
      }
      setImageEditState({ src, alt, pos });
      return;
    }

    const posResult = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!posResult) return;
    let iframeNode: ReturnType<typeof editor.state.doc.nodeAt> = null;
    let iframePos = -1;
    for (const p of [posResult.pos, posResult.pos - 1, posResult.inside]) {
      if (p >= 0) {
        const candidate = editor.state.doc.nodeAt(p);
        if (candidate?.type.name === "iframeEmbed") { iframeNode = candidate; iframePos = p; break; }
      }
    }
    if (!iframeNode || iframePos === -1) return;
    const src = String(iframeNode.attrs.src ?? "");
    if (isPieceEmbedSrc(src)) {
      setPieceEditState({
        src,
        ariaLabel: String(iframeNode.attrs.ariaLabel ?? ""),
        title: String(iframeNode.attrs.title ?? ""),
        pos: iframePos,
      });
    } else if (src.includes("youtube.com/embed/")) {
      const videoId = src.match(/youtube\.com\/embed\/([^?&]+)/)?.[1] ?? "";
      setYouTubeEditState({ initialUrl: `https://www.youtube.com/watch?v=${videoId}`, pos: iframePos });
    } else {
      const a = iframeNode.attrs as Record<string, string>;
      const code = `<iframe src="${src}"${a.width ? ` width="${a.width}"` : ""}${a.height ? ` height="${a.height}"` : ""}${a.allow ? ` allow="${a.allow}"` : ""} frameborder="${a.frameborder ?? "0"}"${a.sandbox ? ` sandbox="${a.sandbox}"` : ""}></iframe>`;
      setEmbedEditState({ initialCode: code, pos: iframePos });
    }
  }

  function handleSubmit() {
    if (!editor) {
      return;
    }

    const rawHtml = isHtmlMode ? htmlSource : editor.getHTML();
    const html = normalizePieceEmbedUrls(rawHtml, canonicalOrigin);
    const meaningfulHtml = html
      .replace(/<p><\/p>/g, "")
      .replace(/<p>\s*<\/p>/g, "")
      .trim();

    if (meaningfulHtml === "") {
      return;
    }

    const trimmedImageUrl = featuredImageUrl.trim();
    const submittedFeaturedImageUrl = trimmedImageUrl || extractFirstImageSrc(html);
    const hasSocialDrafts = socialPostDrafts.bluesky.trim() || socialPostDrafts.linkedin.trim() || socialPostDrafts.facebook.trim() || socialPostDrafts.instagram.trim();
    onSubmit({
      title: title.trim(),
      content: html,
      contentFormat: "html",
      categoryIds,
      platformIds,
      substackSendNewsletter,
      featuredImageUrl: submittedFeaturedImageUrl || null,
      socialPostDrafts: hasSocialDrafts
        ? {
            bluesky: socialPostDrafts.bluesky.trim() || undefined,
            linkedin: socialPostDrafts.linkedin.trim() || undefined,
            facebook: socialPostDrafts.facebook.trim() || undefined,
            instagram: socialPostDrafts.instagram.trim() || undefined,
          }
        : null,
    });
  }

  function stopPieceGeneration() {
    const activeState = pieceGenerationState;
    pieceGenerationAbortRef.current?.abort();
    pieceGenerationAbortRef.current = null;
    if (activeState) {
      setPieceGenerationState({
        ...activeState,
        open: true,
        phase: "cancelled",
        attemptCount: Math.max(activeState.attemptCount, 1),
        approximateAttempts: true,
        message: "Generation stopped before the server could finish validating a draft.",
      });
    }
  }

  async function generatePieceDraft(prompt: string) {
    if (!selectedAiProfileId) {
      return;
    }

    pieceGenerationAbortRef.current?.abort();
    const controller = new AbortController();
    pieceGenerationAbortRef.current = controller;

    const selectedVendorLabel = textProfiles.find((p) => p.id === selectedAiProfileId)?.label ?? String(selectedAiProfileId);

    setPieceGenerationState({
      open: true,
      phase: "generating",
      prompt,
      engine: selectedPieceEngine,
      vendorLabel: selectedVendorLabel,
      model: null,
      attemptCount: 1,
      maxAttempts: MAX_PIECE_GENERATION_ATTEMPTS,
      message: null,
      startedAt: Date.now(),
      approximateAttempts: false,
    });

    try {
      const response = await requestGeneratedArtPiece(
        {
          prompt,
          engine: selectedPieceEngine,
          profileId: selectedAiProfileId ?? 0,
        },
        { signal: controller.signal },
      );

      setPieceDraft(response);
      setPieceDraftPrompt(prompt);
      setPieceGenerationState(null);
      setIsPieceDraftOpen(true);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      let message = getAiFailureMessage(error);
      let attemptCount = 1;
      let maxAttempts = MAX_PIECE_GENERATION_ATTEMPTS;
      let phase: ArtPieceGenerationState["phase"] = "failed";

      if (error instanceof ApiError && error.data && typeof error.data === "object") {
        const body = error.data as Record<string, unknown>;
        if (typeof body.error === "string" && body.error.trim()) {
          message = body.error;
        }
        if (typeof body.attemptCount === "number" && Number.isFinite(body.attemptCount)) {
          attemptCount = body.attemptCount;
        }
        if (typeof body.maxAttempts === "number" && Number.isFinite(body.maxAttempts)) {
          maxAttempts = body.maxAttempts;
        }
        if (body.timedOut === true) {
          phase = "timedOut";
        } else if (body.cancelled === true) {
          phase = "cancelled";
        }
        const engine =
          typeof body.engine === "string" && body.engine.trim()
            ? body.engine
            : selectedPieceEngine;
        const failureStage =
          typeof body.failureStage === "string" && body.failureStage.trim()
            ? body.failureStage
            : null;
        const rawResponsePreview =
          typeof body.rawResponsePreview === "string" && body.rawResponsePreview.trim()
            ? body.rawResponsePreview
            : null;
        setPieceGenerationState((current) => ({
          open: true,
          phase,
          prompt,
          engine,
          vendorLabel: selectedVendorLabel,
          model: current?.model ?? null,
          attemptCount,
          maxAttempts,
          message,
          failureStage,
          rawResponsePreview,
          startedAt: current?.startedAt ?? Date.now(),
          approximateAttempts: false,
        }));
        return;
      }

      setPieceGenerationState((current) => ({
        open: true,
        phase,
        prompt,
        engine: selectedPieceEngine,
        vendorLabel: selectedVendorLabel,
        model: current?.model ?? null,
        attemptCount,
        maxAttempts,
        message,
        failureStage: null,
        rawResponsePreview: null,
        startedAt: current?.startedAt ?? Date.now(),
        approximateAttempts: false,
      }));
    } finally {
      if (pieceGenerationAbortRef.current === controller) {
        pieceGenerationAbortRef.current = null;
      }
    }
  }

  async function handleImproveWithAi() {
    if (!editor) {
      return;
    }

    const effectiveProfileId =
      selectedAiMode === "text"
        ? (preferredTextImproveProfileId ?? selectedAiProfileId)
        : selectedAiProfileId;

    if (!effectiveProfileId) {
      toast({ title: "No AI profile configured", description: "Go to Admin → AI to add a text generation profile.", variant: "destructive" });
      return;
    }

    const currentHtml = editor.getHTML();
    const meaningfulHtml = currentHtml
      .replace(/<p><\/p>/g, "")
      .replace(/<p>\s*<\/p>/g, "")
      .trim();

    if (meaningfulHtml === "") {
      return;
    }

    if (selectedAiMode === "text") {
      try {
        const { preservedHtml, textOnlyContent } = partitionEditorContent(currentHtml);

        if (!textOnlyContent.trim()) {
          return;
        }

        const response = await processAiText.mutateAsync({
          data: { content: textOnlyContent, profileId: effectiveProfileId },
        });

        const reconstructed = preservedHtml + response.text;
        editor.commands.setContent(reconstructed || ensureParagraphHtml("", canonicalOrigin), { emitUpdate: true });
        toast({
          title: "Draft improved",
          description: "The editor content has been replaced with the AI-assisted rewrite.",
        });
      } catch {
        // onError already surfaces the failure to the user; keep the current
        // editor content unchanged and avoid bubbling an unhandled rejection.
      }
      return;
    }

    const prompt = [title.trim(), editor.getText().trim()].filter(Boolean).join("\n\n").trim();
    if (!prompt) {
      return;
    }

    await generatePieceDraft(prompt);
  }

  if (!editor) {
    return null;
  }

  const toolbarButtonClass =
    "wysiwyg-toolbar-button h-8 min-h-8 rounded-sm border px-2 text-[11px] font-semibold uppercase tracking-wide shadow-none";
  const toolbarIconButtonClass =
    "wysiwyg-toolbar-button h-8 w-8 rounded-sm border p-0 text-[11px] font-semibold shadow-none";
  const aiButtonClass =
    "rounded-none border-2 border-yellow-400 bg-zinc-100/95 text-zinc-950 shadow-[3px_3px_0_0_rgba(234,179,8,1)] hover:bg-yellow-200 dark:bg-zinc-950/95 dark:text-yellow-200 dark:hover:bg-zinc-900";
  const aiSelectClass =
    "pointer-events-auto h-9 min-w-[11rem] rounded-none border-2 border-yellow-400 bg-zinc-100/95 px-3 text-sm text-zinc-950 shadow-[3px_3px_0_0_rgba(234,179,8,1)] focus:outline-none focus:ring-2 focus:ring-ring dark:bg-zinc-950/95 dark:text-yellow-200";
  const aiModeSelectClass =
    "pointer-events-auto h-9 min-w-[8rem] rounded-none border-2 border-black bg-white/95 px-3 text-sm text-zinc-950 shadow-[3px_3px_0_0_rgba(0,0,0,0.95)] focus:outline-none focus:ring-2 focus:ring-ring dark:bg-zinc-900/95 dark:text-zinc-50";
  const headingLabel =
    editor.isActive("heading", { level: 1 }) ? "H1"
      : editor.isActive("heading", { level: 2 }) ? "H2"
      : editor.isActive("heading", { level: 3 }) ? "H3"
      : editor.isActive("heading", { level: 4 }) ? "H4"
      : editor.isActive("heading", { level: 5 }) ? "H5"
      : editor.isActive("heading", { level: 6 }) ? "H6"
      : "P";

  const selectedSocialPlatforms = (platformConnections ?? []).filter(
    (c) => platformIds.includes(c.id) && (c.platform === "bluesky" || c.platform === "linkedin" || c.platform === "facebook" || c.platform === "instagram"),
  );
  const featuredImageStatus =
    featuredImageSource === "manual"
      ? "Featured image manually selected."
      : featuredImageSource === "auto"
        ? "Featured image selected from first content upload."
        : "The first uploaded content image will become the featured image.";

  return (
    <div className="space-y-3">
      {showTitle && (
        <input
          type="text"
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border-b border-border bg-transparent text-lg font-semibold placeholder:text-muted-foreground/60 focus:outline-none pb-2"
        />
      )}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground shrink-0">Featured image</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsFeaturedPickerOpen(true)}
            disabled={isSubmitting}
            className="shrink-0"
          >
            <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
            {featuredImageUrl ? "Change image" : "Set featured image"}
          </Button>
          {featuredImageUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFeaturedImageUrl("");
                setFeaturedImageSource(null);
              }}
              disabled={isSubmitting}
              className="shrink-0"
            >
              Clear
            </Button>
          ) : null}
          {featuredImageUrl && (
            <img
              src={featuredImageUrl}
              alt="Featured"
              className="h-10 w-10 rounded object-cover border border-border shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              onLoad={(e) => { (e.target as HTMLImageElement).style.display = ""; }}
            />
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{featuredImageStatus}</p>
      </div>
      <FeaturedImagePicker
        open={isFeaturedPickerOpen}
        onOpenChange={setIsFeaturedPickerOpen}
        currentUrl={featuredImageUrl || undefined}
        aiProfileId={preferredAltTextProfileId ?? null}
        onSelect={(url) => {
          setFeaturedImageUrl(url);
          setFeaturedImageSource("manual");
        }}
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="wysiwyg-toolbar flex flex-wrap items-center gap-1 border-b border-border/70 bg-muted/20 px-2 py-2">
          <div className="flex items-center gap-1 border-r border-border/70 pr-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={toolbarIconButtonClass}
              aria-label="Undo"
              onMouseDown={(event) => {
                event.preventDefault();
                editor.chain().focus().undo().run();
              }}
              disabled={!editor.can().undo()}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={toolbarIconButtonClass}
              aria-label="Redo"
              onMouseDown={(event) => {
                event.preventDefault();
                editor.chain().focus().redo().run();
              }}
              disabled={!editor.can().redo()}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1 border-r border-border/70 pr-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={`${toolbarButtonClass} min-w-[3.25rem] justify-center`}
                  aria-label="Text style"
                >
                  {headingLabel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
                  Paragraph
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {[1, 2, 3, 4, 5, 6].map((level) => (
                  <DropdownMenuItem
                    key={level}
                    onSelect={() => editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run()}
                  >
                    H{level}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              type="button"
              variant={editor.isActive("bold") ? "default" : "outline"}
              size="sm"
              className={toolbarButtonClass}
              aria-label="Bold"
              onMouseDown={(event) => {
                event.preventDefault();
                editor.chain().focus().toggleBold().run();
              }}
            >
              B
            </Button>
            <Button
              type="button"
              variant={editor.isActive("italic") ? "default" : "outline"}
              size="sm"
              className={toolbarButtonClass}
              aria-label="Italic"
              onMouseDown={(event) => {
                event.preventDefault();
                editor.chain().focus().toggleItalic().run();
              }}
            >
              I
            </Button>
            <Button
              type="button"
              variant={editor.isActive("underline") ? "default" : "outline"}
              size="sm"
              className={toolbarButtonClass}
              aria-label="Underline"
              onMouseDown={(event) => {
                event.preventDefault();
                editor.chain().focus().toggleUnderline().run();
              }}
            >
              U
            </Button>
          </div>

          <div className="hidden items-center gap-1 md:flex">
            <Button
              type="button"
              variant={editor.isActive("bulletList") ? "default" : "outline"}
              size="sm"
              className={toolbarButtonClass}
              aria-label="Bullet list"
              onMouseDown={(event) => {
                event.preventDefault();
                editor.chain().focus().toggleBulletList().run();
              }}
            >
              List
            </Button>
            <Button
              type="button"
              variant={editor.isActive("blockquote") ? "default" : "outline"}
              size="sm"
              className={toolbarButtonClass}
              aria-label="Block quote"
              onMouseDown={(event) => {
                event.preventDefault();
                editor.chain().focus().toggleBlockquote().run();
              }}
            >
              Quote
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarButtonClass}
              aria-label="Align left"
              onMouseDown={(event) => {
                event.preventDefault();
                editor.chain().focus().setTextAlign("left").run();
              }}
            >
              Left
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarButtonClass}
              aria-label="Align center"
              onMouseDown={(event) => {
                event.preventDefault();
                editor.chain().focus().setTextAlign("center").run();
              }}
            >
              Center
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarButtonClass}
              aria-label="Align right"
              onMouseDown={(event) => {
                event.preventDefault();
                editor.chain().focus().setTextAlign("right").run();
              }}
            >
              Right
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={toolbarIconButtonClass}
              aria-label="Insert link"
              onMouseDown={(event) => {
                event.preventDefault();
                handleInsertLink();
              }}
            >
              <Link2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={toolbarIconButtonClass}
              aria-label="Insert image"
              onMouseDown={(event) => {
                event.preventDefault();
                setImageInsertDialogOpen(true);
              }}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={toolbarIconButtonClass}
              aria-label="Insert YouTube video"
              onMouseDown={(event) => {
                event.preventDefault();
                handleInsertYouTube();
              }}
            >
              <Youtube className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarButtonClass}
              aria-label="Insert iframe embed"
              onMouseDown={(event) => {
                event.preventDefault();
                handleInsertEmbed();
              }}
            >
              Embed
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarButtonClass}
              aria-label="Insert saved piece"
              onMouseDown={(event) => {
                event.preventDefault();
                setIsPieceLibraryOpen(true);
              }}
            >
              Pieces
            </Button>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant={isHtmlMode ? "default" : "outline"}
              size="icon"
              className={toolbarIconButtonClass}
              onClick={() => {
                if (!isHtmlMode) {
                  setHtmlSource(editor.getHTML());
                  setIsHtmlMode(true);
                } else {
                  editor.commands.setContent(htmlSource, { emitUpdate: true });
                  editor.commands.focus();
                  setIsHtmlMode(false);
                }
              }}
              aria-label={isHtmlMode ? "Switch to visual editor" : "Switch to HTML source"}
              title={isHtmlMode ? "Visual editor" : "HTML source"}
            >
              <Code2 className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={toolbarIconButtonClass}
                  aria-label="More formatting options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => editor.chain().focus().toggleBulletList().run()}>
                  Bullet list
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => editor.chain().focus().toggleBlockquote().run()}>
                  Quote
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => editor.chain().focus().setTextAlign("left").run()}>
                  Align left
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => editor.chain().focus().setTextAlign("center").run()}>
                  Align center
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => editor.chain().focus().setTextAlign("right").run()}>
                  Align right
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleInsertLink}>
                  Insert link
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setImageInsertDialogOpen(true)}>
                  Insert image
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleInsertYouTube}>
                  Insert YouTube video
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleInsertEmbed}>
                  Insert iframe embed
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsPieceLibraryOpen(true)}>
                  Insert saved piece
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsExhibitLibraryOpen(true)}>
                  Insert saved exhibit
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="relative" onClick={handleEditorContentClick}>
          {editor.isEmpty ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-5 py-4 text-muted-foreground/60">
              <div className="flex items-center gap-2 text-base">
                <Pilcrow className="h-4 w-4" />
                <span>{placeholder}</span>
              </div>
            </div>
          ) : null}

          <div className={isHtmlMode ? "hidden" : undefined}>
            <EditorContent editor={editor} />
          </div>
          {isHtmlMode ? (
            <textarea
              value={htmlSource}
              onChange={(e) => setHtmlSource(e.target.value)}
              className="min-h-[220px] w-full rounded-b-2xl border border-t-0 border-border bg-background px-4 py-4 font-mono text-sm leading-relaxed text-foreground focus:outline-none focus:ring-0"
              aria-label="HTML source"
              spellCheck={false}
            />
          ) : null}

          {textProfiles.length > 0 ? (
            <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex items-center gap-2">
              <select
                aria-label="AI Mode"
                className={aiModeSelectClass}
                value={selectedAiMode}
                onChange={(event) => {
                  const next = event.target.value as "text" | "piece";
                  setSelectedAiMode(next);
                  if (next === "piece" && !pieceProfiles.some((p) => p.id === selectedAiProfileId)) {
                    if (pieceProfiles[0]) setSelectedAiProfileId(pieceProfiles[0].id);
                  }
                }}
              >
                <option value="text">Text</option>
                {(pieceProfiles.length > 0 || hasPieces) ? <option value="piece">Piece</option> : null}
              </select>
              {selectedAiMode === "piece" ? (
                <select
                  aria-label="Piece Engine"
                  className={aiModeSelectClass}
                  value={selectedPieceEngine}
                  onChange={(event) => setSelectedPieceEngine(event.target.value as ArtPieceEngine)}
                >
                  <option value="p5">p5</option>
                  <option value="c2">c2</option>
                  <option value="three">Three.js</option>
                </select>
              ) : null}
              <select
                aria-label="AI Profile"
                className={aiSelectClass}
                value={selectedAiProfileId ?? ""}
                onChange={(event) => setSelectedAiProfileId(Number(event.target.value) || null)}
              >
                {selectedAiMode === "piece" && pieceProfiles.length === 0
                  ? <option value="" disabled>No piece profiles enabled</option>
                  : (selectedAiMode === "piece" ? pieceProfiles : textProfiles).map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                      </option>
                    ))
                }
              </select>
              <Button
                type="button"
                size="sm"
                className={`pointer-events-auto min-h-9 px-3 ${aiButtonClass}`}
                disabled={
                  isSubmitting ||
                  processAiText.isPending ||
                  pieceGenerationState?.phase === "generating" ||
                  textLength === 0 ||
                  !selectedAiProfileId
                }
                onClick={() => void handleImproveWithAi()}
              >
                {processAiText.isPending || pieceGenerationState?.phase === "generating" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {selectedAiMode === "text" ? "AI" : "Make Piece"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {showCategories ? (
        <CategoryMultiSelect value={categoryIds} onChange={setCategoryIds} />
      ) : null}

      {platformConnections && platformConnections.length > 0 ? (
        <div className="space-y-3">
          <PlatformMultiSelect
            value={platformIds}
            onChange={setPlatformIds}
            connections={platformConnections}
          />
          {substackConnection && isSubstackSelected ? (
            <label className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
              <Checkbox
                checked={substackSendNewsletter}
                onCheckedChange={(checked) => setSubstackSendNewsletter(checked === true)}
                aria-label="Send as newsletter"
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium text-foreground">
                  Send as newsletter
                </span>
                <span className="block text-xs text-muted-foreground">
                  Publish to Substack as usual, and email it to subscribers only when this is selected.
                </span>
              </span>
            </label>
          ) : null}

          {selectedSocialPlatforms.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 space-y-3">
              <p className="text-xs font-medium text-foreground">Social post text</p>
              {selectedSocialPlatforms.map((conn) => {
                const key = conn.platform as "bluesky" | "linkedin" | "facebook" | "instagram";
                const limits = { bluesky: 300, linkedin: 3000, facebook: 63206, instagram: 2200 };
                const labels = { bluesky: "Bluesky", linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram" };
                const val = socialPostDrafts[key];
                const limit = limits[key];
                return (
                  <div key={conn.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{labels[key]}</span>
                      <span className={`text-xs ${val.length > limit ? "text-destructive" : "text-muted-foreground"}`}>
                        {val.length}/{limit}
                      </span>
                    </div>
                    <textarea
                      value={val}
                      onChange={(e) => setSocialPostDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={`What to post on ${labels[key]}…`}
                      rows={3}
                      maxLength={limit}
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none resize-none"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          HTML is sanitized on save. Rich posts support images and approved iframe embeds.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{textLength} chars</span>
          {onCancel ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => { if (isDirty) { setIsCancelWarningOpen(true); } else { onCancel(); } }}
              disabled={isSubmitting}
            >
              {cancelLabel}
            </Button>
          ) : null}
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </div>
      </div>

      <ImageEditDialog
        open={!!imageEditState}
        onOpenChange={(open) => { if (!open) setImageEditState(null); }}
        initialSrc={imageEditState?.src ?? ""}
        initialAlt={imageEditState?.alt ?? ""}
        aiProfileId={preferredAltTextProfileId ?? null}
        onAiGenerate={async () => {
          if (!imageEditState?.src) return null;
          if (!preferredAltTextProfileId) {
            toast({ title: "No AI profile configured", description: "Go to Admin → AI to add an image description profile.", variant: "destructive" });
            return null;
          }
          try {
            const r = await describeImageForBubble({
              data: {
                imageUrl: imageEditState.src,
                profileId: preferredAltTextProfileId,
                ...(imageEditState.alt.trim() ? { existingAltText: imageEditState.alt.trim() } : {}),
              },
            });
            return r.altText;
          } catch (err: unknown) {
            const code = (err as { data?: { code?: string }; response?: { data?: { code?: string } } })?.data?.code ?? (err as { data?: { code?: string }; response?: { data?: { code?: string } } })?.response?.data?.code;
            if (code === "vision_not_supported") {
              toast({ title: "Vision not supported", description: "This AI model does not support image analysis. Choose a vision-capable model in Admin → AI → Task Preferences.", variant: "destructive" });
            } else {
              const message = getAiFailureMessage(err) || "Could not generate alt text.";
              toast({ title: "AI failed", description: message, variant: "destructive" });
            }
            return null;
          }
        }}
        onSave={async (alt) => {
          if (!imageEditState || imageEditState.pos < 0) return;
          editor.chain().focus().setNodeSelection(imageEditState.pos).updateAttributes("image", { alt }).run();
          const mediaPrefix = "/api/media/";
          if (imageEditState.src.startsWith(mediaPrefix)) {
            const filename = imageEditState.src.slice(mediaPrefix.length).split("?")[0] ?? "";
            if (filename && !filename.includes("/")) {
              await updateMediaAltText({ fileName: filename, data: { altText: alt || null } });
            }
          }
          setImageEditState(null);
          toast({ title: "Alt text saved" });
        }}
        onReplace={() => {
          setImageEditState(null);
          setImageInsertDialogOpen(true);
        }}
        onRemove={() => {
          if (imageEditState && imageEditState.pos >= 0) {
            editor.chain().focus().setNodeSelection(imageEditState.pos).deleteSelection().run();
          }
          setImageEditState(null);
        }}
      />

      <PieceEditDialog
        open={!!pieceEditState}
        onOpenChange={(open) => { if (!open) setPieceEditState(null); }}
        initialTitle={pieceEditState?.title ?? ""}
        initialDescription={pieceEditState?.ariaLabel ?? ""}
        aiProfileId={preferredTextImproveProfileId ?? null}
        onAiImprove={async (text) => {
          if (!preferredTextImproveProfileId) {
            toast({ title: "No AI profile configured", description: "Go to Admin → AI to add a text generation profile.", variant: "destructive" });
            return null;
          }
          try {
            const r = await processAiText.mutateAsync({ data: { content: text, profileId: preferredTextImproveProfileId, mode: "text" } });
            return r.text;
          } catch { return null; }
        }}
        onSave={async (description) => {
          if (!pieceEditState || pieceEditState.pos < 0) return;
          editor.chain().focus().setNodeSelection(pieceEditState.pos).updateAttributes("iframeEmbed", { ariaLabel: description }).run();
          const pieceId = parseInt(pieceEditState.src.split("/").pop() ?? "", 10);
          if (!isNaN(pieceId)) {
            await updateArtPieceForBubble({ id: pieceId, data: { prompt: description } });
          }
          setPieceEditState(null);
          toast({ title: "Description saved" });
        }}
        onReplace={() => {
          setPieceEditState(null);
          setIsPieceLibraryOpen(true);
        }}
        onRemove={() => {
          if (pieceEditState && pieceEditState.pos >= 0) {
            editor.chain().focus().setNodeSelection(pieceEditState.pos).deleteSelection().run();
          }
          setPieceEditState(null);
        }}
      />

      <EmbedDialog
        open={!!embedEditState}
        onOpenChange={(open) => { if (!open) setEmbedEditState(null); }}
        initialCode={embedEditState?.initialCode}
        onApply={(attrs) => {
          if (!embedEditState || embedEditState.pos < 0) {
            editor?.chain().focus().insertIframe(attrs).run();
          } else {
            editor?.chain().focus().setNodeSelection(embedEditState.pos).updateAttributes("iframeEmbed", attrs).run();
          }
          setEmbedEditState(null);
        }}
        onRemove={() => {
          if (embedEditState && embedEditState.pos >= 0) {
            editor?.chain().focus().setNodeSelection(embedEditState.pos).deleteSelection().run();
          }
          setEmbedEditState(null);
        }}
      />

      <YouTubeDialog
        open={!!youTubeEditState}
        onOpenChange={(open) => { if (!open) setYouTubeEditState(null); }}
        initialUrl={youTubeEditState?.initialUrl}
        onApply={(attrs) => {
          if (!youTubeEditState || youTubeEditState.pos < 0) {
            editor?.chain().focus().insertIframe(attrs).run();
          } else {
            editor?.chain().focus().setNodeSelection(youTubeEditState.pos).updateAttributes("iframeEmbed", attrs).run();
          }
          setYouTubeEditState(null);
        }}
        onRemove={() => {
          if (youTubeEditState && youTubeEditState.pos >= 0) {
            editor?.chain().focus().setNodeSelection(youTubeEditState.pos).deleteSelection().run();
          }
          setYouTubeEditState(null);
        }}
      />

      <ArtPieceLibraryDialog
        open={isPieceLibraryOpen}
        onOpenChange={setIsPieceLibraryOpen}
        onInsert={(piece) => {
          if (!editor) return;
          editor.chain().focus().insertIframe(buildPieceIframeAttrs(piece)).run();
          toast({
            title: "Piece inserted",
            description: "The saved piece embed has been added to this post.",
          });
        }}
      />

      <ExhibitLibraryDialog
        open={isExhibitLibraryOpen}
        onOpenChange={setIsExhibitLibraryOpen}
        onInsert={(exhibit) => {
          if (!editor) return;
          editor.chain().focus().insertIframe(buildExhibitIframeAttrs(exhibit)).run();
          toast({
            title: "Exhibit inserted",
            description: "The exhibit embed has been added to this post.",
          });
        }}
      />

      {pieceGenerationState ? (
        <ArtPieceGenerationDialog
          state={pieceGenerationState}
          onOpenChange={(open) => {
            if (!open) {
              if (pieceGenerationState.phase === "generating") {
                stopPieceGeneration();
                return;
              }
              setPieceGenerationState(null);
            }
          }}
          onStop={stopPieceGeneration}
          onRetry={() => void handleImproveWithAi()}
        />
      ) : null}

      <ArtPieceDraftDialog
        open={isPieceDraftOpen}
        onOpenChange={(open) => {
          setIsPieceDraftOpen(open);
          if (!open) {
            setPieceDraft(null);
            setSavingPieceDraftToken(null);
          }
        }}
        draft={pieceDraft}
        prompt={pieceDraftPrompt}
        isSaving={Boolean(savingPieceDraftToken) || createArtPiece.isPending || isPersistingPieceThumbnail}
        onSaveAndInsert={() => void handleSavePieceDraftAndInsert()}
      />

      <AlertDialog open={isCancelWarningOpen} onOpenChange={setIsCancelWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. If you cancel now, your edits will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setIsCancelWarningOpen(false);
                onCancel?.();
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingNavUrl} onOpenChange={(v) => { if (!v) setPendingNavUrl(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave page?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. If you leave now, your edits will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingNavUrl(null)}>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const url = pendingNavUrl;
                setPendingNavUrl(null);
                if (url) {
                  window.location.href = url;
                }
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        initialHref={editor?.getAttributes("link").href as string | undefined}
        initialLinkText={linkDialogInitialText}
        initialOpenInNewTab={editor?.getAttributes("link").target === "_blank"}
        onApply={(href, openInNewTab, linkText) => {
          if (!editor) return;
          const target = openInNewTab ? "_blank" : null;
          const { selection } = editor.state;
          if (selection.empty && linkText) {
            editor.chain().focus().insertContent({
              type: "text",
              text: linkText,
              marks: [{ type: "link", attrs: { href, target } }],
            }).run();
          } else if (!selection.empty) {
            editor.chain().focus().extendMarkRange("link").setLink({ href, target }).run();
          }
        }}
        onRemove={() => {
          editor?.chain().focus().extendMarkRange("link").unsetLink().run();
        }}
      />

      <EmbedDialog
        open={embedDialogOpen}
        onOpenChange={setEmbedDialogOpen}
        onApply={(attrs) => {
          editor?.chain().focus().insertIframe(attrs).run();
        }}
      />

      <YouTubeDialog
        open={youTubeDialogOpen}
        onOpenChange={setYouTubeDialogOpen}
        onApply={(attrs) => {
          editor?.chain().focus().insertIframe(attrs).run();
        }}
      />

      <ImageInsertDialog
        open={imageInsertDialogOpen}
        onOpenChange={setImageInsertDialogOpen}
        aiProfileId={preferredAltTextProfileId ?? null}
        onInsert={(url, altText) => {
          editor?.chain().focus().setImage({ src: url, alt: altText ?? "" }).run();
          if (!featuredImageUrl.trim() && featuredImageSource !== "manual") {
            setFeaturedImageUrl(url);
            setFeaturedImageSource("auto");
            toast({
              title: "Featured image selected",
              description: "The first inserted content image is now the featured image.",
            });
          }
        }}
      />
    </div>
  );
}

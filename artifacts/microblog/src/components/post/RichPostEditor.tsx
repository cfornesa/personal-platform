import { useEffect, useId, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ImagePlus, Link2, MoreHorizontal, Pilcrow, Redo2, Sparkles, Undo2, Youtube } from "lucide-react";
import {
  ApiError,
  type ArtPieceEngine,
  generateArtPiece as requestGeneratedArtPiece,
  useCreateArtPiece,
  useProcessAiText,
  type GeneratedArtPieceDraft,
  type ProcessAiTextBodyVendor,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { IframeEmbed } from "./iframe-embed";
import { CategoryMultiSelect } from "./CategoryMultiSelect";
import { PlatformMultiSelect } from "./PlatformMultiSelect";
import { getAiFailureMessage } from "./ai-error";
import type { EnabledPlatformConnection } from "@/hooks/use-enabled-platform-connections";
import { ArtPieceDraftDialog } from "./ArtPieceDraftDialog";
import { ArtPieceGenerationDialog, type ArtPieceGenerationState } from "./ArtPieceGenerationDialog";
import { ArtPieceLibraryDialog } from "./ArtPieceLibraryDialog";
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
  aiVendors?: Array<{ id: ProcessAiTextBodyVendor; label: string }>;
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
};

function getEditorTextLength(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

function ensureParagraphHtml(html: string) {
  const trimmed = html.trim();
  if (trimmed === "") {
    return "<p></p>";
  }
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return normalizePieceEmbedUrls(trimmed);
  }
  return normalizePieceEmbedUrls(
    trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join(""),
  );
}

function normalizePieceEmbedSrc(src: string) {
  const trimmed = src.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const url = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? new URL(trimmed)
      : new URL(trimmed, window.location.origin);
    const match = url.pathname.match(/^\/embed\/pieces\/(\d+)$/);
    if (!match) {
      return trimmed;
    }
    return `${url.origin}/embed/pieces/${match[1]}`;
  } catch {
    const match = trimmed.match(/^(\/embed\/pieces\/\d+)(?:\?[^#]*)?(#.*)?$/);
    if (!match) {
      return trimmed;
    }
    return `${match[1]}${match[2] ?? ""}`;
  }
}

function normalizePieceEmbedUrls(html: string) {
  if (!/<iframe\b/i.test(html)) {
    return html;
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  let mutated = false;
  document.querySelectorAll("iframe[src]").forEach((iframe) => {
    const currentSrc = iframe.getAttribute("src");
    if (!currentSrc) {
      return;
    }
    const normalizedSrc = normalizePieceEmbedSrc(currentSrc);
    if (normalizedSrc !== currentSrc) {
      iframe.setAttribute("src", normalizedSrc);
      mutated = true;
    }
  });

  return mutated ? document.body.innerHTML : html;
}

function parseIframeEmbed(embedCode: string) {
  const document = new DOMParser().parseFromString(embedCode, "text/html");
  const iframe = document.querySelector("iframe");
  if (!iframe?.getAttribute("src")) {
    return null;
  }

  return {
    src: normalizePieceEmbedSrc(iframe.getAttribute("src") ?? ""),
    width: iframe.getAttribute("width") ?? "100%",
    height: iframe.getAttribute("height") ?? "420",
    title: iframe.getAttribute("title") ?? "Embedded content",
    allow: iframe.getAttribute("allow") ?? undefined,
    loading: iframe.getAttribute("loading") ?? "lazy",
    referrerpolicy: iframe.getAttribute("referrerpolicy") ?? undefined,
    sandbox: iframe.getAttribute("sandbox") ?? undefined,
    frameborder: iframe.getAttribute("frameborder") ?? "0",
    allowfullscreen: iframe.hasAttribute("allowfullscreen") ? "true" : undefined,
  };
}

function extractFirstImageSrc(html: string): string | null {
  const document = new DOMParser().parseFromString(html, "text/html");
  const src = document.querySelector("img[src]")?.getAttribute("src")?.trim();
  return src || null;
}

function buildPieceIframeAttrs(piece: {
  id: number;
  title: string;
  currentVersionId: number;
}) {
  return {
    src: `/embed/pieces/${piece.id}`,
    width: "100%",
    height: "480",
    title: piece.title,
    loading: "lazy",
    frameborder: "0",
    sandbox: "allow-scripts allow-same-origin",
  };
}

const MAX_PIECE_GENERATION_ATTEMPTS = 3;

function parseYouTubeUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  let videoId = "";

  if (url.hostname === "youtu.be") {
    videoId = url.pathname.slice(1);
  } else if (url.hostname.endsWith("youtube.com")) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") ?? "";
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.split("/")[2] ?? "";
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/")[2] ?? "";
    }
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  return {
    src: `https://www.youtube.com/embed/${videoId}`,
    width: "100%",
    height: "420",
    title: "YouTube video",
    allow:
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
    loading: "lazy",
    referrerpolicy: "strict-origin-when-cross-origin",
    frameborder: "0",
    allowfullscreen: "true" as const,
  };
}

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
  aiVendors = [],
  platformConnections,
  initialFeaturedImageUrl,
  initialSocialPostDrafts,
  onCancel,
  onSubmit,
  onContentChange,
  onUpload,
}: RichPostEditorProps) {
  const { toast } = useToast();
  const fileInputId = useId();
  const featuredFileInputId = useId();
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
  const [selectedAiVendor, setSelectedAiVendor] = useState<ProcessAiTextBodyVendor | "">(aiVendors[0]?.id ?? "");
  const [selectedAiMode, setSelectedAiMode] = useState<"text" | "piece">("text");
  const [selectedPieceEngine, setSelectedPieceEngine] = useState<ArtPieceEngine>("p5");
  const [pieceDraft, setPieceDraft] = useState<GeneratedArtPieceDraft | null>(null);
  const [pieceDraftPrompt, setPieceDraftPrompt] = useState("");
  const [isPieceDraftOpen, setIsPieceDraftOpen] = useState(false);
  const [isPieceLibraryOpen, setIsPieceLibraryOpen] = useState(false);
  const [pieceGenerationState, setPieceGenerationState] = useState<ArtPieceGenerationState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const featuredFileInputRef = useRef<HTMLInputElement | null>(null);
  const pieceGenerationAbortRef = useRef<AbortController | null>(null);
  const processAiText = useProcessAiText({
    mutation: {
      onError: (error: any) => {
        const message = getAiFailureMessage(error);
        toast({ title: "AI request failed", description: message, variant: "destructive" });
      },
    },
  });
  const createArtPiece = useCreateArtPiece({
    mutation: {
      onError: (error: any) => {
        const message = getAiFailureMessage(error);
        toast({ title: "Saving piece failed", description: message, variant: "destructive" });
      },
    },
  });

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
    content: ensureParagraphHtml(initialContent),
    editorProps: {
      attributes: {
        class:
          "wysiwyg-editor-content min-h-[220px] rounded-b-2xl border border-t-0 border-border bg-background px-4 py-4 pb-16 text-base leading-relaxed focus:outline-none prose prose-neutral max-w-none prose-p:my-3 prose-h1:mt-7 prose-h1:mb-4 prose-h2:mt-6 prose-h2:mb-3 prose-h3:mt-5 prose-h3:mb-2 prose-h4:mt-4 prose-h4:mb-2 prose-h5:mt-4 prose-h5:mb-2 prose-h6:mt-4 prose-h6:mb-2 prose-strong:font-extrabold prose-strong:text-foreground prose-img:rounded-xl prose-img:border prose-img:border-border prose-iframe:w-full prose-iframe:rounded-xl prose-iframe:border prose-iframe:border-border",
      },
    },
    onUpdate({ editor: nextEditor }) {
      setTextLength(nextEditor.getText().trim().length);
      onContentChange?.(nextEditor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const nextContent = ensureParagraphHtml(initialContent);
    if (editor.getHTML() !== nextContent) {
      editor.commands.setContent(nextContent, { emitUpdate: true });
    }
  }, [editor, initialContent]);

  useEffect(() => {
    if (aiVendors.length === 0) {
      if (selectedAiVendor !== "") {
        setSelectedAiVendor("");
      }
      return;
    }

    if (!aiVendors.some((vendor) => vendor.id === selectedAiVendor)) {
      setSelectedAiVendor(aiVendors[0]!.id);
    }
  }, [aiVendors, selectedAiVendor]);

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

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !editor) {
      return;
    }

    const url = await onUpload(file);
    editor.chain().focus().setImage({ src: url, alt: file.name }).run();
    if (!featuredImageUrl.trim() && featuredImageSource !== "manual") {
      setFeaturedImageUrl(url);
      setFeaturedImageSource("auto");
      toast({
        title: "Featured image selected",
        description: "The first uploaded content image is now the featured image.",
      });
    }
    event.target.value = "";
  }

  async function handleFeaturedFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const url = await onUpload(file);
    setFeaturedImageUrl(url);
    setFeaturedImageSource("manual");

    toast({
      title: "Featured image selected",
      description: "The uploaded image is now the featured image.",
    });
    event.target.value = "";
  }

  function handleInsertLink() {
    if (!editor) {
      return;
    }

    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Enter the link URL", previousUrl ?? "https://");
    if (url === null) {
      return;
    }
    if (url.trim() === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  function handleInsertEmbed() {
    if (!editor) {
      return;
    }

    const embedCode = window.prompt("Paste the iframe embed code");
    if (!embedCode) {
      return;
    }

    const iframe = parseIframeEmbed(embedCode);
    if (!iframe) {
      window.alert("That embed code does not contain a valid iframe.");
      return;
    }

    editor.chain().focus().insertIframe(iframe).run();
  }

  function handleInsertYouTube() {
    if (!editor) {
      return;
    }

    const videoUrl = window.prompt("Paste the YouTube video URL", "https://www.youtube.com/watch?v=");
    if (!videoUrl) {
      return;
    }

    const iframe = parseYouTubeUrl(videoUrl);
    if (!iframe) {
      toast({
        title: "Invalid YouTube URL",
        description: "Use a full youtube.com or youtu.be link.",
        variant: "destructive",
      });
      return;
    }

    editor.chain().focus().insertIframe(iframe).run();
  }

  function handleSubmit() {
    if (!editor) {
      return;
    }

    const html = normalizePieceEmbedUrls(editor.getHTML());
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
    if (!selectedAiVendor) {
      return;
    }

    pieceGenerationAbortRef.current?.abort();
    const controller = new AbortController();
    pieceGenerationAbortRef.current = controller;

    const selectedVendorLabel = aiVendors.find((vendor) => vendor.id === selectedAiVendor)?.label ?? selectedAiVendor;

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
          vendor: selectedAiVendor,
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

    if (!selectedAiVendor) {
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
        const response = await processAiText.mutateAsync({
          data: { content: currentHtml, vendor: selectedAiVendor },
        });

        editor.commands.setContent(ensureParagraphHtml(response.text), { emitUpdate: true });
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
    "pointer-events-auto h-9 min-w-[11rem] rounded-none border-2 border-yellow-400 bg-zinc-100/95 px-3 text-sm text-zinc-950 shadow-[3px_3px_0_0_rgba(234,179,8,1)] focus:outline-none focus:ring-0 dark:bg-zinc-950/95 dark:text-yellow-200";
  const aiModeSelectClass =
    "pointer-events-auto h-9 min-w-[8rem] rounded-none border-2 border-black bg-white/95 px-3 text-sm text-zinc-950 shadow-[3px_3px_0_0_rgba(0,0,0,0.95)] focus:outline-none focus:ring-0 dark:bg-zinc-900/95 dark:text-zinc-50";
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
      <input
        type="text"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full border-b border-border bg-transparent text-lg font-semibold placeholder:text-muted-foreground/60 focus:outline-none pb-2"
      />
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span className="text-xs font-medium text-muted-foreground shrink-0">Featured image</span>
          <input
            type="url"
            aria-label="Featured image URL"
            placeholder="https://example.com/image.jpg (optional)"
            value={featuredImageUrl}
            onChange={(e) => {
              const nextValue = e.target.value;
              setFeaturedImageUrl(nextValue);
              setFeaturedImageSource(nextValue.trim() ? "manual" : null);
            }}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => featuredFileInputRef.current?.click()}
            disabled={isSubmitting}
            aria-label="Upload featured image"
            className="shrink-0"
          >
            <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
            Upload
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
              aria-label="Upload image"
              onMouseDown={(event) => {
                event.preventDefault();
                fileInputRef.current?.click();
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
                <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                  Upload image
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="relative">
          {editor.isEmpty ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-5 py-4 text-muted-foreground/60">
              <div className="flex items-center gap-2 text-base">
                <Pilcrow className="h-4 w-4" />
                <span>{placeholder}</span>
              </div>
            </div>
          ) : null}

          <EditorContent editor={editor} />

          {aiVendors.length > 0 ? (
            <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex items-center gap-2">
              <select
                aria-label="AI Mode"
                className={aiModeSelectClass}
                value={selectedAiMode}
                onChange={(event) => setSelectedAiMode(event.target.value as "text" | "piece")}
              >
                <option value="text">Text</option>
                <option value="piece">Piece</option>
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
                aria-label="AI Vendor"
                className={aiSelectClass}
                value={selectedAiVendor}
                onChange={(event) => setSelectedAiVendor(event.target.value as ProcessAiTextBodyVendor)}
              >
                {aiVendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.label}
                  </option>
                ))}
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
                  !selectedAiVendor
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

      <input
        id={fileInputId}
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        id={featuredFileInputId}
        ref={featuredFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={handleFeaturedFileChange}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          HTML is sanitized on save. Rich posts support images and approved iframe embeds.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{textLength} chars</span>
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              {cancelLabel}
            </Button>
          ) : null}
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </div>
      </div>

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
        onOpenChange={setIsPieceDraftOpen}
        draft={pieceDraft}
        prompt={pieceDraftPrompt}
        isSaving={createArtPiece.isPending}
        onSaveAndInsert={() => {
          if (!pieceDraft || !editor) return;
          createArtPiece.mutate(
            {
              data: {
                draftToken: pieceDraft.draftToken,
              },
            },
            {
              onSuccess: (response) => {
                editor.chain().focus().insertIframe(
                  buildPieceIframeAttrs({
                    id: response.id,
                    title: response.title,
                    currentVersionId: response.currentVersionId!,
                  }),
                ).run();
                setIsPieceDraftOpen(false);
                setPieceDraft(null);
                toast({
                  title: "Piece saved",
                  description: "The new piece was saved to your library and embedded into the post.",
                });
              },
            },
          );
        }}
      />
    </div>
  );
}

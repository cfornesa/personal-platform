import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type ArtPieceEngine,
  generateArtPiece as requestGeneratedArtPiece,
  getGetArtPieceQueryKey,
  getGetMyAiSettingsQueryKey,
  getListArtPiecesQueryKey,
  useCreateArtPiece,
  useCreateArtPieceVersion,
  useDeleteArtPiece,
  useGetArtPiece,
  useListArtPieces,
  useProcessAiText,
  useUpdateMyAiSettings,
  useUpdateArtPiece,
  type GeneratedArtPieceDraft,
  type ProcessAiTextBodyVendor,
} from "@workspace/api-client-react";
import { Code, Sparkles, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ArtPieceRenderer } from "@/components/post/ArtPieceRenderer";
import { ArtPieceDraftDialog } from "@/components/post/ArtPieceDraftDialog";
import { ArtPieceGenerationDialog, type ArtPieceGenerationState } from "@/components/post/ArtPieceGenerationDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useOwnerAiVendors } from "@/hooks/use-owner-ai-vendors";
import { buildImmersivePieceHref } from "@/lib/immersive-view";

const PIECE_TEMPLATES: Record<ArtPieceEngine, { html: string; css: string; js: string }> = {
  p5: {
    html: '<div id="canvas-container"></div>',
    css: `body, html {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #fff;
}
canvas { display: block; }`,
    js: `window.sketch = (p) => {
  p.setup = () => {
    p.createCanvas(800, 400);
  };

  p.draw = () => {
    p.background(255);
    p.fill(255, 0, 0);
    p.noStroke();
    
    let size = 50 + Math.sin(p.frameCount * 0.05) * 20;
    p.rectMode(p.CENTER);
    p.rect(p.width / 2, p.height / 2, size, size);
  };
};`,
  },
  three: {
    html: '<div id="container"></div>',
    css: `body, html {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}
#container { width: 100vw; height: 100vh; }`,
    js: `window.sketch = (runtime) => {
  const { THREE, canvas, startFrame } = runtime;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.z = 5;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(1, 1, 2);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x404040));

  const stopFrame = startFrame((frameCount) => {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    renderer.render(scene, camera);
  });

  return () => {
    stopFrame();
    renderer.dispose();
  };
};`,
  },
  c2: {
    html: '<canvas id="piece-canvas"></canvas>',
    css: `html, body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background: #fff;
}
canvas { display: block; }`,
    js: `window.sketch = (runtime) => {
  const { c2, canvas, startFrame } = runtime;

  const stopFrame = startFrame((frameCount) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const size = 50 + Math.sin(frameCount * 0.05) * 20;
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(canvas.width / 2 - size / 2, canvas.height / 2 - size / 2, size, size);
  });

  return stopFrame;
};`,
  },
};

export default function AdminPiecesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { aiVendors, preferredArtPieceVendor, preferredVendorAltText } = useOwnerAiVendors();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<ProcessAiTextBodyVendor | "">("");
  const [selectedEngine, setSelectedEngine] = useState<ArtPieceEngine>("p5");
  const [htmlCode, setHtmlCode] = useState("");
  const [cssCode, setCssCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [viewTab, setViewTab] = useState<"meta" | "html" | "css" | "js">("meta");
  const [creationMode, setCreationMode] = useState<null | "ai" | "manual">(null);
  const [draft, setDraft] = useState<GeneratedArtPieceDraft | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [generationState, setGenerationState] = useState<ArtPieceGenerationState | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const [isImprovingText, setIsImprovingText] = useState(false);

  const pieces = useListArtPieces();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = pieces.data?.pieces ?? [];
    if (!q) return rows;
    return rows.filter((piece) =>
      [piece.title, piece.prompt].some((value) => value.toLowerCase().includes(q)),
    );
  }, [pieces.data?.pieces, query]);

  useEffect(() => {
    if (!creationMode && !selectedId && filtered[0]) {
      setSelectedId(filtered[0].id);
    }
  }, [creationMode, filtered, selectedId]);

  useEffect(() => {
    if (aiVendors.length > 0 && !aiVendors.some((vendor) => vendor.id === selectedVendor)) {
      const preferredVendorStillAvailable =
        preferredArtPieceVendor &&
        aiVendors.some((vendor) => vendor.id === preferredArtPieceVendor);
      setSelectedVendor(
        preferredVendorStillAvailable ? preferredArtPieceVendor : aiVendors[0]!.id,
      );
    }
  }, [aiVendors, preferredArtPieceVendor, selectedVendor]);

  const detail = useGetArtPiece(selectedId ?? 0, {
    query: {
      queryKey: getGetArtPieceQueryKey(selectedId ?? 0),
      enabled: Boolean(selectedId),
    },
  });

  const selected = detail.data;

  // Initialize metadata when selection changes
  useEffect(() => {
    if (selected && !creationMode) {
      setTitle(selected.title);
      setPrompt(selected.prompt);
      setSelectedEngine(selected.engine);
    }
  }, [selected?.id, creationMode]);

  // Initialize code only when the piece or the active version changes
  useEffect(() => {
    if (selected && !creationMode) {
      const current = selected.currentVersion;
      const engine = selected.engine;
      
      // Try to recover the intended background color from the legacy spec if possible
      let recoveredBackground = engine === "three" ? "#000" : "#fff";
      if (current?.structuredSpec) {
        try {
          const spec = typeof current.structuredSpec === "string" 
            ? JSON.parse(current.structuredSpec) 
            : current.structuredSpec;
          const bg = spec.background || spec.scene?.background;
          if (bg && typeof bg === "string") recoveredBackground = bg;
        } catch (e) {
          // Ignore parse errors
        }
      }

      let fallbackHtml = '<div id="canvas-container"></div>';
      let fallbackCss = `body, html {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: ${recoveredBackground};
}
canvas { display: block; }`;
      
      if (engine === "three") {
        fallbackHtml = '<div id="container"></div>';
        fallbackCss = `body, html {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: ${recoveredBackground};
}
#container { width: 100vw; height: 100vh; }`;
      } else if (engine === "c2") {
        fallbackHtml = '<canvas id="piece-canvas"></canvas>';
        fallbackCss = `html, body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background: ${recoveredBackground};
}
canvas { display: block; }`;
      }
      
      setHtmlCode(current?.htmlCode || fallbackHtml);
      setCssCode(current?.cssCode || fallbackCss);
      setGeneratedCode(current?.generatedCode || "");
    }
  }, [selected?.id, selected?.currentVersionId, creationMode]);

  // Auto-populate templates for new manual pieces
  useEffect(() => {
    if (creationMode === "manual") {
      const template = PIECE_TEMPLATES[selectedEngine];
      setHtmlCode(template.html);
      setCssCode(template.css);
      setGeneratedCode(template.js);
    }
  }, [creationMode, selectedEngine]);

  useEffect(() => () => {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
  }, []);

  const deletePiece = useDeleteArtPiece({
    mutation: {
      onSuccess: (_data, { id }) => {
        queryClient.invalidateQueries({ queryKey: getListArtPiecesQueryKey() });
        if (selectedId === id) setSelectedId(null);
        toast({ title: "Piece deleted" });
      },
      onError: () => {
        toast({ title: "Failed to delete piece", variant: "destructive" });
      },
    },
  });

  const updatePiece = useUpdateArtPiece({
    mutation: {
      onSuccess: (updated) => {
        queryClient.invalidateQueries({ queryKey: getListArtPiecesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetArtPieceQueryKey(updated.id) });
        toast({ title: "Piece updated" });
      },
      onError: () => {
        toast({ title: "Failed to update piece", variant: "destructive" });
      },
    },
  });

  const createVersion = useCreateArtPieceVersion({
    mutation: {
      onSuccess: (response) => {
        setTitle(response.piece.title);
        setPrompt(response.piece.prompt);
        setSelectedEngine(response.version.engine);
        setHtmlCode(response.version.htmlCode || "");
        setCssCode(response.version.cssCode || "");
        setGeneratedCode(response.version.generatedCode || "");
        queryClient.invalidateQueries({ queryKey: getListArtPiecesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetArtPieceQueryKey(response.piece.id) });
        setDraftOpen(false);
        setDraft(null);
        toast({ title: "New piece version saved" });
      },
      onError: () => {
        toast({ title: "Failed to save new version", variant: "destructive" });
      },
    },
  });

  const createPiece = useCreateArtPiece({
    mutation: {
      onSuccess: (response) => {
        queryClient.invalidateQueries({ queryKey: getListArtPiecesQueryKey() });
        setSelectedId(response.id);
        setCreationMode(null);
        setDraftOpen(false);
        setDraft(null);
        toast({ title: "New piece saved" });
      },
      onError: () => {
        toast({ title: "Failed to save piece", variant: "destructive" });
      },
    },
  });

  const updateAiSettings = useUpdateMyAiSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyAiSettingsQueryKey() });
      },
      onError: () => {
        toast({
          title: "Failed to save preferred AI vendor",
          description: "Your vendor choice will apply for now, but it did not persist to your account.",
          variant: "destructive",
        });
      },
    },
  });

  const processAiText = useProcessAiText();

  async function handleImproveText() {
    if (!prompt.trim()) {
      toast({ title: "Text required", description: "Enter a prompt or description before using AI improvement.", variant: "destructive" });
      return;
    }
    const descriptionVendor = preferredVendorAltText ?? aiVendors[0]?.id ?? null;
    if (!descriptionVendor) {
      toast({ title: "No AI vendor", description: "Configure a vendor in Admin → AI first.", variant: "destructive" });
      return;
    }
    setIsImprovingText(true);
    try {
      const result = await processAiText.mutateAsync({ data: { content: prompt, vendor: descriptionVendor, mode: "text" } });
      setPrompt(result.text);
    } catch {
      toast({ title: "AI failed", description: "Could not improve the text.", variant: "destructive" });
    } finally {
      setIsImprovingText(false);
    }
  }

  function handleVendorChange(nextVendor: ProcessAiTextBodyVendor) {
    setSelectedVendor(nextVendor);
    updateAiSettings.mutate({
      data: {
        settings: [],
        preferredArtPieceVendor: nextVendor,
      },
    });
  }

  function stopGeneration() {
    const activeState = generationState;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    if (activeState) {
      setGenerationState({
        ...activeState,
        open: true,
        phase: "cancelled",
        attemptCount: Math.max(activeState.attemptCount, 1),
        approximateAttempts: true,
        message: "Generation stopped before the server could finish validating a draft.",
      });
    }
  }

  async function handleGenerate() {
    if (!selectedVendor) return;

    generationAbortRef.current?.abort();
    const controller = new AbortController();
    generationAbortRef.current = controller;
    const vendorLabel = aiVendors.find((vendor) => vendor.id === selectedVendor)?.label ?? selectedVendor;

    setGenerationState({
      open: true,
      phase: "generating",
      prompt,
      engine: selectedEngine,
      vendorLabel,
      model: null,
      attemptCount: 1,
      maxAttempts: 5,
      message: null,
      startedAt: Date.now(),
      approximateAttempts: false,
    });

    try {
      const nextDraft = await requestGeneratedArtPiece(
        {
          prompt,
          engine: selectedEngine,
          vendor: selectedVendor,
        },
        { signal: controller.signal },
      );
      setDraft(nextDraft);
      setGenerationState(null);
      setDraftOpen(true);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      let message = "Failed to generate piece";
      let attemptCount = 1;
      let maxAttempts = 3;
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
            : selectedEngine;
        const failureStage =
          typeof body.failureStage === "string" && body.failureStage.trim()
            ? body.failureStage
            : null;
        const rawResponsePreview =
          typeof body.rawResponsePreview === "string" && body.rawResponsePreview.trim()
            ? body.rawResponsePreview
            : null;
        setGenerationState({
          open: true,
          phase,
          prompt,
          engine,
          vendorLabel,
          model: null,
          attemptCount,
          maxAttempts,
          message,
          failureStage,
          rawResponsePreview,
          startedAt: Date.now(),
          approximateAttempts: false,
        });
        return;
      }

      setGenerationState({
        open: true,
        phase,
        prompt,
        engine: selectedEngine,
        vendorLabel,
        model: null,
        attemptCount,
        maxAttempts,
        message,
        failureStage: null,
        rawResponsePreview: null,
        startedAt: Date.now(),
        approximateAttempts: false,
      });
    } finally {
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
      }
    }
  }

  function handlePieceEmbed() {
    if (!detail.data?.currentVersionId) return;
    const embedUrl = `${window.location.origin}/embed/pieces/${detail.data.id}`;
    const iframeCode = `<iframe src="${embedUrl}" width="100%" height="480" frameborder="0" style="border: 1px solid #e5e7eb; border-radius: 12px;"></iframe>`;
    navigator.clipboard.writeText(iframeCode).then(() => {
      toast({ title: "Embed code copied", description: "Iframe code is ready to paste." });
    }).catch(() => {
      toast({ title: "Failed to copy", description: embedUrl, variant: "destructive" });
    });
  }

  return (
    <AdminLayout
      title="Pieces"
      description="Reusable interactive pieces for embedding into posts."
    >
      <div className="mb-4 flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCreationMode("ai");
            setSelectedId(null);
            setTitle("");
            setPrompt("");
          }}
        >
          + New AI Piece
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setCreationMode("manual");
            setSelectedId(null);
            setTitle("");
            setPrompt("");
            const template = PIECE_TEMPLATES[selectedEngine];
            setHtmlCode(template.html);
            setCssCode(template.css);
            setGeneratedCode(template.js);
          }}
        >
          + New Piece
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card>
          <CardContent className="space-y-3 p-4">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pieces..."
            />
            <div className="max-h-[36rem] space-y-2 overflow-auto">
              {filtered.map((piece) => (
                <div key={piece.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedId(piece.id)}
                    className={`w-full rounded-lg border px-3 py-3 pr-9 text-left ${
                      selectedId === piece.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{piece.title}</p>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{piece.status}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{piece.prompt}</p>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${piece.title}`}
                    disabled={deletePiece.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete "${piece.title}"? This cannot be undone.`)) {
                        deletePiece.mutate({ id: piece.id });
                      }
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pieces yet.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-5 p-4">
            {creationMode === "ai" && !selected ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-piece-title">Title</Label>
                    <Input id="new-piece-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Particle Storm" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-piece-engine">Engine</Label>
                    <select
                      id="new-piece-engine"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={selectedEngine}
                      onChange={(event) => setSelectedEngine(event.target.value as ArtPieceEngine)}
                    >
                      <option value="p5">p5</option>
                      <option value="c2">c2</option>
                      <option value="three">Three.js</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-piece-vendor">AI vendor</Label>
                    <select
                      id="new-piece-vendor"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={selectedVendor}
                      onChange={(event) =>
                        handleVendorChange(event.target.value as ProcessAiTextBodyVendor)
                      }
                    >
                      {aiVendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>{vendor.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-piece-prompt">Prompt</Label>
                  <Textarea
                    id="new-piece-prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={4}
                    placeholder="Describe the interactive piece you want to create…"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isImprovingText || !(preferredVendorAltText ?? aiVendors[0]?.id)}
                    onClick={() => void handleImproveText()}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    {isImprovingText ? "Improving…" : "Improve prompt"}
                  </Button>
                  <Button
                    type="button"
                    disabled={!selectedVendor || !prompt.trim() || generationState?.phase === "generating"}
                    onClick={() => void handleGenerate()}
                  >
                    {generationState?.phase === "generating" ? "Generating..." : "Generate piece"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreationMode(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : !selected && creationMode !== "manual" ? (
              <p className="text-sm text-muted-foreground">Select a piece to manage it.</p>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 border-b border-border pb-2">
                    <button
                      type="button"
                      onClick={() => setViewTab("meta")}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${viewTab === "meta" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Metadata
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

                  {viewTab === "meta" && (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="piece-title">Title</Label>
                          <Input id="piece-title" value={title} onChange={(event) => setTitle(event.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="piece-engine">Engine</Label>
                          <select
                            id="piece-engine"
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={selectedEngine}
                            onChange={(event) => setSelectedEngine(event.target.value as ArtPieceEngine)}
                          >
                            <option value="p5">p5</option>
                            <option value="c2">c2</option>
                            <option value="three">Three.js</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="piece-vendor">AI vendor for new versions</Label>
                          <select
                            id="piece-vendor"
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={selectedVendor}
                            onChange={(event) =>
                              handleVendorChange(event.target.value as ProcessAiTextBodyVendor)
                            }
                          >
                            {aiVendors.map((vendor) => (
                              <option key={vendor.id} value={vendor.id}>{vendor.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="piece-description">Description</Label>
                        <Textarea
                          id="piece-description"
                          value={prompt}
                          onChange={(event) => setPrompt(event.target.value)}
                          rows={4}
                        />
                      </div>
                    </div>
                  )}

                  {viewTab === "html" && (
                    <div className="space-y-2">
                      <Label htmlFor="piece-html">HTML</Label>
                      <Textarea
                        id="piece-html"
                        className="font-mono text-xs"
                        value={htmlCode}
                        onChange={(event) => setHtmlCode(event.target.value)}
                        rows={10}
                      />
                    </div>
                  )}

                  {viewTab === "css" && (
                    <div className="space-y-2">
                      <Label htmlFor="piece-css">CSS</Label>
                      <Textarea
                        id="piece-css"
                        className="font-mono text-xs"
                        value={cssCode}
                        onChange={(event) => setCssCode(event.target.value)}
                        rows={10}
                      />
                    </div>
                  )}

                  {viewTab === "js" && (
                    <div className="space-y-2">
                      <Label htmlFor="piece-js">JavaScript</Label>
                      <Textarea
                        id="piece-js"
                        className="font-mono text-xs"
                        value={generatedCode}
                        onChange={(event) => setGeneratedCode(event.target.value)}
                        rows={15}
                      />
                    </div>
                  )}
                </div>

                {selected || creationMode === "manual" ? (
                  <ArtPieceRenderer
                    engine={selectedEngine}
                    code={generatedCode}
                    htmlCode={htmlCode}
                    cssCode={cssCode}
                    title={prompt || selected?.title}
                    immersiveHref={
                      selected?.id
                        ? buildImmersivePieceHref(selected.id, selected.currentVersionId)
                        : null
                    }
                  />
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isImprovingText || !(preferredVendorAltText ?? aiVendors[0]?.id)}
                    onClick={() => void handleImproveText()}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    {isImprovingText ? "Improving…" : "Improve description"}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      if (creationMode === "manual") {
                        createPiece.mutate({
                          data: {
                            title: title || "Untitled Piece",
                            prompt,
                            engine: selectedEngine,
                            htmlCode,
                            cssCode,
                            generatedCode,
                          },
                        });
                      } else if (selected) {
                        createVersion.mutate({
                          id: selected.id,
                          data: {
                            title,
                            prompt,
                            makeCurrent: true,
                            htmlCode,
                            cssCode,
                            generatedCode,
                          },
                        });
                      }
                    }}
                    disabled={createPiece.isPending || createVersion.isPending || !generatedCode.trim()}
                  >
                    {createPiece.isPending || createVersion.isPending ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (creationMode === "manual") {
                        setCreationMode(null);
                      } else if (selected) {
                        setTitle(selected.title);
                        setPrompt(selected.prompt);
                        setSelectedEngine(selected.engine);
                        setHtmlCode(selected.currentVersion?.htmlCode || "");
                        setCssCode(selected.currentVersion?.cssCode || "");
                        setGeneratedCode(selected.currentVersion?.generatedCode || "");
                      }
                    }}
                  >
                    Cancel
                  </Button>
                  {selected && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        updatePiece.mutate({
                          id: selected.id,
                          data: { status: selected.status === "active" ? "archived" : "active" },
                        })
                      }
                      disabled={updatePiece.isPending}
                    >
                      {selected.status === "active" ? "Archive" : "Restore"}
                    </Button>
                  )}
                  {selected && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!selectedVendor || generationState?.phase === "generating"}
                      onClick={() => void handleGenerate()}
                    >
                      {generationState?.phase === "generating" ? "Generating..." : "Generate new version"}
                    </Button>
                  )}
                  {selected && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!selected.currentVersion}
                      onClick={handlePieceEmbed}
                    >
                      <Code className="mr-1 h-3.5 w-3.5" /> Embed code
                    </Button>
                  )}
                </div>

                {selected && (
                  <div className="space-y-2">
                    <h3 className="font-semibold">Versions</h3>
                    <div className="space-y-2">
                      {selected.versions.map((version) => (
                        <div key={version.id} className="rounded-lg border border-border px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">Version #{version.id}</p>
                            <span className="text-xs text-muted-foreground">{version.createdAt}</span>
                          </div>
                          {version.notes ? (
                            <p className="mt-1 text-xs text-muted-foreground">{version.notes}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {generationState ? (
        <ArtPieceGenerationDialog
          state={generationState}
          onOpenChange={(open) => {
            if (!open) {
              if (generationState.phase === "generating") {
                stopGeneration();
                return;
              }
              setGenerationState(null);
            }
          }}
          onStop={stopGeneration}
          onRetry={() => void handleGenerate()}
        />
      ) : null}

      <ArtPieceDraftDialog
        open={draftOpen}
        onOpenChange={(open) => {
          setDraftOpen(open);
          if (!open) {
            setDraft(null);
          }
        }}
        draft={draft}
        prompt={prompt}
        isSaving={creationMode === "ai" ? createPiece.isPending : createVersion.isPending}
        onSaveAndInsert={() => {
          if (!draft) return;
          if (creationMode === "ai") {
            createPiece.mutate({ data: { draftToken: draft.draftToken, title: title || draft.title } });
          } else {
            if (!selected) return;
            createVersion.mutate({
              id: selected.id,
              data: {
                draftToken: draft.draftToken,
                title: title || draft.title,
                makeCurrent: true,
              },
            });
          }
        }}
      />
    </AdminLayout>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { ArrowLeft } from "lucide-react";
import { useRoute } from "wouter";
import {
  getGetExhibitItemsQueryKey,
  getGetExhibitQueryKey,
  useGetExhibitItems,
  useGetExhibit,
  type ExhibitWallImageItem,
  type ExhibitWallPieceItem,
} from "@workspace/api-client-react";
import {
  createMultiFrameExhibitWall,
  fitMultiFrameExhibitCamera,
  disposeObjectMaterial,
  createKeyboardNavigation,
} from "@/lib/immersive-gallery";
import {
  createImmersiveHost,
  DEFAULT_IMMERSIVE_RUNTIME_SIZE,
  normalizeManagedCanvasStyles,
  observeManagedCanvasContainment,
  resolveSketchFactory,
} from "@/lib/immersive-piece-runtime";
import {
  ImmersiveMetadataCard,
  ImmersiveRouteShell,
} from "@/components/immersive/ImmersiveRouteShell";

type WallItem =
  | ({ kind: "piece" } & ExhibitWallPieceItem)
  | ({ kind: "image" } & ExhibitWallImageItem);

function useReturnToPrevious() {
  return () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = "/";
  };
}

function engineLabel(engine: string): string {
  if (engine === "p5") return "P5.js";
  if (engine === "c2") return "C2.js";
  if (engine === "three") return "Three.js";
  return engine;
}

function ExhibitWallStage({
  items,
  rows,
  cols,
  labels,
}: {
  items: WallItem[];
  rows: number;
  cols: number;
  labels: Array<{ title: string; subtitle: string } | null>;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stage = stageRef.current as HTMLDivElement | null;
    if (!stage || items.length === 0) return;
    const safeStage = stage;

    const shell = createMultiFrameExhibitWall(safeStage, items.length, rows, cols, labels);
    const textures: (any | null)[] = Array(items.length).fill(null);
    const cleanups: Array<() => void> = [];
    let frameId = 0;

    const runtimeSize = { ...DEFAULT_IMMERSIVE_RUNTIME_SIZE };

    async function bootPieceSlot(
      idx: number,
      item: ExhibitWallPieceItem & { kind: "piece" },
    ) {
      const slot = shell.slots[idx];
      if (!slot) return;

      if (item.engine === "three") {
        const canvas = document.createElement("canvas");
        canvas.width = runtimeSize.width;
        canvas.height = runtimeSize.height;

        const hiddenDiv = document.createElement("div");
        hiddenDiv.style.position = "absolute";
        hiddenDiv.style.width = `${runtimeSize.width}px`;
        hiddenDiv.style.height = `${runtimeSize.height}px`;
        hiddenDiv.style.visibility = "hidden";
        hiddenDiv.style.pointerEvents = "none";
        hiddenDiv.style.overflow = "hidden";
        document.body.appendChild(hiddenDiv);
        hiddenDiv.appendChild(canvas);
        const canvasContainment = observeManagedCanvasContainment(
          canvas,
          hiddenDiv,
          runtimeSize,
        );

        let cleanup: (() => void) | void;
        let threeRenderer: { dispose?: () => void } | null = null;

        const stopFrameHandles = new Set<() => void>();
        const startFrame = (handler: (frameCount: number) => void) => {
          let frameCount = 0;
          let rafId = 0;
          function tick() {
            frameCount += 1;
            handler(frameCount);
            rafId = window.requestAnimationFrame(tick);
          }
          rafId = window.requestAnimationFrame(tick);
          const stop = () => window.cancelAnimationFrame(rafId);
          stopFrameHandles.add(stop);
          return () => { stop(); stopFrameHandles.delete(stop); };
        };

        const OriginalRenderer = THREE.WebGLRenderer;
        const instrumentedThree: any = { ...THREE };
        instrumentedThree.WebGLRenderer = class extends OriginalRenderer {
          constructor(input: any) {
            super({ ...input, canvas });
            threeRenderer = this;
            this.setPixelRatio?.(Math.min(window.devicePixelRatio, 1.5));
          }
        };

        (window as any).THREE = instrumentedThree;

        try {
          const sketchFactory = resolveSketchFactory(item.generatedCode);
          cleanup = sketchFactory({
            THREE: instrumentedThree,
            canvas,
            startFrame,
            size: runtimeSize,
            width: runtimeSize.width,
            height: runtimeSize.height,
          });

          const artTexture = new (THREE as any).CanvasTexture(canvas);
          artTexture.colorSpace = (THREE as any).SRGBColorSpace;
          slot.artMaterial.map = artTexture;
          slot.artMaterial.needsUpdate = true;
          textures[idx] = artTexture;
        } catch {
          // Piece failed to boot — leave placeholder color
        }

        cleanups.push(() => {
          stopFrameHandles.forEach((s) => s());
          stopFrameHandles.clear();
          cleanup?.();
          threeRenderer?.dispose?.();
          canvasContainment.dispose();
          textures[idx]?.dispose?.();
          textures[idx] = null;
          canvas.remove();
          hiddenDiv.remove();
        });
        return;
      }

      // P5 or C2
      const host = createImmersiveHost(
        item.htmlCode,
        item.cssCode,
        item.engine === "p5" ? '<div id="canvas-container"></div>' : '<canvas id="piece-canvas"></canvas>',
        runtimeSize,
      );

      let sourceCanvas: HTMLCanvasElement | null = null;
      let artTexture: any = null;
      let p5Instance: { remove?: () => void } | null = null;
      let stopSourceLoop: (() => void) | null = null;
      let detectTimer: number | null = null;
      let detectAttempts = 0;
      let managedCanvasContainment:
        | ReturnType<typeof observeManagedCanvasContainment>
        | null = null;

      function syncCanvas(canvas: HTMLCanvasElement) {
        sourceCanvas = canvas;
        if (!managedCanvasContainment) {
          const canvasHost =
            canvas.parentElement instanceof HTMLElement ? canvas.parentElement : host;
          managedCanvasContainment = observeManagedCanvasContainment(
            canvas,
            canvasHost,
            runtimeSize,
          );
        }
        if (!artTexture) {
          artTexture = new (THREE as any).CanvasTexture(canvas);
          artTexture.colorSpace = (THREE as any).SRGBColorSpace;
          slot.artMaterial.map = artTexture;
          slot.artMaterial.needsUpdate = true;
          textures[idx] = artTexture;
        }
      }

      function pollForCanvas(root: ParentNode) {
        const candidate = root.querySelector("canvas");
        if (candidate instanceof HTMLCanvasElement) {
          if (candidate.width === 0 || candidate.height === 0) {
            candidate.width = runtimeSize.width;
            candidate.height = runtimeSize.height;
          }
          syncCanvas(candidate);
          return;
        }
        if (detectAttempts >= 60) return;
        detectAttempts += 1;
        detectTimer = window.setTimeout(() => pollForCanvas(root), 150);
      }

      try {
        if (item.engine === "p5") {
          const p5Module = await import("p5");
          const P5 = (p5Module.default ?? p5Module) as any;
          const sketchFactory = resolveSketchFactory(item.generatedCode);
          const mount =
            host.querySelector("#canvas-container") ||
            host.querySelector("#sketch-container") ||
            host;
          p5Instance = new P5(sketchFactory, mount);
          pollForCanvas(mount);
        } else {
          // c2
          const c2Module = await import("c2.js");
          const c2 = (c2Module.default ?? c2Module) as any;
          (window as any).c2 = c2;
          const sketchFactory = resolveSketchFactory(item.generatedCode);
          const managedCanvas =
            (host.querySelector("canvas") as HTMLCanvasElement | null) ||
            document.createElement("canvas");
          managedCanvas.width = runtimeSize.width;
          managedCanvas.height = runtimeSize.height;
          normalizeManagedCanvasStyles(managedCanvas, runtimeSize);
          if (!managedCanvas.parentNode) host.appendChild(managedCanvas);
          syncCanvas(managedCanvas);

          let rafId = 0;
          const startFrame = (handler: (frameCount: number) => void) => {
            let frameCount = 0;
            function tick() {
              frameCount += 1;
              try { handler(frameCount); } catch { return; }
              rafId = window.requestAnimationFrame(tick);
            }
            rafId = window.requestAnimationFrame(tick);
            return () => window.cancelAnimationFrame(rafId);
          };

          const cleanup = sketchFactory({ c2, canvas: managedCanvas, startFrame, size: runtimeSize, width: runtimeSize.width, height: runtimeSize.height });
          stopSourceLoop = typeof cleanup === "function" ? cleanup : () => window.cancelAnimationFrame(rafId);
        }
      } catch {
        // Boot failed — leave placeholder
      }

      cleanups.push(() => {
        if (detectTimer) window.clearTimeout(detectTimer);
        artTexture?.dispose?.();
        textures[idx] = null;
        managedCanvasContainment?.dispose();
        stopSourceLoop?.();
        p5Instance?.remove?.();
        host.remove();
        void sourceCanvas;
      });
    }

    function bootImageSlot(idx: number, item: ExhibitWallImageItem) {
      const slot = shell.slots[idx];
      if (!slot) return;
      const loader = new THREE.TextureLoader();
      loader.load(
        item.url,
        (tex: any) => {
          tex.colorSpace = (THREE as any).SRGBColorSpace;
          slot.artMaterial.map = tex;
          slot.artMaterial.needsUpdate = true;
          textures[idx] = tex;
        },
        undefined,
        () => {
          // Load error — leave placeholder
        },
      );
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      if (item.kind === "image") {
        bootImageSlot(i, item);
      } else {
        void bootPieceSlot(i, item);
      }
    }

    const keyNav = createKeyboardNavigation(shell.controls, {
      container: stage,
      maxX: (cols * 3.2) / 2 + 4,
    });

    function animate() {
      frameId = requestAnimationFrame(animate);
      for (let i = 0; i < textures.length; i++) {
        const tex = textures[i];
        if (tex?.isCanvasTexture) {
          tex.needsUpdate = true;
        }
      }
      keyNav.update();
      shell.controls.update();
      shell.renderer.render(shell.scene, shell.camera);
    }

    fitMultiFrameExhibitCamera(shell, safeStage);
    animate();

    function handleResize() {
      fitMultiFrameExhibitCamera(shell, safeStage);
    }
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(safeStage);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(frameId);
      cleanups.forEach((fn) => fn());
      textures.forEach((tex) => tex?.dispose?.());
      keyNav.dispose();
      shell.controls.dispose();
      shell.floor.geometry.dispose();
      disposeObjectMaterial(shell.floor.material);
      shell.backWall.geometry.dispose();
      disposeObjectMaterial(shell.backWall.material);
      for (const slot of shell.slots) {
        slot.artMesh.geometry.dispose();
        slot.artMaterial.dispose();
        slot.frameMesh.geometry.dispose();
        disposeObjectMaterial(slot.frameMesh.material);
        slot.framePanel.geometry.dispose();
        disposeObjectMaterial(slot.framePanel.material);
        slot.labelMesh?.geometry.dispose();
        slot.labelMaterial?.map?.dispose();
        slot.labelMaterial?.dispose();
      }
      shell.renderer.dispose();
      safeStage.innerHTML = "";
    };
  }, [items, rows, cols]);

  return <div ref={stageRef} className="h-full w-full overflow-hidden" />;
}

export function ItemDetailCard({ item }: { item: WallItem }) {
  const badge = (text: string) => (
    <span className="inline-block text-xs uppercase tracking-[0.14em] text-white/55 mr-2">{text}</span>
  );

  if (item.kind === "piece") {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <h3 className="font-medium text-sm">{item.title}</h3>
        <div className="mt-1">{badge(engineLabel(item.engine))}</div>
        {item.description ? (
          <p className="mt-2 text-sm text-white/65 leading-relaxed">{item.description}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <h3 className="font-medium text-sm">{item.title ?? item.filename}</h3>
      <div className="mt-1">{badge("Image")}</div>
      {item.altText ? (
        <p className="mt-2 text-sm text-white/65 leading-relaxed">{item.altText}</p>
      ) : null}
    </div>
  );
}

type ExhibitWallContentProps = {
  exhibitName: string;
  exhibitDescription: string | null;
  artistStatement: string | null;
  biography: string | null;
  items: WallItem[];
  rows: number;
  cols: number;
  labels: Array<{ title: string; subtitle: string } | null>;
  onBack: () => void;
  renderStage?: (props: {
    items: WallItem[];
    rows: number;
    cols: number;
    labels: Array<{ title: string; subtitle: string } | null>;
    fullscreen: boolean;
  }) => ReactNode;
};

export function ExhibitWallContent({
  exhibitName,
  exhibitDescription,
  artistStatement,
  biography,
  items,
  rows,
  cols,
  labels,
  onBack,
  renderStage = ({ items: stageItems, rows: stageRows, cols: stageCols, labels: stageLabels }) => (
    <ExhibitWallStage
      items={stageItems}
      rows={stageRows}
      cols={stageCols}
      labels={stageLabels}
    />
  ),
}: ExhibitWallContentProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const metadataFields: Array<{ label: string; value: string }> = [];

  if (artistStatement) {
    metadataFields.push({ label: "Artist Statement", value: artistStatement });
  }
  if (biography) {
    metadataFields.push({ label: "Biography", value: biography });
  }
  metadataFields.push({
    label: "Works",
    value: `${items.length} item${items.length === 1 ? "" : "s"}`,
  });

  return (
    <ImmersiveRouteShell
      title={exhibitName}
      onBack={onBack}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => setIsFullscreen((current) => !current)}
      sceneHeightClassName="h-[65vh] min-h-[420px]"
      renderScene={({ fullscreen }) =>
        renderStage({ items, rows, cols, labels, fullscreen })
      }
      metadataCard={(
        <div className="space-y-5">
          <ImmersiveMetadataCard
            title={exhibitName}
            description={exhibitDescription}
            fields={metadataFields}
          />
          <div className="space-y-3">
            {items.map((item, index) => (
              <ItemDetailCard key={`${item.kind}-${item.id}-${index}`} item={item} />
            ))}
          </div>
        </div>
      )}
    />
  );
}

export default function ImmersiveExhibitWallPage() {
  const [, params] = useRoute("/immersive/exhibits/:slug");
  const goBack = useReturnToPrevious();
  const slug = params?.slug ?? "";

  const itemsQuery = useGetExhibitItems(slug, {
    query: {
      queryKey: getGetExhibitItemsQueryKey(slug),
      enabled: Boolean(slug),
    },
  });

  const exhibitQuery = useGetExhibit(slug, {
    query: {
      queryKey: getGetExhibitQueryKey(slug),
      enabled: Boolean(slug),
    },
  });

  const isLoading = itemsQuery.isLoading || exhibitQuery.isLoading;
  const hasError = itemsQuery.error || exhibitQuery.error;

  const { items, rows, cols, labels } = useMemo(() => {
    const data = itemsQuery.data;
    if (!data) return { items: [] as WallItem[], rows: 1, cols: 1, labels: [] as Array<{ title: string; subtitle: string } | null> };
    const r = data.rows ?? 1;
    const c = data.cols ?? 1;
    const all: WallItem[] = [];
    for (const p of data.pieces) all.push({ kind: "piece", ...p });
    for (const img of data.images) all.push({ kind: "image", ...img });
    const sliced = all.slice(0, r * c);
    const labelArr = sliced.map((item) =>
      item.kind === "piece"
        ? { title: item.title, subtitle: engineLabel(item.engine) }
        : { title: item.title ?? item.filename, subtitle: "Image" },
    );
    return { items: sliced, rows: r, cols: c, labels: labelArr };
  }, [itemsQuery.data]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") goBack();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goBack]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050b16] text-sm text-white/50">
        Loading exhibit…
      </div>
    );
  }

  if (hasError || !itemsQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050b16] px-6 text-white">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Exhibit not found</h1>
          <p className="mt-3 text-sm text-white/50">
            This exhibit could not be loaded.
          </p>
          <button
            type="button"
            onClick={goBack}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium transition hover:bg-white/20"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050b16] px-6 text-white">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Empty exhibit</h1>
          <p className="mt-3 text-sm text-white/50">
            No artwork has been assigned to this exhibit yet.
          </p>
          <button
            type="button"
            onClick={goBack}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium transition hover:bg-white/20"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>
      </div>
    );
  }

  const exhibit = exhibitQuery.data;
  const exhibitName = exhibit?.name ?? slug;

  return (
    <ExhibitWallContent
      exhibitName={exhibitName}
      exhibitDescription={exhibit?.description ?? null}
      artistStatement={exhibit?.artistStatement ?? null}
      biography={exhibit?.biography ?? null}
      items={items}
      rows={rows}
      cols={cols}
      labels={labels}
      onBack={goBack}
    />
  );
}

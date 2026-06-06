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
  EXHIBIT_FRAME_ASPECT,
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
import { buildExhibitGalleryEmbedHtml } from "@/lib/immersive-view";
import { persistArtPieceThumbnail } from "@/lib/art-piece-thumbnail";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useQueryClient } from "@tanstack/react-query";

export type WallItem =
  | ({ kind: "piece" } & ExhibitWallPieceItem)
  | ({ kind: "image" } & ExhibitWallImageItem);

function useReturnToPrevious() {
  return () => {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo");
    if (returnTo && returnTo.startsWith("/")) {
      window.location.href = returnTo;
      return;
    }
    const postId = params.get("post");
    if (postId && !isNaN(Number(postId))) {
      window.location.href = `/posts/${postId}`;
      return;
    }
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
  if (engine === "svg") return "SVG";
  return engine;
}

export type ExhibitSlotLifecycle = "idle" | "booting" | "live" | "frozen" | "failed";

type ExhibitSlotCenter = { x: number; y: number; z: number };

export function getProgressiveExhibitLiveBudget(
  viewportWidth: number,
  staticMode = false,
) {
  if (staticMode) return 1;
  if (viewportWidth < 640) return 1;
  if (viewportWidth < 1180) return 2;
  return 3;
}

export function selectProgressiveExhibitSlots(
  items: WallItem[],
  centers: Array<ExhibitSlotCenter | null | undefined>,
  target: ExhibitSlotCenter,
  liveBudget: number,
) {
  if (liveBudget <= 0) return new Set<number>();

  return new Set(
    items
      .map((item, index) => {
        const center = centers[index];
        if (item.kind !== "piece" || !center) return null;
        const dx = center.x - target.x;
        const dy = center.y - target.y;
        const dz = center.z - target.z;
        return { index, distance: (dx * dx) + (dy * dy) + (dz * dz * 0.35) };
      })
      .filter((entry): entry is { index: number; distance: number } => Boolean(entry))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, liveBudget)
      .map((entry) => entry.index),
  );
}

function ExhibitWallStage({
  items,
  rows,
  cols,
  labels,
  staticMode = false,
}: {
  items: WallItem[];
  rows: number;
  cols: number;
  labels: Array<{ title: string; subtitle: string } | null>;
  staticMode?: boolean;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stage = stageRef.current as HTMLDivElement | null;
    if (!stage || items.length === 0) return;
    const safeStage = stage;

    const shell = createMultiFrameExhibitWall(safeStage, items.length, rows, cols, labels);
    type RuntimeHandle = {
      canvas: HTMLCanvasElement | null;
      texture: any | null;
      cleanup: () => void;
    };
    type SlotState = {
      status: ExhibitSlotLifecycle;
      texture: any | null;
      textureKind: "placeholder" | "runtime" | "snapshot" | "image" | null;
      runtime: RuntimeHandle | null;
      token: number;
      placeholderQueued: boolean;
    };

    const slotStates: SlotState[] = items.map(() => ({
      status: "idle",
      texture: null,
      textureKind: null,
      runtime: null,
      token: 0,
      placeholderQueued: false,
    }));
    let frameId = 0;
    let frameCount = 0;
    let disposed = false;
    let lastActiveKey = "";
    let textureQueue = Promise.resolve();

    const runtimeSize = { ...DEFAULT_IMMERSIVE_RUNTIME_SIZE };

    function replaceTexture(
      idx: number,
      texture: any | null,
      textureKind: SlotState["textureKind"],
      disposePrevious = true,
    ) {
      const slot = shell.slots[idx];
      const state = slotStates[idx];
      if (!slot || !state) return;
      const previous = state.texture;
      if (previous && previous !== texture && disposePrevious) {
        previous.dispose?.();
      }
      state.texture = texture;
      state.textureKind = textureKind;
      slot.artMaterial.map = texture;
      slot.artMaterial.needsUpdate = true;
    }

    function enqueueTextureLoad(
      idx: number,
      url: string | null | undefined,
      onLoaded: (texture: any) => void,
    ) {
      if (!url) return;
      textureQueue = textureQueue
        .catch(() => undefined)
        .then(() => new Promise<void>((resolve) => {
          if (disposed) {
            resolve();
            return;
          }
          const loader = new THREE.TextureLoader();
          loader.load(
            url,
            (tex: any) => {
              if (disposed) {
                tex.dispose?.();
                resolve();
                return;
              }
              tex.colorSpace = (THREE as any).SRGBColorSpace;
              onLoaded(tex);
              resolve();
            },
            undefined,
            () => {
              const state = slotStates[idx];
              if (state?.status === "idle" || state?.status === "booting") {
                state.status = "failed";
              }
              resolve();
            },
          );
        }));
    }

    function queuePiecePlaceholder(idx: number, item: ExhibitWallPieceItem & { kind: "piece" }) {
      const state = slotStates[idx];
      if (!state || state.placeholderQueued || !item.thumbnailUrl) return;
      state.placeholderQueued = true;
      enqueueTextureLoad(idx, item.thumbnailUrl, (tex) => {
        const current = slotStates[idx];
        if (
          !current
          || current.textureKind === "runtime"
          || current.textureKind === "snapshot"
          || current.textureKind === "image"
        ) {
          tex.dispose?.();
          return;
        }
        replaceTexture(idx, tex, "placeholder");
      });
    }

    function createSnapshotTexture(canvas: HTMLCanvasElement | null) {
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
      const snapshot = document.createElement("canvas");
      snapshot.width = 512;
      snapshot.height = 384;
      const ctx = snapshot.getContext("2d");
      if (!ctx) return null;
      try {
        ctx.drawImage(canvas, 0, 0, snapshot.width, snapshot.height);
      } catch {
        return null;
      }
      const texture = new (THREE as any).CanvasTexture(snapshot);
      texture.colorSpace = (THREE as any).SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    }

    function createMissingPreviewTexture() {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 384;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#111111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(24, 24, canvas.width - 48, canvas.height - 48);
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = "bold 24px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("Preview unavailable", 48, canvas.height / 2 - 10);
      ctx.fillStyle = "rgba(255,255,255,0.54)";
      ctx.font = "18px sans-serif";
      ctx.fillText("Regenerate thumbnail in admin", 48, canvas.height / 2 + 28);
      const texture = new (THREE as any).CanvasTexture(canvas);
      texture.colorSpace = (THREE as any).SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    }

    async function bootPieceSlot(
      idx: number,
      item: ExhibitWallPieceItem & { kind: "piece" },
      token: number,
    ): Promise<RuntimeHandle | null> {
      const slot = shell.slots[idx];
      if (!slot || disposed || slotStates[idx]?.token !== token) return null;

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

        let cleanup: (() => void) | undefined;
        let threeRenderer: { dispose?: () => void } | undefined;

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
            super({ ...input, canvas, preserveDrawingBuffer: true });
            threeRenderer = this as { dispose?: () => void };
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
          if (disposed || slotStates[idx]?.token !== token) {
            artTexture.dispose?.();
            cleanup?.();
            threeRenderer?.dispose?.();
            canvasContainment.dispose();
            canvas.remove();
            hiddenDiv.remove();
            return null;
          }
          replaceTexture(idx, artTexture, "runtime");
          return {
            canvas,
            texture: artTexture,
            cleanup: () => {
              stopFrameHandles.forEach((s) => s());
              stopFrameHandles.clear();
              cleanup?.();
              threeRenderer?.dispose?.();
              canvasContainment.dispose();
              canvas.remove();
              hiddenDiv.remove();
            },
          };
        } catch {
          stopFrameHandles.forEach((s) => s());
          stopFrameHandles.clear();
          cleanup?.();
          threeRenderer?.dispose?.();
          canvasContainment.dispose();
          canvas.remove();
          hiddenDiv.remove();
          return null;
        }
      }

      // P5, C2, or SVG
      const host = createImmersiveHost(
        item.htmlCode,
        item.cssCode,
        item.engine === "p5"
          ? '<div id="canvas-container"></div>'
          : item.engine === "svg"
            ? '<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"></svg>'
            : '<canvas id="piece-canvas"></canvas>',
        runtimeSize,
        item.engine,
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
        if (disposed || slotStates[idx]?.token !== token) return;
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
          replaceTexture(idx, artTexture, "runtime");
        }
      }

      function pollForCanvas(root: ParentNode) {
        if (disposed || slotStates[idx]?.token !== token) return;
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
          if (disposed || slotStates[idx]?.token !== token) {
            host.remove();
            return null;
          }
          const P5 = (p5Module.default ?? p5Module) as any;
          const sketchFactory = resolveSketchFactory(item.generatedCode);
          const mount =
            host.querySelector("#canvas-container") ||
            host.querySelector("#sketch-container") ||
            host;
          p5Instance = new P5(sketchFactory, mount);
          pollForCanvas(mount);
        } else if (item.engine === "svg") {
          if (disposed || slotStates[idx]?.token !== token) {
            host.remove();
            return null;
          }

          // Shadow DOM scopes piece CSS — no leakage; parent-context rAF never throttled
          const shadowHost = document.createElement("div");
          shadowHost.style.cssText = `position:fixed;left:-10000px;top:0;width:${runtimeSize.width}px;height:${runtimeSize.height}px;pointer-events:none;`;
          const shadowRoot = shadowHost.attachShadow({ mode: "open" });
          if (item.cssCode) {
            const styleEl = document.createElement("style");
            styleEl.textContent = item.cssCode;
            shadowRoot.appendChild(styleEl);
          }
          const svgContainer = document.createElement("div");
          svgContainer.style.cssText = "width:100%;height:100%;";
          svgContainer.innerHTML = item.htmlCode?.trim()
            ? item.htmlCode
            : '<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"></svg>';
          shadowRoot.appendChild(svgContainer);
          document.body.appendChild(shadowHost);

          const svgEl = shadowRoot.querySelector("svg");
          if (!svgEl) {
            shadowHost.remove();
            host.remove();
            return null;
          }

          const svgCanvas = document.createElement("canvas");
          svgCanvas.width = Math.round(runtimeSize.height * EXHIBIT_FRAME_ASPECT);
          svgCanvas.height = runtimeSize.height;
          syncCanvas(svgCanvas);

          (window as any).svgRoot = svgEl;

          const _origGetById = document.getElementById.bind(document);
          document.getElementById = function(id: string) {
            const found = _origGetById(id);
            if (!found && (id === "container" || id === "canvas-container" || id === "sketch-container")) {
              return (window as any).svgRoot ?? null;
            }
            return found;
          } as typeof document.getElementById;
          const _origQuerySelector = document.querySelector.bind(document);
          document.querySelector = function<E extends Element = Element>(sel: string): E | null {
            const found = _origQuerySelector<E>(sel);
            if (!found && sel === "svg") return ((window as any).svgRoot ?? null) as E | null;
            return found;
          } as typeof document.querySelector;

          const sketchFactory = resolveSketchFactory(item.generatedCode);
          if (typeof sketchFactory === "function") {
            try { sketchFactory(); } catch { /* ignore */ }
          }

          let drawPending = false;
          async function drawSvgSnapshot() {
            if (drawPending || disposed) return;
            drawPending = true;
            try {
              const svgClone = svgEl!.cloneNode(true) as SVGSVGElement;
              const liveEls = Array.from(svgEl!.querySelectorAll("*"));
              const cloneEls = Array.from(svgClone.querySelectorAll("*"));
              const propertiesToSync = [
                "transform", "transform-origin", "opacity", "fill", "stroke",
                "stroke-width", "stroke-dasharray", "stroke-dashoffset",
                "fill-opacity", "stroke-opacity",
                "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height",
                "d",
                "stop-color", "stop-opacity", "offset",
                "filter", "clip-path", "mask", "display", "visibility"
              ];
              liveEls.forEach((liveEl, i) => {
                const cloneEl = cloneEls[i] as SVGElement | undefined;
                if (!cloneEl) return;
                const s = window.getComputedStyle(liveEl);
                propertiesToSync.forEach((prop) => {
                  const val = s.getPropertyValue(prop);
                  if (val !== undefined && val !== null && val !== "") {
                    // Skip copying default/unaltered values to keep styles lightweight
                    if (prop === "transform" && (val === "none" || val === "matrix(1, 0, 0, 1, 0, 0)")) return;
                    if (prop === "opacity" && val === "1") return;
                    if (prop === "fill" && (val === "none" || val === "rgb(0, 0, 0)")) return;
                    if (prop === "stroke" && val === "none") return;
                    cloneEl.style.setProperty(prop, val);
                  }
                });
              });
              {
                const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
                // Disable CSS animations/transitions in the snapshot so @keyframes don't restart
                // from t=0 and override the getComputedStyle inline styles we just applied above.
                styleEl.textContent = (item.cssCode || "") + "\n* { animation: none !important; transition: none !important; }";
                svgClone.insertBefore(styleEl, svgClone.firstChild);
              }
              const serialized = new XMLSerializer().serializeToString(svgClone);
              const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(serialized);
              await new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => {
                  const ctx = svgCanvas.getContext("2d");
                  if (ctx) {
                    ctx.clearRect(0, 0, svgCanvas.width, svgCanvas.height);
                    const natW = img.naturalWidth  || svgEl!.viewBox?.baseVal?.width  || 800;
                    const natH = img.naturalHeight || svgEl!.viewBox?.baseVal?.height || 600;
                    const imgAspect = natW / Math.max(natH, 1);
                    let dw = svgCanvas.width;
                    let dh = dw / imgAspect;
                    if (dh > svgCanvas.height) { dh = svgCanvas.height; dw = dh * imgAspect; }
                    ctx.drawImage(img, (svgCanvas.width - dw) / 2, (svgCanvas.height - dh) / 2, dw, dh);
                  }
                  if (artTexture) artTexture.needsUpdate = true;
                  resolve();
                };
                img.onerror = () => resolve();
                img.src = dataUrl;
              });
            } finally {
              drawPending = false;
            }
          }

          await drawSvgSnapshot();
          const intervalId = window.setInterval(() => { drawSvgSnapshot().catch(() => {}); }, 100);
          stopSourceLoop = () => {
            window.clearInterval(intervalId);
            document.getElementById = _origGetById as typeof document.getElementById;
            document.querySelector = _origQuerySelector as typeof document.querySelector;
            shadowHost.remove();
            delete (window as any).svgRoot;
          };
        } else {
          // c2
          const c2Module = await import("c2.js");
          if (disposed || slotStates[idx]?.token !== token) {
            host.remove();
            return null;
          }
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
        if (detectTimer) window.clearTimeout(detectTimer);
        artTexture?.dispose?.();
        (managedCanvasContainment as ReturnType<typeof observeManagedCanvasContainment> | null)?.dispose();
        stopSourceLoop?.();
        p5Instance?.remove?.();
        host.remove();
        return null;
      }

      return {
        get canvas() {
          return sourceCanvas;
        },
        get texture() {
          return artTexture;
        },
        cleanup: () => {
          if (detectTimer) window.clearTimeout(detectTimer);
          managedCanvasContainment?.dispose();
          stopSourceLoop?.();
          p5Instance?.remove?.();
          host.remove();
          void sourceCanvas;
        },
      };
    }

    function bootImageSlot(idx: number, item: ExhibitWallImageItem) {
      const state = slotStates[idx];
      if (!state) return;
      state.status = "booting";
      enqueueTextureLoad(idx, item.url, (tex) => {
        replaceTexture(idx, tex, "image");
        const current = slotStates[idx];
        if (current) current.status = "frozen";
      });
    }

    function queueMissingPreviewPlaceholder(idx: number, item: ExhibitWallPieceItem & { kind: "piece" }) {
      const state = slotStates[idx];
      if (!state || item.thumbnailUrl || state.textureKind) return;
      const texture = createMissingPreviewTexture();
      if (texture) {
        replaceTexture(idx, texture, "placeholder");
      }
    }

    function freezePieceSlot(idx: number) {
      const state = slotStates[idx];
      if (!state) return;
      if (!state.runtime) {
        if (state.status === "booting") {
          state.token += 1;
          state.status = "frozen";
        }
        return;
      }
      const snapshot = createSnapshotTexture(state.runtime.canvas);
      state.runtime.cleanup();
      state.runtime = null;
      state.token += 1;
      if (snapshot) {
        replaceTexture(idx, snapshot, "snapshot");
      } else if (state.textureKind === "runtime") {
        state.textureKind = "snapshot";
      }
      state.status = "frozen";
    }

    function activatePieceSlot(idx: number, item: ExhibitWallPieceItem & { kind: "piece" }) {
      const state = slotStates[idx];
      if (!state || state.status === "live" || state.status === "booting") return;
      state.status = "booting";
      const token = state.token + 1;
      state.token = token;
      void bootPieceSlot(idx, item, token).then((runtime) => {
        const current = slotStates[idx];
        if (!current || disposed || current.token !== token) {
          if (current?.texture && current.texture === runtime?.texture) {
            replaceTexture(idx, null, null);
          }
          runtime?.cleanup();
          runtime?.texture?.dispose?.();
          return;
        }
        if (!runtime) {
          current.status = "failed";
          return;
        }
        current.runtime = runtime;
        current.status = "live";
      });
    }

    function reconcileActiveSlots(force = false) {
      const liveBudget = getProgressiveExhibitLiveBudget(
        safeStage.clientWidth || window.innerWidth,
        staticMode,
      );
      const active = selectProgressiveExhibitSlots(
        items,
        shell.slots.map((slot) => slot.center),
        shell.controls.target,
        liveBudget,
      );
      const activeKey = Array.from(active).sort((a, b) => a - b).join(",");
      if (!force && activeKey === lastActiveKey) return;
      lastActiveKey = activeKey;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || item.kind !== "piece") continue;
        if (active.has(i)) {
          activatePieceSlot(i, item);
        } else {
          freezePieceSlot(i);
        }
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item?.kind === "piece") {
        queuePiecePlaceholder(i, item);
        queueMissingPreviewPlaceholder(i, item);
      }
    }
    reconcileActiveSlots(true);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item?.kind === "image") {
        bootImageSlot(i, item);
      }
    }

    if (staticMode) {
      shell.controls.enabled = false;
    }

    const keyNav = staticMode
      ? null
      : createKeyboardNavigation(shell.controls, {
          container: stage,
          maxX: (cols * 3.2) / 2 + 4,
        });

    function animate() {
      frameId = requestAnimationFrame(animate);
      frameCount += 1;
      for (let i = 0; i < slotStates.length; i++) {
        const tex = slotStates[i]?.texture;
        if (tex?.isCanvasTexture) {
          tex.needsUpdate = true;
        }
      }
      keyNav?.update();
      shell.controls.update();
      if (frameCount % 12 === 0) {
        reconcileActiveSlots();
      }
      shell.renderer.render(shell.scene, shell.camera);
    }

    fitMultiFrameExhibitCamera(shell, safeStage);
    animate();

    function handleResize() {
      fitMultiFrameExhibitCamera(shell, safeStage, false);
      reconcileActiveSlots(true);
    }
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(safeStage);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      cancelAnimationFrame(frameId);
      slotStates.forEach((state) => {
        state.runtime?.cleanup();
        state.texture?.dispose?.();
        state.runtime = null;
        state.texture = null;
        state.textureKind = null;
      });
      keyNav?.dispose();
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
  }, [items, rows, cols, staticMode]);

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
  embedCodes?: { plain: { label: string; code: string }; gallery: { label: string; code: string } };
  isEmbedMode?: boolean;
  showEmbedFullscreenControl?: boolean;
  staticMode?: boolean;
  canonicalHref?: string;
  renderStage?: (props: {
    items: WallItem[];
    rows: number;
    cols: number;
    labels: Array<{ title: string; subtitle: string } | null>;
    fullscreen: boolean;
    staticMode?: boolean;
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
  embedCodes,
  isEmbedMode,
  showEmbedFullscreenControl,
  staticMode = false,
  canonicalHref,
  renderStage = ({ items: stageItems, rows: stageRows, cols: stageCols, labels: stageLabels, staticMode: stageStaticMode }) => (
    <ExhibitWallStage
      items={stageItems}
      rows={stageRows}
      cols={stageCols}
      labels={stageLabels}
      staticMode={stageStaticMode}
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
      isEmbedMode={isEmbedMode}
      showEmbedFullscreenControl={showEmbedFullscreenControl}
      canonicalHref={canonicalHref}
      embedCodes={!isEmbedMode ? embedCodes : undefined}
      renderScene={({ fullscreen }) =>
        renderStage({ items, rows, cols, labels, fullscreen, staticMode })
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
  const queryClient = useQueryClient();
  const { isOwner } = useCurrentUser();
  const thumbnailQueueRef = useRef<Promise<void>>(Promise.resolve());
  const thumbnailQueuedIdsRef = useRef<Set<number>>(new Set());

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
    if (!isOwner || !slug) return;
    const missingPieces = items.filter(
      (item): item is { kind: "piece" } & ExhibitWallPieceItem =>
        item.kind === "piece" && !item.thumbnailUrl && !thumbnailQueuedIdsRef.current.has(item.id),
    );
    if (missingPieces.length === 0) return;

    for (const piece of missingPieces) {
      thumbnailQueuedIdsRef.current.add(piece.id);
      thumbnailQueueRef.current = thumbnailQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await persistArtPieceThumbnail({
            id: piece.id,
            title: piece.title,
            engine: piece.engine,
            currentVersion: {
              id: 0,
              artPieceId: piece.id,
              engine: piece.engine,
              generatedCode: piece.generatedCode,
              htmlCode: piece.htmlCode ?? null,
              cssCode: piece.cssCode ?? null,
              prompt: "",
              structuredSpec: null,
              generationVendor: null,
              generationModel: null,
              validationStatus: "validated",
              generationAttemptCount: 1,
              notes: null,
              createdAt: "",
            },
          } as any);
          queryClient.invalidateQueries({ queryKey: getGetExhibitItemsQueryKey(slug) });
        })
        .catch((error) => {
          console.error("Failed to generate exhibit thumbnail", {
            pieceId: piece.id,
            error,
          });
          thumbnailQueuedIdsRef.current.delete(piece.id);
        });
    }
  }, [isOwner, items, queryClient, slug]);

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

  const searchParams = new URLSearchParams(window.location.search);
  const isEmbedMode = searchParams.get("embed") === "1";
  const isStaticEmbed = isEmbedMode && searchParams.get("static") === "1";

  const origin = window.location.origin;
  const safeName = exhibitName.replace(/"/g, "&quot;");
  const plainEmbedCode = `<iframe src="${origin}/immersive/exhibits/${slug}?embed=1" width="100%" style="width:100%;aspect-ratio:16 / 9;display:block;" title="${safeName}" frameborder="0" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>`;
  const galleryEmbedCode = buildExhibitGalleryEmbedHtml(slug, exhibitName, origin);
  const canonicalHref = `${origin}/immersive/exhibits/${slug}`;

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
      embedCodes={{
        plain: { label: "Embed Exhibit", code: plainEmbedCode },
        gallery: { label: "Embed Interactive", code: galleryEmbedCode },
      }}
      isEmbedMode={isEmbedMode}
      showEmbedFullscreenControl={!isStaticEmbed}
      staticMode={isStaticEmbed}
      canonicalHref={canonicalHref}
    />
  );
}

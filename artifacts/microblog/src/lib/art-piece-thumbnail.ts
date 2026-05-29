import type { ArtPiece, ArtPieceEngine, ArtPieceVersion } from "@workspace/api-client-react";
import { updateArtPiece, uploadMedia } from "@workspace/api-client-react";
import {
  createImmersiveHost,
  DEFAULT_IMMERSIVE_RUNTIME_SIZE,
  normalizeManagedCanvasStyles,
  observeManagedCanvasContainment,
  resolveSketchFactory,
} from "@/lib/immersive-piece-runtime";
import * as THREE from "three";

type ThumbnailSource = {
  id: number;
  title: string;
  engine: ArtPieceEngine;
  currentVersion?: ArtPieceVersion | null;
};

type RuntimeHandle = {
  canvas: HTMLCanvasElement | null;
  cleanup: () => void;
};

const THUMBNAIL_WIDTH = 960;
const THUMBNAIL_HEIGHT = 540;

function waitFrames(count: number) {
  return new Promise<void>((resolve) => {
    let remaining = count;
    function tick() {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  });
}

function waitForCanvas(runtime: RuntimeHandle) {
  return new Promise<HTMLCanvasElement | null>((resolve) => {
    let attempts = 0;
    function tick() {
      attempts += 1;
      if (runtime.canvas) {
        resolve(runtime.canvas);
        return;
      }
      if (attempts >= 60) {
        resolve(null);
        return;
      }
      window.requestAnimationFrame(tick);
    }
    tick();
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  const output = document.createElement("canvas");
  output.width = THUMBNAIL_WIDTH;
  output.height = THUMBNAIL_HEIGHT;
  const ctx = output.getContext("2d");
  if (!ctx) {
    throw new Error("Thumbnail canvas could not be created.");
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(canvas, 0, 0, output.width, output.height);

  return new Promise<Blob>((resolve, reject) => {
    output.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Thumbnail capture failed."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

async function bootThumbnailRuntime(source: ThumbnailSource): Promise<RuntimeHandle> {
  const version = source.currentVersion;
  if (!version) {
    throw new Error("Piece has no current version to thumbnail.");
  }

  const size = { ...DEFAULT_IMMERSIVE_RUNTIME_SIZE };

  if (source.engine === "three") {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.width = `${size.width}px`;
    host.style.height = `${size.height}px`;
    host.style.overflow = "hidden";
    host.style.pointerEvents = "none";
    document.body.appendChild(host);
    host.appendChild(canvas);
    const containment = observeManagedCanvasContainment(canvas, host, size);

    const stopFrameHandles = new Set<() => void>();
    let renderer: { dispose?: () => void } | null = null;
    let cleanup: (() => void) | undefined;
    const OriginalRenderer = THREE.WebGLRenderer;
    const instrumentedThree: any = { ...THREE };
    instrumentedThree.WebGLRenderer = class extends OriginalRenderer {
      constructor(input: any) {
        super({ ...input, canvas, preserveDrawingBuffer: true });
        renderer = this as { dispose?: () => void };
        this.setPixelRatio?.(1);
      }
    };

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
      return () => {
        stop();
        stopFrameHandles.delete(stop);
      };
    };

    const sketchFactory = resolveSketchFactory(version.generatedCode);
    cleanup = sketchFactory({
      THREE: instrumentedThree,
      canvas,
      startFrame,
      size,
      width: size.width,
      height: size.height,
    });

    return {
      canvas,
      cleanup: () => {
        stopFrameHandles.forEach((stop) => stop());
        stopFrameHandles.clear();
        cleanup?.();
        renderer?.dispose?.();
        containment.dispose();
        canvas.remove();
        host.remove();
      },
    };
  }

  const host = createImmersiveHost(
    version.htmlCode,
    version.cssCode,
    source.engine === "p5"
      ? '<div id="canvas-container"></div>'
      : '<canvas id="piece-canvas"></canvas>',
    size,
  );
  let sourceCanvas: HTMLCanvasElement | null = null;
  let p5Instance: { remove?: () => void } | null = null;
  let stopSourceLoop: (() => void) | null = null;
  let containment: ReturnType<typeof observeManagedCanvasContainment> | null = null;

  function syncCanvas(canvas: HTMLCanvasElement) {
    sourceCanvas = canvas;
    if (!containment) {
      const canvasHost = canvas.parentElement instanceof HTMLElement ? canvas.parentElement : host;
      containment = observeManagedCanvasContainment(canvas, canvasHost, size);
    }
  }

  if (source.engine === "p5") {
    const p5Module = await import("p5");
    const P5 = (p5Module.default ?? p5Module) as any;
    const sketchFactory = resolveSketchFactory(version.generatedCode);
    const mount =
      host.querySelector("#canvas-container") ||
      host.querySelector("#sketch-container") ||
      host;
    p5Instance = new P5(sketchFactory, mount);
    await waitFrames(2);
    const canvas = mount.querySelector("canvas");
    if (canvas instanceof HTMLCanvasElement) {
      if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      syncCanvas(canvas);
    }
  } else {
    const c2Module = await import("c2.js");
    const c2 = (c2Module.default ?? c2Module) as any;
    (window as any).c2 = c2;
    const sketchFactory = resolveSketchFactory(version.generatedCode);
    const canvas =
      (host.querySelector("canvas") as HTMLCanvasElement | null) ||
      document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    normalizeManagedCanvasStyles(canvas, size);
    if (!canvas.parentNode) host.appendChild(canvas);
    syncCanvas(canvas);

    let rafId = 0;
    const startFrame = (handler: (frameCount: number) => void) => {
      let frameCount = 0;
      function tick() {
        frameCount += 1;
        handler(frameCount);
        rafId = window.requestAnimationFrame(tick);
      }
      rafId = window.requestAnimationFrame(tick);
      return () => window.cancelAnimationFrame(rafId);
    };
    const cleanup = sketchFactory({
      c2,
      canvas,
      startFrame,
      size,
      width: size.width,
      height: size.height,
    });
    stopSourceLoop = typeof cleanup === "function"
      ? cleanup
      : () => window.cancelAnimationFrame(rafId);
  }

  return {
    get canvas() {
      return sourceCanvas;
    },
    cleanup: () => {
      containment?.dispose();
      stopSourceLoop?.();
      p5Instance?.remove?.();
      host.remove();
    },
  };
}

export async function captureArtPieceThumbnailBlob(source: ThumbnailSource) {
  const runtime = await bootThumbnailRuntime(source);
  try {
    const canvas = await waitForCanvas(runtime);
    if (!canvas) {
      throw new Error("Piece did not create a canvas for thumbnail capture.");
    }
    await waitFrames(24);
    return await canvasToPngBlob(canvas);
  } finally {
    runtime.cleanup();
  }
}

export async function persistArtPieceThumbnailBlob(
  piece: Pick<ThumbnailSource, "id">,
  blob: Blob,
) {
  const file = new File([blob], `art-piece-${piece.id}-thumbnail.png`, {
    type: "image/png",
  });
  const uploaded = await uploadMedia({ file });
  await updateArtPiece(piece.id, { thumbnailUrl: uploaded.url });
  return uploaded.url;
}

export async function persistArtPieceThumbnail(piece: ThumbnailSource | ArtPiece) {
  const blob = await captureArtPieceThumbnailBlob(piece);
  return persistArtPieceThumbnailBlob(piece, blob);
}

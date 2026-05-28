import { sanitizeArtPieceHtml } from "./art-piece-runtime";

export type ImmersiveRuntimeSize = {
  width: number;
  height: number;
};

export const DEFAULT_IMMERSIVE_RUNTIME_SIZE: ImmersiveRuntimeSize = {
  width: 1280,
  height: 720,
};

export function resolveSketchFactory(code: string) {
  const sketchWindow = window as Window & { sketch?: unknown };
  const previousSketch = sketchWindow.sketch;

  try {
    try {
      const expressionFactory = new Function(`return (${code})`)();
      if (typeof expressionFactory === "function") {
        return expressionFactory as (...args: any[]) => any;
      }
    } catch {
      // Fall through to the window.sketch assignment path.
    }

    sketchWindow.sketch = undefined;
    new Function(code)();
    if (typeof sketchWindow.sketch === "function") {
      return sketchWindow.sketch as (...args: any[]) => any;
    }
    throw new Error("Generated code did not define window.sketch or evaluate to a function");
  } finally {
    if (previousSketch === undefined) {
      delete sketchWindow.sketch;
    } else {
      sketchWindow.sketch = previousSketch;
    }
  }
}

export function getCanvasMetrics(
  canvas: HTMLCanvasElement | null | undefined,
  fallback: ImmersiveRuntimeSize = DEFAULT_IMMERSIVE_RUNTIME_SIZE,
) {
  const width = canvas?.width || canvas?.clientWidth || fallback.width;
  const height = canvas?.height || canvas?.clientHeight || fallback.height;
  return {
    width,
    height,
    aspect: Math.max(width / Math.max(height, 1), 0.45),
  };
}

function isVisibleBackgroundColor(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "transparent" && normalized !== "rgba(0, 0, 0, 0)";
}

export function resolveImmersiveElementBackground(
  elements: Array<Element | null | undefined>,
) {
  for (const element of elements) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    const inlineBackground = element.style.backgroundColor || element.style.background;
    if (isVisibleBackgroundColor(inlineBackground)) {
      return inlineBackground;
    }
    const computedBackground = window.getComputedStyle(element).backgroundColor;
    if (isVisibleBackgroundColor(computedBackground)) {
      return computedBackground;
    }
  }
  return null;
}

export function createImmersiveHost(
  htmlCode: string | null | undefined,
  cssCode: string | null | undefined,
  defaultHtml: string,
  size: ImmersiveRuntimeSize,
) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${size.width}px`;
  host.style.height = `${size.height}px`;
  host.style.overflow = "hidden";
  host.style.pointerEvents = "none";

  const style = document.createElement("style");
  style.textContent = `
    canvas {
      display: block;
      max-width: none;
      position: static !important;
      top: auto !important;
      left: auto !important;
      bottom: auto !important;
      right: auto !important;
      z-index: auto !important;
    }
  `;

  host.appendChild(style);
  const markup = document.createElement("div");
  markup.style.width = "100%";
  markup.style.height = "100%";
  markup.innerHTML = sanitizeArtPieceHtml(htmlCode, defaultHtml);
  host.appendChild(markup);
  document.body.appendChild(host);
  return host;
}

export function normalizeManagedCanvasStyles(
  canvas: HTMLCanvasElement,
  size: ImmersiveRuntimeSize,
) {
  canvas.style.position = "";
  canvas.style.top = "";
  canvas.style.left = "";
  canvas.style.bottom = "";
  canvas.style.right = "";
  canvas.style.zIndex = "";
  canvas.style.pointerEvents = "";
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
}

export function observeManagedCanvasContainment(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  size: ImmersiveRuntimeSize,
) {
  normalizeManagedCanvasStyles(canvas, size);

  function reassert() {
    if (canvas.parentElement !== host) {
      host.appendChild(canvas);
    }
    normalizeManagedCanvasStyles(canvas, size);
  }

  const styleObserver = new MutationObserver(() => {
    if (
      canvas.style.position
      || canvas.style.zIndex
      || canvas.style.top
      || canvas.style.left
      || canvas.style.right
      || canvas.style.bottom
    ) {
      reassert();
    }
  });
  styleObserver.observe(canvas, { attributes: true, attributeFilter: ["style"] });

  const bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node === canvas) {
          reassert();
          return;
        }
      }
    }
  });
  bodyObserver.observe(document.body, { childList: true });

  return {
    reassert,
    dispose() {
      styleObserver.disconnect();
      bodyObserver.disconnect();
    },
  };
}

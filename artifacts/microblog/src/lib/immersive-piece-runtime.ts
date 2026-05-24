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
    }
  `;

  host.appendChild(style);
  const markup = document.createElement("div");
  markup.style.width = "100%";
  markup.style.height = "100%";
  markup.innerHTML = htmlCode && htmlCode.trim() ? htmlCode : defaultHtml;
  host.appendChild(markup);
  document.body.appendChild(host);
  return host;
}

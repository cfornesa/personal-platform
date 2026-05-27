import { describe, expect, it } from "vitest";
import {
  createImmersiveHost,
  DEFAULT_IMMERSIVE_RUNTIME_SIZE,
  getCanvasMetrics,
  resolveImmersiveElementBackground,
  resolveSketchFactory,
} from "../immersive-piece-runtime";

describe("immersive-piece-runtime helpers", () => {
  it("resolves direct function expressions", () => {
    const factory = resolveSketchFactory(`(runtime) => runtime.width + runtime.height`);
    expect(factory({ width: 2, height: 3 })).toBe(5);
  });

  it("resolves window.sketch assignments", () => {
    const factory = resolveSketchFactory(`
      window.sketch = (runtime) => runtime.size.width;
    `);
    expect(factory({ size: { width: 640 } })).toBe(640);
  });

  it("falls back to the default immersive runtime size for missing canvases", () => {
    expect(getCanvasMetrics(null)).toEqual({
      width: DEFAULT_IMMERSIVE_RUNTIME_SIZE.width,
      height: DEFAULT_IMMERSIVE_RUNTIME_SIZE.height,
      aspect:
        DEFAULT_IMMERSIVE_RUNTIME_SIZE.width /
        DEFAULT_IMMERSIVE_RUNTIME_SIZE.height,
    });
  });

  it("uses actual canvas dimensions when available", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 400;
    expect(getCanvasMetrics(canvas)).toEqual({
      width: 800,
      height: 400,
      aspect: 2,
    });
  });

  it("sanitizes generated HTML before inserting it into the immersive document", () => {
    const host = createImmersiveHost(
      `
        <style>html, body { overflow: hidden; height: 100%; }</style>
        <script src="https://example.test/runtime.js"></script>
        <link rel="stylesheet" href="https://example.test/style.css">
        <canvas id="piece-canvas" style="position: fixed"></canvas>
      `,
      "html, body { overflow: hidden; }",
      '<canvas id="piece-canvas"></canvas>',
      DEFAULT_IMMERSIVE_RUNTIME_SIZE,
    );

    expect(host.querySelector("canvas#piece-canvas")).toBeTruthy();
    expect(host.querySelectorAll("style")).toHaveLength(2);
    expect(host.innerHTML).toContain("html, body { overflow: hidden; }");
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("link")).toBeNull();
    expect(host.querySelector("canvas")?.getAttribute("style")).toBeNull();

    host.remove();
  });

  it("resolves the first visible background from immersive elements", () => {
    const outer = document.createElement("div");
    outer.style.backgroundColor = "rgb(10, 20, 30)";
    const inner = document.createElement("div");
    outer.appendChild(inner);
    document.body.appendChild(outer);

    expect(resolveImmersiveElementBackground([inner, outer])).toBe("rgb(10, 20, 30)");

    outer.remove();
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMMERSIVE_RUNTIME_SIZE,
  getCanvasMetrics,
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
});

import { describe, expect, it, vi } from "vitest";
import {
  computeOrbitKeyboardMotion,
  computeThreeAutoFitView,
  computeMountedArtworkLayout,
  drawContainedIntoPresentationSurface,
  isCompactImmersiveViewport,
  NORMALIZED_PRESENTATION_GALLERY_PROFILE,
  syncThreeRendererBackground,
} from "../immersive-gallery";

describe("immersive-gallery layout", () => {
  it("bounds wide artwork to the mounted wall width", () => {
    expect(computeMountedArtworkLayout(2.5)).toEqual({
      aspect: 2.5,
      width: 6.4,
      height: 2.56,
    });
  });

  it("bounds tall artwork to the mounted wall height", () => {
    expect(computeMountedArtworkLayout(0.5)).toEqual({
      aspect: 0.5,
      width: 2.3,
      height: 4.6,
    });
  });

  it("clamps extremely narrow artwork to a safe minimum aspect", () => {
    expect(computeMountedArtworkLayout(0.1)).toEqual({
      aspect: 0.35,
      width: 1.6099999999999999,
      height: 4.6,
    });
  });

  it("uses a smaller canonical mount for normalized presentation media", () => {
    const layout = computeMountedArtworkLayout(4 / 3, NORMALIZED_PRESENTATION_GALLERY_PROFILE);
    expect(layout.aspect).toBe(4 / 3);
    expect(layout.width).toBeCloseTo(5.2);
    expect(layout.height).toBeCloseTo(3.9);
  });

  it("detects compact immersive viewports for mobile layout branching", () => {
    expect(isCompactImmersiveViewport(390)).toBe(true);
    expect(isCompactImmersiveViewport(1024)).toBe(false);
  });

  it("uses a front-on default fit for compact Three.js viewports", () => {
    const mobileView = computeThreeAutoFitView(
      { x: 0, y: 1, z: 0 },
      { x: 3, y: 4, z: 2 },
      0.6,
      45,
      true,
    );
    const desktopView = computeThreeAutoFitView(
      { x: 0, y: 1, z: 0 },
      { x: 3, y: 4, z: 2 },
      1.6,
      45,
      false,
    );

    expect(mobileView.camera.x).toBe(0);
    expect(desktopView.camera.x).toBe(0);
    expect(mobileView.target.x).toBe(0);
    expect(desktopView.target.x).toBe(0);
    expect(mobileView.camera.z).toBeGreaterThan(desktopView.camera.z);
    expect(desktopView.target.y).toBeGreaterThan(1);
    expect(desktopView.camera.y).toBeGreaterThan(desktopView.target.y);
  });

  it("moves forward/back along the full look vector while strafing horizontally", () => {
    expect(
      computeOrbitKeyboardMotion(
        { x: 0, y: -0.6, z: -0.8 },
        new Set(["ArrowUp"]),
        0.5,
      ),
    ).toEqual({
      dx: 0,
      dy: -0.3,
      dz: -0.4,
    });

    const strafe = computeOrbitKeyboardMotion(
      { x: 0, y: -0.6, z: -0.8 },
      new Set(["ArrowLeft"]),
      0.5,
    );
    expect(strafe.dx).toBeCloseTo(-0.5);
    expect(strafe.dy).toBeCloseTo(0);
    expect(strafe.dz).toBeCloseTo(0);
  });

  it("falls back to a safe horizontal strafe when looking straight up or down", () => {
    expect(
      computeOrbitKeyboardMotion(
        { x: 0, y: 1, z: 0 },
        new Set(["ArrowRight"]),
        0.4,
      ),
    ).toEqual({
      dx: 0.4,
      dy: 0,
      dz: 0,
    });
  });

  it("syncs the renderer clear color from the piece scene background", () => {
    const setClearColor = vi.fn();
    const setClearAlpha = vi.fn();

    syncThreeRendererBackground(
      { setClearColor, setClearAlpha },
      { background: "#6a3f22" },
      "#050b16",
    );

    expect(setClearColor).toHaveBeenCalledWith("#6a3f22", 1);
    expect(setClearAlpha).toHaveBeenCalledWith(1);
  });

  it("falls back to a supplied canvas background when the piece scene has no background", () => {
    const setClearColor = vi.fn();
    const setClearAlpha = vi.fn();

    syncThreeRendererBackground(
      { setClearColor, setClearAlpha },
      { background: null },
      "rgb(20, 30, 40)",
    );

    expect(setClearColor).toHaveBeenCalledWith("rgb(20, 30, 40)", 1);
    expect(setClearAlpha).toHaveBeenCalledWith(1);
  });

  it("centers contained media inside the presentation surface", () => {
    let drawRect:
      | { x: number; y: number; width: number; height: number }
      | null = null;
    const surface = {
      width: 1000,
      height: 600,
      padding: 50,
      context: {
        save() {},
        clearRect() {},
        fillRect() {},
        restore() {},
        fillStyle: "#fff",
      } as unknown as CanvasRenderingContext2D,
    };
    drawContainedIntoPresentationSurface(
      surface,
      1000,
      500,
      (_ctx, x, y, width, height) => {
        drawRect = { x, y, width, height };
      },
      "#fff",
    );

    expect(drawRect).toEqual({
      x: 50,
      y: 75,
      width: 900,
      height: 450,
    });
  });
});

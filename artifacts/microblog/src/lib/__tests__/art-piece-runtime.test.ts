import { describe, expect, it } from "vitest";
import { buildArtPieceSrcDoc, sanitizeArtPieceHtml } from "../art-piece-runtime";

describe("art-piece-runtime", () => {
  it("strips document-level tags from generated piece HTML", () => {
    const sanitized = sanitizeArtPieceHtml(
      `
        <style>html, body { overflow: hidden; }</style>
        <script src="https://example.test/runtime.js"></script>
        <link rel="stylesheet" href="https://example.test/style.css">
        <base href="https://example.test/">
        <div id="canvas-container" style="position: fixed"><canvas id="piece-canvas"></canvas></div>
      `,
      '<div id="canvas-container"></div>',
    );

    expect(sanitized).toContain('<div id="canvas-container"><canvas id="piece-canvas"></canvas></div>');
    expect(sanitized).not.toContain("<style");
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("<link");
    expect(sanitized).not.toContain("<base");
    expect(sanitized).not.toContain("position: fixed");
  });

  it("falls back to runtime-owned mount markup when generated HTML has no safe nodes", () => {
    expect(
      sanitizeArtPieceHtml(
        '<style>body { overflow: hidden; }</style><script>document.body.remove()</script>',
        '<canvas id="piece-canvas"></canvas>',
      ),
    ).toBe('<canvas id="piece-canvas"></canvas>');
  });

  it("adds canvas safety reassertion to p5 embed srcdoc", () => {
    const srcDoc = buildArtPieceSrcDoc(
      "p5",
      "window.sketch = (p) => { p.setup = () => p.createCanvas(10, 10); p.draw = () => {}; };",
      '<div id="canvas-container"></div>',
      "canvas { display: none !important; position: fixed !important; opacity: 0 !important; }",
    );

    expect(srcDoc).toContain("_reassertManagedCanvas");
    expect(srcDoc).toContain("canvas.style.setProperty('display', 'block', 'important')");
    expect(srcDoc).toContain("canvas.style.setProperty('position', 'static', 'important')");
    expect(srcDoc).toContain("canvas.style.setProperty('opacity', '1', 'important')");
    expect(srcDoc).toContain("_watchManagedCanvases(container)");
  });

  it("sizes the default Three.js mount container in embed srcdoc", () => {
    const srcDoc = buildArtPieceSrcDoc(
      "three",
      "window.sketch = () => {};",
      '<div id="container"></div>',
      null,
    );

    expect(srcDoc).toContain("#container, #canvas-container, #sketch-container");
  });

  it("adds managed fit and render passes to Three.js embed srcdoc", () => {
    const srcDoc = buildArtPieceSrcDoc(
      "three",
      `
        window.sketch = ({ THREE, canvas }) => {
          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
          const renderer = new THREE.WebGLRenderer({ canvas });
          renderer.setAnimationLoop(() => renderer.render(scene, camera));
        };
      `,
      '<div id="container"></div>',
      null,
    );

    expect(srcDoc).toContain("function forceManagedRender()");
    expect(srcDoc).toContain("function scheduleAutoFit()");
    expect(srcDoc).toContain("function startManagedRenderLoop()");
    expect(srcDoc).toContain("function getManagedCanvas()");
    expect(srcDoc).toContain("function normalizeThreeCanvases()");
    expect(srcDoc).toContain("function getViewerCamera(aspect)");
    expect(srcDoc).toContain("function prepareRendererForViewerRender()");
    expect(srcDoc).toContain("function prepareSceneForViewerRender()");
    expect(srcDoc).toContain("function getManagedBackgroundFallback()");
    expect(srcDoc).toContain("function _syncManagedBackdrop(color)");
    expect(srcDoc).toContain("const renderCam = (state.camera.position.length() > 0.5)");
    expect(srcDoc).toContain("state.renderer.render(state.scene, renderCam)");
    expect(srcDoc).toContain("const previewBackground = state.scene?.background || 0x000000");
    expect(srcDoc).toContain("state.renderer.setScissorTest?.(false)");
    expect(srcDoc).toContain("if (state.camera && 'aspect' in state.camera) {");
    expect(srcDoc).toContain("state.camera.aspect = width / Math.max(height, 1);");
    expect(srcDoc).toContain("state.camera.updateProjectionMatrix?.();");
    expect(srcDoc).toContain("state.viewerCamera.layers.enableAll?.()");
    expect(srcDoc).toContain("this.setAnimationLoop = function(callback)");
    expect(srcDoc).toContain("window.THREE = instrumentedThree");
    expect(srcDoc).toContain("instrumentedThree.OrthographicCamera");
    expect(srcDoc).toContain("forceManagedRender();");
    expect(srcDoc).toContain("startManagedRenderLoop();");
  });

  it("forces all Three.js renderers to the managed canvas and hides extra canvases", () => {
    const srcDoc = buildArtPieceSrcDoc(
      "three",
      `
        window.sketch = ({ THREE, startFrame }) => {
          const scene = new window.THREE.Scene();
          const camera = new window.THREE.PerspectiveCamera(50, 1, 0.1, 100);
          const stray = document.createElement("canvas");
          document.body.appendChild(stray);
          const renderer = new window.THREE.WebGLRenderer({ canvas: stray });
          startFrame(() => renderer.render(scene, camera));
        };
      `,
      '<div id="container"><canvas id="model-canvas"></canvas></div>',
      "canvas { display: none !important; position: fixed !important; }",
    );

    expect(srcDoc).toContain("super({ ...(params || {}), canvas: managedCanvas })");
    expect(srcDoc).not.toContain("_rendererCreated");
    expect(srcDoc).toContain("candidate.style.setProperty('display', 'none', 'important')");
    expect(srcDoc).toContain('data-art-piece-managed-canvas');
    expect(srcDoc).toContain("canvas[data-art-piece-managed-canvas=\"true\"]");
  });

  it("can include Three.js diagnostics for draft and admin previews only when requested", () => {
    const normalSrcDoc = buildArtPieceSrcDoc("three", "window.sketch = () => {};", null, null);
    const diagnosticSrcDoc = buildArtPieceSrcDoc(
      "three",
      "window.sketch = () => {};",
      null,
      null,
      { diagnostics: true },
    );

    expect(normalSrcDoc).toContain("if (!false) {");
    expect(diagnosticSrcDoc).toContain("Three diagnostics:");
    expect(diagnosticSrcDoc).toContain("if (!true) {");
    expect(diagnosticSrcDoc).toContain("managedRendererCanvas=");
    expect(diagnosticSrcDoc).toContain("viewerCamera=");
    expect(diagnosticSrcDoc).toContain("fitCount=");
  });

  it("mounts Three.js canvas inside any first-child div even when its id is not a known runtime id", () => {
    const srcDoc = buildArtPieceSrcDoc(
      "three",
      "window.sketch = () => {};",
      '<div id="book-container"></div>',
      null,
    );

    expect(srcDoc).toContain("function getThreeMount()");
    expect(srcDoc).toContain("document.body.querySelector(':scope > div')");
  });

  it("computes scene bounds from renderable meshes only, skipping helpers and lights", () => {
    const srcDoc = buildArtPieceSrcDoc("three", "window.sketch = () => {};", null, null);

    expect(srcDoc).toContain("function getRenderableBounds()");
    expect(srcDoc).toContain("if (obj.isHelper || obj.isLight || obj.isCamera) return;");
    expect(srcDoc).toContain("box.union(obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld))");
  });

  it("uses renderable bounds in autoFit with fallback to full scene bounds", () => {
    const srcDoc = buildArtPieceSrcDoc("three", "window.sketch = () => {};", null, null);

    expect(srcDoc).toContain("let box = getRenderableBounds()");
    expect(srcDoc).toContain("box = new THREE.Box3().setFromObject(state.scene)");
  });

  it("adds fallback lighting when the scene has no lights", () => {
    const srcDoc = buildArtPieceSrcDoc("three", "window.sketch = () => {};", null, null);

    expect(srcDoc).toContain("function ensureFallbackLighting()");
    expect(srcDoc).toContain("__viewer_fallback_ambient__");
    expect(srcDoc).toContain("__viewer_fallback_dir__");
    expect(srcDoc).toContain("ensureFallbackLighting()");
  });

  it("rescues near-transparent materials by forcing opacity to 1 in prepareSceneForViewerRender", () => {
    const srcDoc = buildArtPieceSrcDoc("three", "window.sketch = () => {};", null, null);

    expect(srcDoc).toContain("material.opacity < 0.05");
    expect(srcDoc).toContain("material.opacity = 1");
    expect(srcDoc).toContain("material.transparent = false");
  });

  it("reports scene bounds, camera position, light count, and invisible material count in diagnostics", () => {
    const srcDoc = buildArtPieceSrcDoc(
      "three",
      "window.sketch = () => {};",
      null,
      null,
      { diagnostics: true },
    );

    expect(srcDoc).toContain("boundsEmpty=");
    expect(srcDoc).toContain("boundsSize=");
    expect(srcDoc).toContain("camPos=");
    expect(srcDoc).toContain("lights=");
    expect(srcDoc).toContain("invisMats=");
  });
});

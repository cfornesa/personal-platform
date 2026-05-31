import { describe, expect, it } from "vitest";
import { pieceEmbedHtml } from "./piece-embed-html";

const ORIGIN = "https://example.com";

describe("pieceEmbedHtml", () => {
  describe("Three.js engine", () => {
    it("embeds Three.js code inline without SPA redirect", () => {
      const html = pieceEmbedHtml("My Piece", "three", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain("import * as THREE from");
      expect(html).toContain(`${ORIGIN}/api/runtimes/three/three.module.min.js`);
      expect(html).not.toContain("/immersive/pieces/");
      expect(html).not.toContain("<iframe");
    });

    it("imports OrbitControls from the three-examples runtime path", () => {
      const html = pieceEmbedHtml("Piece", "three", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain(`import { OrbitControls } from '${ORIGIN}/api/runtimes/three-examples/jsm/controls/OrbitControls.js'`);
    });

    it("does not use IntersectionObserver", () => {
      const html = pieceEmbedHtml("Piece", "three", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).not.toContain("IntersectionObserver");
    });

    it("registers visibilitychange for WebGL teardown", () => {
      const html = pieceEmbedHtml("Piece", "three", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain("visibilitychange");
      expect(html).toContain("renderer?.dispose");
    });

    it("uses #container as default mount element", () => {
      const html = pieceEmbedHtml("Piece", "three", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain('id="container"');
      expect(html).not.toContain('id="canvas-container"');
    });

    it("uses custom htmlCode when provided", () => {
      const html = pieceEmbedHtml("Piece", "three", "window.sketch = function() {}", '<div id="my-mount"></div>', null, ORIGIN);
      expect(html).toContain('id="my-mount"');
      expect(html).not.toContain('id="container"');
    });

    it("uses module script tag", () => {
      const html = pieceEmbedHtml("Piece", "three", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain('<script type="module">');
    });

    it("includes the importmap for bare three specifier resolution", () => {
      const html = pieceEmbedHtml("Piece", "three", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain(`"three":"${ORIGIN}/api/runtimes/three/three.module.min.js"`);
    });
  });

  describe("P5 engine", () => {
    it("creates a p5 instance immediately without IntersectionObserver", () => {
      const html = pieceEmbedHtml("Piece", "p5", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain("new p5(");
      expect(html).not.toContain("IntersectionObserver");
    });

    it("registers visibilitychange to remove p5 instance", () => {
      const html = pieceEmbedHtml("Piece", "p5", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain("visibilitychange");
      expect(html).toContain("p5Instance?.remove()");
    });

    it("uses #canvas-container as default mount element", () => {
      const html = pieceEmbedHtml("Piece", "p5", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain('id="canvas-container"');
    });

    it("loads p5 library from runtime path", () => {
      const html = pieceEmbedHtml("Piece", "p5", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain(`${ORIGIN}/api/runtimes/p5/p5.min.js`);
    });

    it("uses text/javascript script tag", () => {
      const html = pieceEmbedHtml("Piece", "p5", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain('<script type="text/javascript">');
    });
  });

  describe("C2 engine", () => {
    it("calls sketchFactory immediately without IntersectionObserver", () => {
      const html = pieceEmbedHtml("Piece", "c2", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain("sketchFactory(");
      expect(html).not.toContain("IntersectionObserver");
    });

    it("registers visibilitychange to stop the animation frame", () => {
      const html = pieceEmbedHtml("Piece", "c2", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain("visibilitychange");
      expect(html).toContain("stopFrame()");
    });

    it("uses #canvas-container as default mount element", () => {
      const html = pieceEmbedHtml("Piece", "c2", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain('id="canvas-container"');
    });

    it("loads c2 library from runtime path", () => {
      const html = pieceEmbedHtml("Piece", "c2", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).toContain(`${ORIGIN}/api/runtimes/c2/c2.min.js`);
    });
  });

  describe("shared behaviour", () => {
    it("escapes HTML in the title", () => {
      const html = pieceEmbedHtml('<script>alert(1)</script>', "p5", "window.sketch = function() {}", null, null, ORIGIN);
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain("&lt;script&gt;");
    });

    it("injects custom CSS", () => {
      const html = pieceEmbedHtml("Piece", "p5", "window.sketch = function() {}", null, "body { background: red; }", ORIGIN);
      expect(html).toContain("background: red;");
    });

    it("includes error overlay script for all engines", () => {
      for (const engine of ["three", "p5", "c2"]) {
        const html = pieceEmbedHtml("Piece", engine, "window.sketch = function() {}", null, null, ORIGIN);
        expect(html).toContain("sketch-status");
      }
    });
  });
});

import React, { useEffect, useRef } from "react";
import type { ArtPieceEngine } from "@workspace/api-client-react";

type ArtPieceRendererProps = {
  engine: ArtPieceEngine;
  code: string;
  htmlCode?: string | null;
  cssCode?: string | null;
  className?: string;
  height?: number;
  title?: string;
  onStatusChange?: (status: { valid: boolean; error: string | null; warning?: string | null }) => void;
};

export function ArtPieceRenderer({
  engine,
  code,
  htmlCode,
  cssCode,
  className,
  height = 420,
  title,
  onStatusChange,
}: ArtPieceRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "sketch-status") {
        onStatusChange?.({
          valid: event.data.valid,
          error: event.data.error ?? null,
          warning: event.data.warning ?? null,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onStatusChange]);

  const srcDoc = buildArtPieceSrcDoc(engine, code, htmlCode, cssCode);

  return (
    <div className={className}>
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        title={title}
        className="w-full rounded-xl border border-border bg-black/5"
        style={{ minHeight: height }}
        sandbox="allow-scripts allow-same-origin"
        frameBorder="0"
      />
    </div>
  );
}

function buildArtPieceSrcDoc(
  engine: ArtPieceEngine,
  code: string,
  htmlCode?: string | null,
  cssCode?: string | null
): string {
  const safeCss = cssCode || "";
  const safeHtml = htmlCode || "";
  const safeCode = JSON.stringify(code);

  const errorOverlayScript = `
    window.addEventListener('error', function(e) {
      document.body.innerHTML = '<div style="font-family:sans-serif;color:#c00;padding:2rem;background:#fff;height:100vh"><h3>Sketch error</h3><p>' + e.message + '</p></div>';
      window.parent.postMessage({ type: 'sketch-status', valid: false, error: e.message }, '*');
    });
  `;

  const libraryScripts: Record<string, string> = {
    p5: '<script src="/api/runtimes/p5/p5.min.js"></script>',
    three: '<script type="importmap">{"imports":{"three":"/api/runtimes/three/three.module.min.js"}}</script>',
    c2: '<script src="/api/runtimes/c2/c2.min.js"></script>',
  };

  const engineInit =
    engine === "three"
      ? `
      import * as THREE from '/api/runtimes/three/three.module.min.js';
      window.THREE = THREE;
      
      const state = { scene: null, camera: null, objects: [] };

      function autoFit() {
        if (!state.scene || !state.camera) return;
        state.objects.forEach(obj => {
          if (obj.geometry && !obj.geometry.boundingBox) {
            try { obj.geometry.computeBoundingBox(); } catch(e) {}
          }
        });
        const box = new THREE.Box3().setFromObject(state.scene);
        if (box.isEmpty()) return;
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const fov = state.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.2;
        if (state.camera.aspect < 1) cameraZ /= state.camera.aspect;
        state.camera.position.set(center.x + cameraZ, center.y + cameraZ * 0.4, center.z + cameraZ);
        state.camera.lookAt(center);
        state.camera.updateMatrixWorld(true);
      }

      function startFrame(handler) {
        let frameCount = 0;
        function tick() {
          frameCount++;
          handler(frameCount);
          if (frameCount === 15) autoFit();
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }

      try {
        const codeContent = ${safeCode};
        let sketchFactory;
        try {
          sketchFactory = new Function('return (' + codeContent + ')')();
        } catch(e) {
          new Function(codeContent)();
          sketchFactory = window.sketch;
        }
if (typeof sketchFactory === 'function') {
          let canvas = document.querySelector('canvas');
          if (!canvas) {
            canvas = document.createElement('canvas');
            const container = document.getElementById('container') || document.getElementById('canvas-container') || document.getElementById('sketch-container') || document.body;
            container.appendChild(canvas);
          }
          canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block';
  // Instrumentation for autoFit: Create a local instrumented version of THREE
  // since the module object itself is read-only.
  const instrumentedThree = { ...THREE };
  const originalScene = THREE.Scene;
  instrumentedThree.Scene = class extends originalScene { 
    constructor() { super(); state.scene = this; } 
    add(...objs) {
      objs.forEach(obj => { if (obj.geometry) state.objects.push(obj); });
      return super.add(...objs);
    }
  };
  const originalCamera = THREE.PerspectiveCamera;
  instrumentedThree.PerspectiveCamera = class extends originalCamera { constructor(...args) { super(...args); state.camera = this; } };

  sketchFactory({ THREE: instrumentedThree, canvas, startFrame });
  window.parent.postMessage({ type: 'sketch-status', valid: true }, '*');
} else {
          throw new Error('Sketch factory not found. Ensure your JS assigns a function to window.sketch.');
        }
      } catch(err) {
        window.dispatchEvent(new ErrorEvent('error', { message: err.message }));
      }
    `
    : engine === "c2"
    ? `
      function startFrame(handler) {
        let frameCount = 0;
        function tick() {
          frameCount++;
          handler(frameCount);
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }

      try {
        const codeContent = ${safeCode};
        let sketchFactory;
        try {
          sketchFactory = new Function('return (' + codeContent + ')')();
        } catch(e) {
          new Function(codeContent)();
          sketchFactory = window.sketch;
        }

        if (typeof sketchFactory === 'function') {
          const canvas = document.querySelector('canvas') || document.createElement('canvas');
          if (!canvas.parentNode) document.body.appendChild(canvas);
          sketchFactory({ c2: window.c2, canvas, startFrame });
          window.parent.postMessage({ type: 'sketch-status', valid: true }, '*');
        } else {
          throw new Error('Sketch factory not found. Ensure your JS assigns a function to window.sketch.');
        }
      } catch(err) {
        window.dispatchEvent(new ErrorEvent('error', { message: err.message }));
      }
    `
    : `
      try {
        const codeContent = ${safeCode};
        let sketchFactory;
        try {
          sketchFactory = new Function('return (' + codeContent + ')')();
        } catch(e) {
          new Function(codeContent)();
          sketchFactory = window.sketch;
        }

        if (typeof sketchFactory === 'function') {
          const container = document.getElementById('canvas-container') || document.getElementById('sketch-container') || document.body;
          new p5(sketchFactory, container);
          window.parent.postMessage({ type: 'sketch-status', valid: true }, '*');
        } else {
          throw new Error('Sketch factory not found. Ensure your JS assigns a function to window.sketch.');
        }
      } catch(err) {
        window.dispatchEvent(new ErrorEvent('error', { message: err.message }));
      }
    `;

  const bodyContent =
    htmlCode !== null && htmlCode !== undefined
      ? `
      ${safeHtml}
      <script type="${engine === "three" ? "module" : "text/javascript"}">
        ${engineInit}
      </script>
    `
      : `
      <div id="canvas-container"></div>
      <script type="${engine === "three" ? "module" : "text/javascript"}">
        ${engineInit}
      </script>
    `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; }
    canvas { display: block; }
    ${safeCss}
  </style>
  <script>${errorOverlayScript}</script>
  ${libraryScripts[engine] || ""}
</head>
<body>
${bodyContent}
</body>
</html>`;
}

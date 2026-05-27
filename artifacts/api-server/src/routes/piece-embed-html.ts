import { Router, type Request, type Response } from "express";
import { artPiecesTable, artPieceVersionsTable, db, eq } from "@workspace/db";
import { z } from "zod";
import { buildStaticImmersiveThreeEmbedHtml } from "./piece-embed-html.helpers";
import { getCanonicalOrigin } from "../lib/origin";

const router = Router();

const PieceIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

const PieceEmbedQuery = z.object({
  version: z.coerce.number().int().positive().optional(),
});

router.get("/embed/pieces/:id", async (req: Request, res: Response) => {
  const params = PieceIdParams.safeParse(req.params);
  const query = PieceEmbedQuery.safeParse(req.query);
  if (!params.success || !query.success) {
    return res.status(404).send(notFoundHtml());
  }

  try {
    const pieceRows = await db
      .select()
      .from(artPiecesTable)
      .where(eq(artPiecesTable.id, params.data.id))
      .limit(1);
    const piece = pieceRows[0] ?? null;
    if (!piece) {
      return res.status(404).send(notFoundHtml());
    }

    const versionId = query.data.version ?? piece.currentVersionId;
    if (!versionId) {
      return res.status(404).send(notFoundHtml());
    }

    const versionRows = await db
      .select()
      .from(artPieceVersionsTable)
      .where(eq(artPieceVersionsTable.id, versionId))
      .limit(1);
    const version = versionRows[0] ?? null;
    if (!version || version.artPieceId !== piece.id) {
      return res.status(404).send(notFoundHtml());
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const origin = getCanonicalOrigin(req);
    if (version.engine === "three") {
      return res.send(buildStaticImmersiveThreeEmbedHtml(piece.title, piece.id, version.id, origin));
    }
    return res.send(pieceEmbedHtml(piece.title, version.engine, version.generatedCode, version.htmlCode, version.cssCode, origin));
  } catch (err) {
    console.error("Failed to serve piece embed:", err);
    return res.status(500).send(notFoundHtml());
  }
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function pieceEmbedHtml(title: string, engine: string, code: string, htmlCode: string | null | undefined, cssCode: string | null | undefined, origin: string): string {
  const safeTitle = escapeHtml(title);
  const safeCss = cssCode || "";
  const safeHtml = htmlCode || "";
  const safeCode = JSON.stringify(code);

  const errorOverlayScript = `
    window.addEventListener('error', function(e) {
      document.body.innerHTML = '<div style="font-family:sans-serif;color:#c00;padding:2rem;background:#fff;height:100vh"><h3>Sketch error</h3><p>' + e.message + '</p></div>';
      window.parent.postMessage({ type: 'sketch-status', valid: false, error: e.message }, '*');
    });
  `;

  // Standard library paths based on express.static mounts in app.ts
  const libraryScripts: Record<string, string> = {
    p5: `<script src="${origin}/api/runtimes/p5/p5.min.js"></script>`,
    three: `<script type="importmap">{"imports":{"three":"${origin}/api/runtimes/three/three.module.min.js"}}</script>`,
    c2: `<script src="${origin}/api/runtimes/c2/c2.min.js"></script>`,
  };

  let engineInit = "";

  if (engine === "three") {
    engineInit = `
      import * as THREE from '${origin}/api/runtimes/three/three.module.min.js';
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
    `;
  } else if (engine === "c2") {
    engineInit = `
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
    `;
  } else {
    engineInit = `
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
  }

  const scriptTag = engine === "three" 
    ? `<script type="module">${engineInit}</script>`
    : `<script type="text/javascript">${engineInit}</script>`;

  const bodyContent = htmlCode !== null && htmlCode !== undefined
    ? `${safeHtml}\n${scriptTag}`
    : `<div id="canvas-container"></div>\n${scriptTag}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
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

function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Not found</title>
  <style>html,body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;color:#666;background:#fafafa}</style>
</head>
<body>
<p>Interactive piece not found.</p>
</body>
</html>`;
}

export default router;

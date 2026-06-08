import { Router, type Request, type Response } from "express";
import { artPiecesTable, artPieceVersionsTable, db, eq } from "@workspace/db";
import { z } from "zod";
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
    return res.send(pieceEmbedHtml(piece.title, version.engine, version.generatedCode, version.htmlCode, version.cssCode, origin));
  } catch (err) {
    console.error("Failed to serve piece embed:", err);
    return res.status(500).send(notFoundHtml());
  }
});

router.get("/embed/pieces/:id/data", async (req: Request, res: Response) => {
  const params = PieceIdParams.safeParse(req.params);
  const query = PieceEmbedQuery.safeParse(req.query);
  if (!params.success || !query.success) {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const pieceRows = await db
      .select()
      .from(artPiecesTable)
      .where(eq(artPiecesTable.id, params.data.id))
      .limit(1);
    const piece = pieceRows[0] ?? null;
    if (!piece) {
      return res.status(404).json({ error: "Not found" });
    }

    const versionId = query.data.version ?? piece.currentVersionId;
    if (!versionId) {
      return res.status(404).json({ error: "Not found" });
    }

    const versionRows = await db
      .select()
      .from(artPieceVersionsTable)
      .where(eq(artPieceVersionsTable.id, versionId))
      .limit(1);
    const version = versionRows[0] ?? null;
    if (!version || version.artPieceId !== piece.id) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({
      id: piece.id,
      title: piece.title,
      engine: version.engine,
      generatedCode: version.generatedCode,
      htmlCode: version.htmlCode,
      cssCode: version.cssCode,
    });
  } catch (err) {
    console.error("Failed to fetch piece embed data:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function pieceEmbedHtml(title: string, engine: string, code: string, htmlCode: string | null | undefined, cssCode: string | null | undefined, origin: string): string {
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
    // All imports are explicit URLs so the importmap in libraryScripts.three handles
    // bare-specifier resolution for OrbitControls' own `import { ... } from 'three'`.
    engineInit = `
      import * as THREE from '${origin}/api/runtimes/three/three.module.min.js';
      import { OrbitControls } from '${origin}/api/runtimes/three-examples/jsm/controls/OrbitControls.js';
      window.THREE = THREE;

      const state = { scene: null, camera: null, renderer: null, objects: [] };
      let controls = null;
      let rafIds = [];

      function getMount() {
        return document.getElementById('container')
          || document.getElementById('canvas-container')
          || document.getElementById('sketch-container')
          || document.body.querySelector(':scope > div')
          || document.body;
      }

      function getManagedCanvas() {
        const mount = getMount();
        let canvas = mount.querySelector('canvas');
        if (!canvas) {
          canvas = document.createElement('canvas');
          mount.appendChild(canvas);
        }
        canvas.style.cssText = 'display:block;width:100%;height:100%;';
        const cw = mount.clientWidth  || window.innerWidth  || 1280;
        const ch = mount.clientHeight || window.innerHeight || 720;
        if (cw > 0) canvas.width  = cw;
        if (ch > 0) canvas.height = ch;
        return canvas;
      }

      function reassertCanvas(canvas) {
        if (!canvas) return;
        canvas.style.setProperty('display',     'block',  'important');
        canvas.style.setProperty('visibility',  'visible','important');
        canvas.style.setProperty('opacity',     '1',      'important');
        canvas.style.setProperty('position',    'static', 'important');
        canvas.style.setProperty('inset',       'auto',   'important');
        canvas.style.setProperty('z-index',     'auto',   'important');
        canvas.style.setProperty('width',       '100%',   'important');
        canvas.style.setProperty('height',      '100%',   'important');
        if (!canvas.width)  canvas.width  = canvas.parentElement?.clientWidth  || window.innerWidth  || 1280;
        if (!canvas.height) canvas.height = canvas.parentElement?.clientHeight || window.innerHeight || 720;
      }

      function normalizeThreeCanvases() {
        const mount = getMount();
        const managed = getManagedCanvas();
        if (managed.parentElement !== mount) mount.appendChild(managed);
        reassertCanvas(managed);
        document.querySelectorAll('canvas').forEach(function(c) {
          if (c !== managed) {
            c.style.setProperty('display', 'none', 'important');
            c.setAttribute('aria-hidden', 'true');
          }
        });
        return managed;
      }

      function autoFit() {
        if (!state.scene || !state.camera) return;
        const box = new THREE.Box3();
        state.scene.traverse(function(obj) {
          if (obj.isHelper || obj.isLight || obj.isCamera) return;
          if ((obj.isMesh || obj.isLine || obj.isPoints) && obj.geometry) {
            obj.geometry.computeBoundingBox?.();
            if (obj.geometry.boundingBox)
              box.union(obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld));
          }
        });
        if (box.isEmpty()) return;
        const center = new THREE.Vector3(); box.getCenter(center);
        const size = new THREE.Vector3();   box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const fov = state.camera.fov * (Math.PI / 180);
        const dist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.2;
        state.camera.position.set(center.x + dist, center.y + dist * 0.4, center.z + dist);
        state.camera.lookAt(center);
        state.camera.updateMatrixWorld(true);
        if (controls) { controls.target.copy(center); controls.update(); }
      }

      function startFrame(handler) {
        let frameCount = 0;
        function tick() {
          frameCount++;
          handler(frameCount);
          if (frameCount === 15) autoFit();
          const id = requestAnimationFrame(tick);
          rafIds.push(id);
        }
        const id = requestAnimationFrame(tick);
        rafIds.push(id);
        return function() { rafIds.forEach(cancelAnimationFrame); rafIds = []; };
      }

      const instrumentedThree = { ...THREE };
      const OriginalScene = THREE.Scene;
      instrumentedThree.Scene = class extends OriginalScene {
        constructor() { super(); state.scene = this; }
        add(...objs) {
          objs.forEach(function(o) { if (o.geometry) state.objects.push(o); });
          return super.add(...objs);
        }
      };
      const OriginalPerspectiveCamera = THREE.PerspectiveCamera;
      instrumentedThree.PerspectiveCamera = class extends OriginalPerspectiveCamera {
        constructor(...args) { super(...args); state.camera = this; }
      };
      if ('OrthographicCamera' in THREE) {
        const OriginalOrthographicCamera = THREE.OrthographicCamera;
        instrumentedThree.OrthographicCamera = class extends OriginalOrthographicCamera {
          constructor(...args) { super(...args); state.camera = this; }
        };
      }
      const OriginalWebGLRenderer = THREE.WebGLRenderer;
      instrumentedThree.WebGLRenderer = class extends OriginalWebGLRenderer {
        constructor(params) {
          super({ ...(params || {}), canvas: getManagedCanvas() });
          state.renderer = this;

          // Prevent renderer.setSize() from writing pixel values into CSS.
          const _origSetSize = this.setSize.bind(this);
          this.setSize = function(w, h, _updateStyle) {
            return _origSetSize(w, h, false);
          };

          // Track scene/camera on every render call and keep canvas contained.
          const _origRender = this.render.bind(this);
          this.render = function(sc, cam) {
            if (sc)  state.scene  = sc;
            if (cam) state.camera = cam;
            normalizeThreeCanvases();
            return _origRender(sc, cam);
          };

          // Wrap setAnimationLoop so canvas is normalized inside each frame.
          if (typeof this.setAnimationLoop === 'function') {
            const _origLoop = this.setAnimationLoop.bind(this);
            this.setAnimationLoop = function(callback) {
              return _origLoop(callback ? function(time, frame) {
                normalizeThreeCanvases();
                return callback(time, frame);
              } : callback);
            };
          }
        }
      };
      window.THREE = instrumentedThree;

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
          const canvas = getManagedCanvas();
          sketchFactory({ THREE: instrumentedThree, canvas, startFrame });
          normalizeThreeCanvases();

          if (state.camera && canvas) {
            controls = new OrbitControls(state.camera, canvas);
            controls.enableDamping = true;
            controls.enablePan = true;

            // Seed orbit target from camera look direction so first frame is
            // never blank even when autoFit finds an empty scene.
            const _camDir = new THREE.Vector3();
            state.camera.getWorldDirection(_camDir);
            const _camLen = state.camera.position.length();
            controls.target
              .copy(state.camera.position)
              .addScaledVector(_camDir, Math.max(_camLen * 0.8, 3));

            // autoFit runs with controls defined so it can override target
            // with the actual scene centre when geometry is present.
            autoFit();
            controls.update();

            function animateControls() {
              const id = requestAnimationFrame(animateControls);
              rafIds.push(id);
              controls.update();
              if (state.renderer && state.scene && state.camera)
                state.renderer.render(state.scene, state.camera);
            }
            animateControls();
          }

          window.parent.postMessage({ type: 'sketch-status', valid: true }, '*');
        } else {
          throw new Error('Sketch factory not found. Ensure your JS assigns a function to window.sketch.');
        }
      } catch(err) {
        window.dispatchEvent(new ErrorEvent('error', { message: err.message }));
      }

      // Release GPU resources when PostContent destroys this iframe.
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) return;
        rafIds.forEach(cancelAnimationFrame);
        rafIds = [];
        controls?.dispose();
        state.renderer?.dispose?.();
      });
    `;
  } else if (engine === "c2") {
    engineInit = `
      let rafId = 0;
      let stopFrame = function() { cancelAnimationFrame(rafId); };

      function startFrame(handler) {
        let frameCount = 0;
        function tick() {
          frameCount++;
          handler(frameCount);
          rafId = requestAnimationFrame(tick);
        }
        rafId = requestAnimationFrame(tick);
        return stopFrame;
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
          const container = document.getElementById('canvas-container') || document.getElementById('sketch-container') || document.body;
          let canvas = container.querySelector('canvas');
          if (!canvas) {
            canvas = document.createElement('canvas');
            container.appendChild(canvas);
          }
          canvas.style.display = 'block';
          const _cw = container.clientWidth  || window.innerWidth  || 1280;
          const _ch = container.clientHeight || window.innerHeight || 720;
          if (_cw > 0) canvas.width  = _cw;
          if (_ch > 0) canvas.height = _ch;
          sketchFactory({ c2: window.c2, canvas, startFrame });
          window.parent.postMessage({ type: 'sketch-status', valid: true }, '*');
        } else {
          throw new Error('Sketch factory not found. Ensure your JS assigns a function to window.sketch.');
        }
      } catch(err) {
        window.dispatchEvent(new ErrorEvent('error', { message: err.message }));
      }

      document.addEventListener('visibilitychange', function() {
        if (document.hidden) stopFrame();
      });
    `;
  } else if (engine === "svg") {
    // SVG animates natively — no runtime library needed; JS is optional (CSS @keyframes handles most motion)
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
        // Provide svgRoot + intercept common container IDs so AI-generated code using Three.js/P5 patterns doesn't crash
        const _svgEl = document.querySelector('svg');
        if (_svgEl) {
          window.svgRoot = _svgEl;
          const _origGetById = document.getElementById.bind(document);
          document.getElementById = function(id) {
            if (!_origGetById(id) && (id === 'container' || id === 'canvas-container' || id === 'sketch-container')) {
              return _svgEl;
            }
            return _origGetById(id);
          };
        }
        if (typeof sketchFactory === 'function') {
          sketchFactory();
        }
        window.parent.postMessage({ type: 'sketch-status', valid: true }, '*');
      } catch(err) {
        window.dispatchEvent(new ErrorEvent('error', { message: err.message }));
      }
    `;
  } else {
    // p5 and any future engines
    engineInit = `
      let p5Instance = null;

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
          function init() {
            if (window.innerHeight > 0) {
              p5Instance = new p5(sketchFactory, container);
              window.parent.postMessage({ type: 'sketch-status', valid: true }, '*');
            } else {
              setTimeout(init, 16);
            }
          }
          init();
        } else {
          throw new Error('Sketch factory not found. Ensure your JS assigns a function to window.sketch.');
        }
      } catch(err) {
        window.dispatchEvent(new ErrorEvent('error', { message: err.message }));
      }

      document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
          try { p5Instance?.remove(); } catch(e) {}
          p5Instance = null;
        }
      });
    `;
  }

  const scriptTag = engine === "three"
    ? `<script type="module">${engineInit}</script>`
    : `<script type="text/javascript">${engineInit}</script>`;

  const defaultContainerId = engine === "three" ? "container" : "canvas-container";
  const svgFallback = '<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"></svg>';
  const bodyContent = htmlCode !== null && htmlCode !== undefined
    ? `${safeHtml}\n${scriptTag}`
    : engine === "svg"
      ? `${svgFallback}\n${scriptTag}`
      : `<div id="${defaultContainerId}"></div>\n${scriptTag}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; ${engine === "svg" ? "background: #0a0a14;" : ""} }
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

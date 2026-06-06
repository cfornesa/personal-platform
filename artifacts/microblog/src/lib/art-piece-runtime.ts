import type { ArtPieceEngine } from "@workspace/api-client-react";

const SAFE_HTML_TAGS = new Set(["DIV", "CANVAS"]);
const SAFE_HTML_ATTRIBUTES = new Set(["id", "class", "role", "aria-label"]);

function isSafeDataAttribute(name: string) {
  return name.startsWith("data-");
}

function cloneSafePieceNode(node: Node): Node | null {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  if (!SAFE_HTML_TAGS.has(element.tagName)) {
    const fragment = document.createDocumentFragment();
    element.childNodes.forEach((child) => {
      const clonedChild = cloneSafePieceNode(child);
      if (clonedChild) {
        fragment.appendChild(clonedChild);
      }
    });
    return fragment.childNodes.length > 0 ? fragment : null;
  }

  const cloned = document.createElement(element.tagName.toLowerCase());
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    if (SAFE_HTML_ATTRIBUTES.has(name) || isSafeDataAttribute(name)) {
      cloned.setAttribute(name, attr.value);
      continue;
    }
    if (element.tagName === "CANVAS" && (name === "width" || name === "height") && /^\d{1,5}$/.test(attr.value)) {
      cloned.setAttribute(name, attr.value);
    }
  }
  element.childNodes.forEach((child) => {
    const clonedChild = cloneSafePieceNode(child);
    if (clonedChild) {
      cloned.appendChild(clonedChild);
    }
  });
  return cloned;
}

export function sanitizeArtPieceHtml(htmlCode: string | null | undefined, fallbackHtml: string): string {
  const source = htmlCode?.trim() ? htmlCode : fallbackHtml;
  const template = document.createElement("template");
  template.innerHTML = source;
  const fragment = document.createDocumentFragment();

  template.content.childNodes.forEach((child) => {
    const clonedChild = cloneSafePieceNode(child);
    if (clonedChild) {
      fragment.appendChild(clonedChild);
    }
  });

  if (fragment.childNodes.length === 0) {
    return fallbackHtml;
  }

  const container = document.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}

function defaultHtmlForEngine(engine: ArtPieceEngine) {
  if (engine === "c2") {
    return '<canvas id="piece-canvas"></canvas>';
  }
  if (engine === "three") {
    return '<div id="container"></div>';
  }
  if (engine === "svg") {
    return '<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"></svg>';
  }
  return '<div id="canvas-container"></div>';
}

export function buildArtPieceSrcDoc(
  engine: ArtPieceEngine,
  code: string,
  htmlCode?: string | null,
  cssCode?: string | null,
  options: { diagnostics?: boolean } = {},
): string {
  const safeCss = cssCode || "";
  const fallbackHtml = defaultHtmlForEngine(engine);
  // SVG bypasses the DIV/CANVAS-only sanitizer — SVG markup must be preserved as-is.
  // The iframe sandbox handles security; this preview is admin-only.
  const safeHtml = engine === "svg"
    ? (htmlCode?.trim() ? htmlCode : fallbackHtml)
    : sanitizeArtPieceHtml(htmlCode, fallbackHtml);
  const safeCode = JSON.stringify(code);
  const diagnosticsEnabled = options.diagnostics === true;

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

  const canvasSafetyScript = `
    function _reassertManagedCanvas(canvas) {
      if (!canvas) return;
      canvas.removeAttribute('hidden');
      canvas.style.setProperty('display', 'block', 'important');
      canvas.style.setProperty('visibility', 'visible', 'important');
      canvas.style.setProperty('opacity', '1', 'important');
      canvas.style.setProperty('position', 'static', 'important');
      canvas.style.setProperty('top', 'auto', 'important');
      canvas.style.setProperty('left', 'auto', 'important');
      canvas.style.setProperty('right', 'auto', 'important');
      canvas.style.setProperty('bottom', 'auto', 'important');
      canvas.style.setProperty('z-index', 'auto', 'important');
      canvas.style.setProperty('pointer-events', 'auto', 'important');
      canvas.style.setProperty('max-width', 'none', 'important');
      canvas.style.setProperty('width', '100%', 'important');
      canvas.style.setProperty('height', '100%', 'important');
      if (!canvas.width) canvas.width = canvas.parentElement?.clientWidth || window.innerWidth || 1280;
      if (!canvas.height) canvas.height = canvas.parentElement?.clientHeight || window.innerHeight || 720;
    }
    function _reassertManagedCanvases(root) {
      (root || document).querySelectorAll('canvas').forEach(_reassertManagedCanvas);
    }
    function _watchManagedCanvases(root) {
      const target = root || document.body;
      _reassertManagedCanvases(target);
      requestAnimationFrame(function _tickCanvasSafety() {
        _reassertManagedCanvases(target);
        requestAnimationFrame(_tickCanvasSafety);
      });
    }
    function _isVisibleBackground(value) {
      if (!value) return false;
      const normalized = String(value).trim().toLowerCase();
      return normalized !== '' && normalized !== 'transparent' && normalized !== 'rgba(0, 0, 0, 0)';
    }
    function _resolveManagedBackground(elements) {
      for (const element of elements) {
        if (!(element instanceof HTMLElement)) continue;
        const inlineBackground = element.style.backgroundColor || element.style.background;
        if (_isVisibleBackground(inlineBackground)) return inlineBackground;
        const computedBackground = window.getComputedStyle(element).backgroundColor;
        if (_isVisibleBackground(computedBackground)) return computedBackground;
      }
      return null;
    }
    function _syncManagedBackdrop(color) {
      if (_isVisibleBackground(color)) {
        document.documentElement.style.background = color;
        document.body.style.background = color;
        const mount = document.getElementById('container')
          || document.getElementById('canvas-container')
          || document.getElementById('sketch-container');
        if (mount instanceof HTMLElement) {
          mount.style.background = color;
        }
        return color;
      }
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
      return null;
    }
  `;

  const engineInit =
    engine === "three"
      ? `
      import * as THREE from '/api/runtimes/three/three.module.min.js';
      window.THREE = THREE;

      const state = { scene: null, camera: null, viewerCamera: null, renderer: null, objects: [], lastRenderAt: 0, fitCount: 0 };
      let _managedRenderActive = false;
      let _managedFrame = 0;
      let _managedCanvas = null;
      let _lastDiagnosticsWarning = '';

      function getThreeMount() {
        return document.getElementById('container')
          || document.getElementById('canvas-container')
          || document.getElementById('sketch-container')
          || document.body.querySelector(':scope > div')
          || document.body;
      }

      function getManagedCanvas() {
        if (_managedCanvas) return _managedCanvas;
        _managedCanvas = document.querySelector('canvas');
        if (!_managedCanvas) {
          _managedCanvas = document.createElement('canvas');
          const container = getThreeMount();
          container.appendChild(_managedCanvas);
        }
        _managedCanvas.setAttribute('data-art-piece-managed-canvas', 'true');
        _reassertManagedCanvas(_managedCanvas);
        return _managedCanvas;
      }

      function getManagedBackgroundFallback() {
        const managedCanvas = getManagedCanvas();
        return _resolveManagedBackground([
          managedCanvas,
          managedCanvas?.parentElement,
          getThreeMount(),
          document.body,
          document.documentElement,
        ]);
      }

      function normalizeThreeCanvases() {
        const managed = getManagedCanvas();
        const mount = getThreeMount();
        if (managed.parentElement !== mount) {
          mount.appendChild(managed);
        }
        document.querySelectorAll('canvas').forEach(function(candidate) {
          if (candidate === managed) {
            _reassertManagedCanvas(candidate);
            return;
          }
          candidate.style.setProperty('display', 'none', 'important');
          candidate.style.setProperty('visibility', 'hidden', 'important');
          candidate.style.setProperty('position', 'absolute', 'important');
          candidate.style.setProperty('pointer-events', 'none', 'important');
          candidate.setAttribute('aria-hidden', 'true');
        });
        return managed;
      }

      function getRenderableObjectCount() {
        if (!state.scene?.traverse) return state.objects.length;
        let count = 0;
        state.scene.traverse(function(object) {
          if (object?.geometry || object?.isMesh || object?.isLine || object?.isPoints || object?.isSprite) {
            count++;
          }
        });
        return count || state.objects.length;
      }

      function getRenderableBounds() {
        const box = new THREE.Box3();
        if (!state.scene?.traverse) return box;
        state.scene.traverse(function(obj) {
          if (obj.isHelper || obj.isLight || obj.isCamera) return;
          if ((obj.isMesh || obj.isLine || obj.isPoints || obj.isSprite) && obj.geometry) {
            obj.geometry.computeBoundingBox?.();
            if (obj.geometry.boundingBox) {
              box.union(obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld));
            }
          }
        });
        return box;
      }

      function postThreeDiagnostics(valid) {
        if (!${JSON.stringify(diagnosticsEnabled)}) return;
        const canvasCount = document.querySelectorAll('canvas').length;
        const activeCanvas = state.renderer?.domElement || null;
        const managed = getManagedCanvas();
        const parts = [
          'Three diagnostics:',
          'scene=' + Boolean(state.scene),
          'camera=' + Boolean(state.camera),
          'viewerCamera=' + Boolean(state.viewerCamera),
          'renderer=' + Boolean(state.renderer),
          'objects=' + getRenderableObjectCount(),
          'canvases=' + canvasCount,
          'managedRendererCanvas=' + Boolean(activeCanvas && activeCanvas === managed),
          'fitCount=' + state.fitCount,
          'lastRenderAt=' + Math.round(state.lastRenderAt || 0),
        ];
        if (${JSON.stringify(diagnosticsEnabled)}) {
          try {
            const bounds = getRenderableBounds();
            const empty = bounds.isEmpty();
            parts.push('boundsEmpty=' + empty);
            if (!empty) {
              const bc = bounds.getCenter(new THREE.Vector3());
              const bs = bounds.getSize(new THREE.Vector3());
              parts.push('boundsSize=' + bs.x.toFixed(1) + 'x' + bs.y.toFixed(1) + 'x' + bs.z.toFixed(1));
              parts.push('boundsCenter=' + bc.x.toFixed(1) + ',' + bc.y.toFixed(1) + ',' + bc.z.toFixed(1));
            }
            if (state.viewerCamera) {
              const p = state.viewerCamera.position;
              parts.push('camPos=' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + p.z.toFixed(1));
              parts.push('near=' + state.viewerCamera.near.toFixed(3));
              parts.push('far=' + Math.round(state.viewerCamera.far));
            }
            let lightCount = 0;
            let invisMats = 0;
            state.scene?.traverse?.(function(obj) {
              if (obj.isLight && !obj.name?.startsWith('__viewer_fallback_')) lightCount++;
              const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
              mats.forEach(function(m) { if (m && m.opacity !== undefined && m.opacity < 0.05) invisMats++; });
            });
            parts.push('lights=' + lightCount);
            parts.push('invisMats=' + invisMats);
          } catch(_) {}
        }
        const warning = parts.join(' ');
        if (warning === _lastDiagnosticsWarning) return;
        _lastDiagnosticsWarning = warning;
        window.parent.postMessage({ type: 'sketch-status', valid, warning }, '*');
      }

      function getViewerCamera(aspect) {
        if (!state.viewerCamera) {
          state.viewerCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
        }
        state.viewerCamera.aspect = aspect;
        state.viewerCamera.layers.enableAll?.();
        return state.viewerCamera;
      }

      function ensureFallbackLighting() {
        if (!state.scene?.traverse) return;
        let hasRealLight = false;
        let hasFallback = false;
        const fallbacks = [];
        state.scene.traverse(function(obj) {
          if (!obj.isLight) return;
          if (obj.name?.startsWith('__viewer_fallback_')) { hasFallback = true; fallbacks.push(obj); }
          else hasRealLight = true;
        });
        if (hasRealLight) {
          fallbacks.forEach(function(obj) { state.scene.remove(obj); });
          return;
        }
        if (hasFallback) return;
        const amb = new THREE.AmbientLight(0xffffff, 0.7);
        amb.name = '__viewer_fallback_ambient__';
        state.scene.add(amb);
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(5, 10, 7.5);
        dir.name = '__viewer_fallback_dir__';
        state.scene.add(dir);
      }

      function prepareSceneForViewerRender() {
        if (!state.scene?.traverse) return;
        ensureFallbackLighting();
        state.scene.traverse(function(object) {
          object.frustumCulled = false;
          object.layers?.enableAll?.();
          if ((object.isMesh || object.isLine || object.isPoints || object.isSprite) && object.visible === false) {
            object.visible = true;
          }
          if (object.material) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(function(material) {
              if (!material) return;
              material.clippingPlanes = null;
              material.clipIntersection = false;
              material.visible = true;
              if (material.opacity !== undefined && material.opacity < 0.05) {
                material.opacity = 1;
                material.transparent = false;
              }
            });
          }
        });
      }

      function prepareRendererForViewerRender() {
        const canvas = normalizeThreeCanvases();
        const width = canvas?.clientWidth || canvas?.width || window.innerWidth || 1280;
        const height = canvas?.clientHeight || canvas?.height || window.innerHeight || 720;
        state.renderer.setSize?.(width, height, false);
        state.renderer.setViewport?.(0, 0, width, height);
        state.renderer.setScissorTest?.(false);
        if (state.camera && 'aspect' in state.camera) {
          state.camera.aspect = width / Math.max(height, 1);
          state.camera.updateProjectionMatrix?.();
        }
        const previewBackground = state.scene?.background || 0x000000;
        state.renderer.setClearColor?.(previewBackground, 1);
        if (state.scene?.background?.getStyle) {
          _syncManagedBackdrop(state.scene.background.getStyle());
        } else {
          _syncManagedBackdrop(typeof previewBackground === 'string' ? previewBackground : null);
        }
        state.renderer.autoClear = true;
        state.renderer.localClippingEnabled = false;
        state.renderer.shadowMap && (state.renderer.shadowMap.enabled = false);
        return { width, height };
      }

      function autoFit() {
        if (!state.scene) return false;
        const canvas = normalizeThreeCanvases();
        const width = canvas?.clientWidth || canvas?.width || window.innerWidth || 1280;
        const height = canvas?.clientHeight || canvas?.height || window.innerHeight || 720;
        let box = getRenderableBounds();
        if (box.isEmpty()) {
          try { box = new THREE.Box3().setFromObject(state.scene); } catch(_) {}
        }
        if (box.isEmpty()) return false;
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const aspect = width / Math.max(height, 1);
        const viewerCamera = getViewerCamera(aspect);
        const verticalFov = viewerCamera.fov * (Math.PI / 180);
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(aspect, 0.1));
        const fitWidth = Math.max(size.x, size.z, 1);
        const fitHeight = Math.max(size.y, size.z * 0.85, 1);
        const distanceForHeight = (fitHeight / 2) / Math.tan(verticalFov / 2);
        const distanceForWidth = (fitWidth / 2) / Math.tan(horizontalFov / 2);
        const cameraZ = Math.max(distanceForHeight, distanceForWidth) * 1.55;
        const targetY = center.y + fitHeight * 0.08;
        viewerCamera.position.set(center.x, targetY + fitHeight * 0.18, center.z + cameraZ);
        viewerCamera.lookAt(center.x, targetY, center.z);
        viewerCamera.near = Math.max(0.01, cameraZ / 1000);
        viewerCamera.far = Math.max(1000, cameraZ * 100 + maxDim * 100);
        viewerCamera.updateProjectionMatrix?.();
        viewerCamera.updateMatrixWorld(true);

        if (state.camera) {
          state.camera.near = Math.max(0.01, cameraZ / 1000);
          state.camera.far = Math.max(1000, cameraZ * 100 + maxDim * 100);
          state.camera.updateProjectionMatrix?.();
        }

        state.fitCount++;
        return true;
      }

      function forceManagedRender() {
        if (_managedRenderActive || !state.renderer || !state.scene || !state.camera) return;
        _managedRenderActive = true;
        try {
          prepareRendererForViewerRender();
          prepareSceneForViewerRender();
          autoFit();
          // Prefer the piece's own camera when it is positioned away from the world origin —
          // that means the AI set a meaningful camera position and the preview should match VR.
          // Fall back to the auto-fit viewer camera only when the piece camera is missing or
          // stuck at (0,0,0), which indicates the scene hasn't initialised yet.
          const renderCamera = (state.camera && state.camera.position.length() > 0.5)
            ? state.camera
            : (state.viewerCamera || state.camera);
          state.renderer.render(state.scene, renderCamera);
          state.lastRenderAt = performance.now();
          postThreeDiagnostics(true);
        } finally {
          _managedRenderActive = false;
        }
      }

      function scheduleAutoFit() {
        const frames = [1, 2, 4, 8, 12, 20, 30, 45, 60];
        let frame = 0;
        function tickAutoFit() {
          frame++;
          if (frames.includes(frame)) forceManagedRender();
          if (frame < frames[frames.length - 1]) {
            requestAnimationFrame(tickAutoFit);
          }
        }
        requestAnimationFrame(tickAutoFit);
        [80, 160, 320, 640, 1000].forEach(function(delay) {
          window.setTimeout(forceManagedRender, delay);
        });
      }

      function startManagedRenderLoop() {
        function tickManagedRender() {
          _managedFrame++;
          if (_managedFrame <= 120 || _managedFrame % 30 === 0) {
            forceManagedRender();
          } else if (state.renderer && state.scene && state.camera) {
            prepareRendererForViewerRender();
            prepareSceneForViewerRender();
            const renderCam = (state.camera.position.length() > 0.5)
              ? state.camera
              : (state.viewerCamera || state.camera);
            state.renderer.render(state.scene, renderCam);
            state.lastRenderAt = performance.now();
          }
          if (_managedFrame % 60 === 0) postThreeDiagnostics(Boolean(state.renderer && state.scene && state.camera));
          requestAnimationFrame(tickManagedRender);
        }
        requestAnimationFrame(tickManagedRender);
      }

      function startFrame(handler) {
        let frameCount = 0;
        let rafId = 0;
        function tick() {
          frameCount++;
          handler(frameCount);
          if (frameCount === 15) autoFit();
          rafId = requestAnimationFrame(tick);
        }
        rafId = requestAnimationFrame(tick);
        return function stopFrame() {
          cancelAnimationFrame(rafId);
        };
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
          let canvas = getManagedCanvas();
          const width = canvas.offsetWidth || window.innerWidth;
          const height = canvas.offsetHeight || window.innerHeight;
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
          if ('OrthographicCamera' in THREE) {
            const originalOrthographicCamera = THREE.OrthographicCamera;
            instrumentedThree.OrthographicCamera = class extends originalOrthographicCamera { constructor(...args) { super(...args); state.camera = this; } };
          }
          const _OriginalWebGLRenderer = THREE.WebGLRenderer;
          instrumentedThree.WebGLRenderer = class extends _OriginalWebGLRenderer {
            constructor(params) {
              const managedCanvas = getManagedCanvas();
              super({ ...(params || {}), canvas: managedCanvas });
              state.renderer = this;
              normalizeThreeCanvases();
              const originalRender = this.render.bind(this);
              this.render = function(sceneArg, cameraArg) {
                if (sceneArg) state.scene = sceneArg;
                if (cameraArg) state.camera = cameraArg;
                normalizeThreeCanvases();
                const result = originalRender(sceneArg, cameraArg);
                state.lastRenderAt = performance.now();
                return result;
              };
              if (typeof this.setAnimationLoop === 'function') {
                const originalSetAnimationLoop = this.setAnimationLoop.bind(this);
                this.setAnimationLoop = function(callback) {
                  if (typeof callback !== 'function') {
                    return originalSetAnimationLoop(callback);
                  }
                  let loopFrame = 0;
                  return originalSetAnimationLoop(function(time, xrFrame) {
                    loopFrame++;
                    const result = callback(time, xrFrame);
                    if (loopFrame <= 60 && (loopFrame === 1 || loopFrame === 2 || loopFrame === 4 || loopFrame === 8 || loopFrame === 12 || loopFrame === 20 || loopFrame === 30 || loopFrame === 45 || loopFrame === 60)) {
                      forceManagedRender();
                    }
                    return result;
                  });
                };
              }
            }
          };
          window.THREE = instrumentedThree;

          sketchFactory({ THREE: instrumentedThree, canvas, startFrame, width, height, size: { width, height } });
          // Re-assert styles after sketch runs — renderer.setSize() without false overrides width/height to pixel values.
          normalizeThreeCanvases();
          scheduleAutoFit();
          startManagedRenderLoop();
          postThreeDiagnostics(true);
          if (!${JSON.stringify(diagnosticsEnabled)}) {
            window.parent.postMessage({ type: 'sketch-status', valid: true }, '*');
          }
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
        let rafId = 0;
        function tick() {
          frameCount++;
          handler(frameCount);
          rafId = requestAnimationFrame(tick);
        }
        rafId = requestAnimationFrame(tick);
        return function stopFrame() {
          cancelAnimationFrame(rafId);
        };
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
          const _cw = canvas.parentElement?.clientWidth || window.innerWidth;
          const _ch = canvas.parentElement?.clientHeight || window.innerHeight;
          if (_cw > 0) canvas.width = _cw;
          if (_ch > 0) canvas.height = _ch;
          _reassertManagedCanvas(canvas);
          sketchFactory({ c2: window.c2, canvas, startFrame });
          _watchManagedCanvases(canvas.parentElement || document.body);
          window.parent.postMessage({ type: 'sketch-status', valid: true }, '*');
        } else {
          throw new Error('Sketch factory not found. Ensure your JS assigns a function to window.sketch.');
        }
      } catch(err) {
        window.dispatchEvent(new ErrorEvent('error', { message: err.message }));
      }
    `
        : engine === "svg"
          ? `
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
          function _initP5() {
            if (window.innerHeight > 0) {
              new p5(sketchFactory, container);
              _watchManagedCanvases(container);
              window.parent.postMessage({ type: 'sketch-status', valid: true }, '*');
            } else {
              setTimeout(_initP5, 16);
            }
          }
          _initP5();
        } else {
          throw new Error('Sketch factory not found. Ensure your JS assigns a function to window.sketch.');
        }
      } catch(err) {
        window.dispatchEvent(new ErrorEvent('error', { message: err.message }));
      }
    `;

  const bodyContent = `
      ${safeHtml}
      <script type="${engine === "three" ? "module" : "text/javascript"}">
        ${canvasSafetyScript}
        ${engineInit}
      </script>
    `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    ${safeCss}
    html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; width: 100% !important; height: 100% !important; ${engine === "svg" ? "background: #0a0a14 !important;" : ""} }
    #container, #canvas-container, #sketch-container { width: 100% !important; height: 100% !important; min-width: 100% !important; min-height: 100% !important; }
    canvas[data-art-piece-managed-canvas="true"], body > canvas:first-of-type { display: block !important; visibility: visible !important; opacity: 1 !important; width: 100% !important; height: 100% !important; position: static !important; inset: auto !important; z-index: auto !important; pointer-events: auto !important; }
  </style>
  <script>${errorOverlayScript}</script>
  ${libraryScripts[engine] || ""}
</head>
<body>
${bodyContent}
</body>
</html>`;
}

(function() {
  if (customElements.get("creatr-art-piece")) return;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      let script = document.querySelector(`script[src="${src}"]`);
      if (script) {
        if (script.dataset.loaded === "true") {
          resolve();
        } else {
          script.addEventListener("load", () => resolve());
          script.addEventListener("error", () => reject(new Error("Failed to load script " + src)));
        }
        return;
      }
      script = document.createElement("script");
      script.src = src;
      script.dataset.loaded = "false";
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      });
      script.addEventListener("error", () => reject(new Error("Failed to load script " + src)));
      document.head.appendChild(script);
    });
  }

  function promoteToBody(el) {
    if (el.placeholder) return;
    el.placeholder = document.createElement("div");
    el.placeholder.style.display = "none";
    el.placeholder.dataset.creatrPlaceholder = "true";
    el.parentNode.insertBefore(el.placeholder, el);
    el.isRelocating = true;
    document.body.appendChild(el);
  }

  function demoteFromBody(el) {
    if (!el.placeholder) return;
    el.isRelocating = true;
    if (el.placeholder.parentNode) {
      el.placeholder.parentNode.insertBefore(el, el.placeholder);
    }
    el.placeholder.remove();
    el.placeholder = null;
  }

  class CreatrArtPiece extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.isFullscreen = false;
      this.cleanup = null;
      this.handleFullscreenChange = this.handleFullscreenChange.bind(this);
    }

    async connectedCallback() {
      if (this.isRelocating) {
        this.isRelocating = false;
        return;
      }

      // Remove fallback iframe to prevent double rendering and save resources
      const fallback = this.querySelector("iframe");
      if (fallback) {
        fallback.remove();
      }

      document.addEventListener("fullscreenchange", this.handleFullscreenChange);

      if (this.isRendered) return;

      const pieceId = this.getAttribute("piece-id");
      if (!pieceId) {
        this.shadowRoot.innerHTML = "<div style='color:red;'>Missing piece-id attribute</div>";
        return;
      }

      const version = this.getAttribute("version");
      let origin = this.getAttribute("origin");
      if (!origin) {
        const script = document.currentScript || document.querySelector('script[src*="embed.js"]');
        if (script) {
          try {
            origin = new URL(script.src).origin;
          } catch (e) {
            origin = window.location.origin;
          }
        } else {
          origin = window.location.origin;
        }
      }

      this.origin = origin;

      try {
        const res = await fetch(`${origin}/embed/pieces/${pieceId}/data${version ? `?version=${version}` : ""}`);
        if (!res.ok) throw new Error("Piece not found");
        const data = await res.json();
        await this.renderPiece(data);
      } catch (e) {
        console.error(e);
        this.shadowRoot.innerHTML = `<div style="font-family:sans-serif;color:#666;padding:1rem;background:#fafafa;border:1px solid #ddd;border-radius:8px;">Interactive piece failed to load.</div>`;
      }
    }

    disconnectedCallback() {
      if (this.isRelocating) return;
      if (this.cleanup) {
        try { this.cleanup(); } catch (e) {}
      }
      document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
      document.body.style.overflow = "";
    }

    handleFullscreenChange() {
      const isNativeFs = document.fullscreenElement === this;
      if (!isNativeFs && this.isFullscreen) {
        this.isFullscreen = false;
        demoteFromBody(this);
        this.classList.remove("fullscreen");
        document.body.style.overflow = "";
        const btn = this.shadowRoot.querySelector(".fullscreen-btn");
        if (btn) {
          btn.innerHTML = `
            <svg viewBox="0 0 24 24">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          `;
        }
        window.dispatchEvent(new Event("resize"));
      }
    }

    async renderPiece(data) {
      const { engine, generatedCode, htmlCode, cssCode, title } = data;
      const defaultContainerId = engine === "three" ? "container" : "canvas-container";

      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            position: relative;
            width: 100%;
            aspect-ratio: 16 / 9;
            min-height: 300px;
            overflow: hidden;
            background: #0a0a14;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          :host(.fullscreen), :host(:fullscreen) {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            width: 100dvw !important;
            height: 100vh !important;
            height: 100dvh !important;
            aspect-ratio: auto !important;
            z-index: 9999999 !important;
            border-radius: 0 !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          #stage-container {
            width: 100%;
            height: 100%;
            position: relative;
            overflow: hidden;
          }
          #${defaultContainerId} {
            width: 100%;
            height: 100%;
          }
          canvas {
            display: block;
            width: 100%;
            height: 100%;
          }
          .fullscreen-btn {
            position: absolute;
            bottom: 16px;
            right: 16px;
            z-index: 100;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(0, 0, 0, 0.55);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            backdrop-filter: blur(4px);
            transition: background 0.2s, transform 0.1s;
          }
          .fullscreen-btn:hover {
            background: rgba(0, 0, 0, 0.7);
          }
          .fullscreen-btn:active {
            transform: scale(0.95);
          }
          .fullscreen-btn svg {
            width: 18px;
            height: 18px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          ${cssCode || ""}
        </style>
        <div id="stage-container">
          ${htmlCode || `<div id="${defaultContainerId}"></div>`}
          <button class="fullscreen-btn" aria-label="Toggle Fullscreen">
            <svg viewBox="0 0 24 24">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
        </div>
      `;

      const container = this.shadowRoot.getElementById("stage-container");
      const btn = this.shadowRoot.querySelector(".fullscreen-btn");

      btn.addEventListener("click", () => {
        this.isFullscreen = !this.isFullscreen;
        if (this.isFullscreen) {
          if (this.requestFullscreen) {
            this.requestFullscreen().then(() => {
              this.classList.add("fullscreen");
              btn.innerHTML = `
                <svg viewBox="0 0 24 24">
                  <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                </svg>
              `;
            }).catch(() => {
              promoteToBody(this);
              this.classList.add("fullscreen");
              btn.innerHTML = `
                <svg viewBox="0 0 24 24">
                  <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                </svg>
              `;
              document.body.style.overflow = "hidden";
            });
          } else {
            promoteToBody(this);
            this.classList.add("fullscreen");
            btn.innerHTML = `
              <svg viewBox="0 0 24 24">
                <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
              </svg>
            `;
            document.body.style.overflow = "hidden";
          }
        } else {
          if (document.fullscreenElement === this) {
            document.exitFullscreen().catch(() => {});
          }
          demoteFromBody(this);
          this.classList.remove("fullscreen");
          btn.innerHTML = `
            <svg viewBox="0 0 24 24">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          `;
          document.body.style.overflow = "";
        }
        window.dispatchEvent(new Event("resize"));
      });

      if (engine === "p5") {
        await loadScript(`${this.origin}/api/runtimes/p5/p5.min.js`);
        const p5Container = this.shadowRoot.getElementById("canvas-container");
        
        let sketchFactory = new Function("return (" + generatedCode + ")")();
        const p5Instance = new window.p5(sketchFactory, p5Container);
        this.cleanup = () => {
          try { p5Instance.remove(); } catch(e) {}
        };
      } else if (engine === "c2") {
        await loadScript(`${this.origin}/api/runtimes/c2/c2.min.js`);
        const c2Container = this.shadowRoot.getElementById("canvas-container") || container;
        let canvas = c2Container.querySelector("canvas");
        if (!canvas) {
          canvas = document.createElement("canvas");
          c2Container.appendChild(canvas);
        }
        canvas.style.display = "block";
        canvas.width = c2Container.clientWidth || 800;
        canvas.height = c2Container.clientHeight || 450;

        let rafId = 0;
        const stopFrame = () => cancelAnimationFrame(rafId);
        const startFrame = (handler) => {
          let frameCount = 0;
          const tick = () => {
            frameCount++;
            handler(frameCount);
            rafId = requestAnimationFrame(tick);
          };
          rafId = requestAnimationFrame(tick);
          return stopFrame;
        };

        let sketchFactory = new Function("return (" + generatedCode + ")")();
        sketchFactory({ c2: window.c2, canvas, startFrame });

        const handleResize = () => {
          if (canvas && c2Container) {
            canvas.width = c2Container.clientWidth;
            canvas.height = c2Container.clientHeight;
          }
        };
        window.addEventListener("resize", handleResize);

        this.cleanup = () => {
          window.removeEventListener("resize", handleResize);
          stopFrame();
        };
      } else if (engine === "three") {
        const threeUrl = `${this.origin}/api/runtimes/three/three.module.min.js`;
        const orbitUrl = `${this.origin}/api/runtimes/three-examples/jsm/controls/OrbitControls.js`;

        const THREE = await import(threeUrl);
        window.THREE = THREE;

        const threeContainer = this.shadowRoot.getElementById("container") || container;
        let canvas = threeContainer.querySelector("canvas");
        if (!canvas) {
          canvas = document.createElement("canvas");
          threeContainer.appendChild(canvas);
        }
        canvas.style.cssText = "display:block;width:100%;height:100%;";
        
        const state = { scene: null, camera: null, renderer: null, objects: [] };
        let controls = null;
        let rafIds = [];

        function autoFit() {
          if (!state.scene || !state.camera) return;
          const box = new THREE.Box3();
          state.scene.traverse((obj) => {
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
          return () => { rafIds.forEach(cancelAnimationFrame); rafIds = []; };
        }

        const instrumentedThree = { ...THREE };
        instrumentedThree.Scene = class extends THREE.Scene {
          constructor() { super(); state.scene = this; }
          add(...objs) {
            objs.forEach((o) => { if (o.geometry) state.objects.push(o); });
            return super.add(...objs);
          }
        };
        instrumentedThree.PerspectiveCamera = class extends THREE.PerspectiveCamera {
          constructor(...args) { super(...args); state.camera = this; }
        };
        instrumentedThree.WebGLRenderer = class extends THREE.WebGLRenderer {
          constructor(params) {
            super({ ...(params || {}), canvas });
            state.renderer = this;
            const _origSetSize = this.setSize.bind(this);
            this.setSize = (w, h) => _origSetSize(w, h, false);
            const _origRender = this.render.bind(this);
            this.render = (sc, cam) => {
              if (sc) state.scene = sc;
              if (cam) state.camera = cam;
              return _origRender(sc, cam);
            };
          }
        };

        const { OrbitControls } = await import(orbitUrl);

        let sketchFactory = new Function("return (" + generatedCode + ")")();
        sketchFactory({ THREE: instrumentedThree, canvas, startFrame });

        if (state.camera && canvas) {
          controls = new OrbitControls(state.camera, canvas);
          controls.enableDamping = true;
          controls.enablePan = true;
          const _camDir = new THREE.Vector3();
          state.camera.getWorldDirection(_camDir);
          const _camLen = state.camera.position.length();
          controls.target
            .copy(state.camera.position)
            .addScaledVector(_camDir, Math.max(_camLen * 0.8, 3));
          autoFit();
          controls.update();

          const animateControls = () => {
            const id = requestAnimationFrame(animateControls);
            rafIds.push(id);
            controls.update();
            if (state.renderer && state.scene && state.camera)
              state.renderer.render(state.scene, state.camera);
          };
          animateControls();
        }

        const handleResize = () => {
          if (state.renderer && state.camera && canvas && threeContainer) {
            const width = threeContainer.clientWidth;
            const height = threeContainer.clientHeight;
            state.camera.aspect = width / height;
            state.camera.updateProjectionMatrix();
            state.renderer.setSize(width, height);
          }
        };
        window.addEventListener("resize", handleResize);

        this.cleanup = () => {
          window.removeEventListener("resize", handleResize);
          rafIds.forEach(cancelAnimationFrame);
          controls?.dispose();
          state.renderer?.dispose();
        };
      } else if (engine === "svg") {
        const svgEl = this.shadowRoot.querySelector("svg");
        if (svgEl) {
          window.svgRoot = svgEl;
        }
        let sketchFactory = new Function("return (" + generatedCode + ")")();
        if (typeof sketchFactory === "function") {
          sketchFactory();
        }
      }
      this.isRendered = true;
    }
  }

  class CreatrImmersiveImage extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            position: relative;
            width: 100%;
            aspect-ratio: 16 / 9;
            min-height: 300px;
            overflow: hidden;
            background: #0a0a14;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          :host(.fullscreen), :host(:fullscreen) {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            width: 100dvw !important;
            height: 100vh !important;
            height: 100dvh !important;
            aspect-ratio: auto !important;
            z-index: 9999999 !important;
            border-radius: 0 !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          ::slotted(iframe) {
            width: 100% !important;
            height: 100% !important;
            border: none !important;
            display: block !important;
          }
        </style>
        <slot></slot>
      `;
      this.handleMessage = this.handleMessage.bind(this);
      this.handleFullscreenChange = this.handleFullscreenChange.bind(this);
    }

    connectedCallback() {
      if (this.isRelocating) {
        this.isRelocating = false;
        return;
      }
      window.addEventListener("message", this.handleMessage);
      document.addEventListener("fullscreenchange", this.handleFullscreenChange);
    }

    disconnectedCallback() {
      if (this.isRelocating) return;
      window.removeEventListener("message", this.handleMessage);
      document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
      document.body.style.overflow = "";
    }

    handleFullscreenChange() {
      const isNativeFs = document.fullscreenElement === this;
      const iframe = this.querySelector("iframe");
      if (!isNativeFs && this.classList.contains("fullscreen")) {
        demoteFromBody(this);
        this.classList.remove("fullscreen");
        document.body.style.overflow = "";
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: "creatr-parent-exit-fullscreen" }, "*");
        }
        window.dispatchEvent(new Event("resize"));
      }
    }

    handleMessage(e) {
      const iframe = this.querySelector("iframe");
      if (!iframe || iframe.contentWindow !== e.source) return;

      if (e.data && e.data.type === "creatr-iframe-ready") {
        iframe.contentWindow.postMessage({ type: "creatr-wrapper-connected" }, "*");
      }

      if (e.data && e.data.type === "creatr-toggle-fullscreen") {
        const shouldBeFullscreen = !!e.data.value;
        if (shouldBeFullscreen) {
          if (this.requestFullscreen) {
            this.requestFullscreen().then(() => {
              this.classList.add("fullscreen");
            }).catch(() => {
              promoteToBody(this);
              this.classList.add("fullscreen");
              document.body.style.overflow = "hidden";
            });
          } else {
            promoteToBody(this);
            this.classList.add("fullscreen");
            document.body.style.overflow = "hidden";
          }
        } else {
          if (document.fullscreenElement === this) {
            document.exitFullscreen().catch(() => {});
          }
          demoteFromBody(this);
          this.classList.remove("fullscreen");
          document.body.style.overflow = "";
        }
        window.dispatchEvent(new Event("resize"));
      }
    }
  }

  class CreatrExhibitWall extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            position: relative;
            width: 100%;
            aspect-ratio: 16 / 9;
            min-height: 300px;
            overflow: hidden;
            background: #0a0a14;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          :host(.fullscreen), :host(:fullscreen) {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            width: 100dvw !important;
            height: 100vh !important;
            height: 100dvh !important;
            aspect-ratio: auto !important;
            z-index: 9999999 !important;
            border-radius: 0 !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          ::slotted(iframe) {
            width: 100% !important;
            height: 100% !important;
            border: none !important;
            display: block !important;
          }
        </style>
        <slot></slot>
      `;
      this.handleMessage = this.handleMessage.bind(this);
      this.handleFullscreenChange = this.handleFullscreenChange.bind(this);
    }

    connectedCallback() {
      if (this.isRelocating) {
        this.isRelocating = false;
        return;
      }
      window.addEventListener("message", this.handleMessage);
      document.addEventListener("fullscreenchange", this.handleFullscreenChange);
    }

    disconnectedCallback() {
      if (this.isRelocating) return;
      window.removeEventListener("message", this.handleMessage);
      document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
      document.body.style.overflow = "";
    }

    handleFullscreenChange() {
      const isNativeFs = document.fullscreenElement === this;
      const iframe = this.querySelector("iframe");
      if (!isNativeFs && this.classList.contains("fullscreen")) {
        demoteFromBody(this);
        this.classList.remove("fullscreen");
        document.body.style.overflow = "";
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: "creatr-parent-exit-fullscreen" }, "*");
        }
        window.dispatchEvent(new Event("resize"));
      }
    }

    handleMessage(e) {
      const iframe = this.querySelector("iframe");
      if (!iframe || iframe.contentWindow !== e.source) return;

      if (e.data && e.data.type === "creatr-iframe-ready") {
        iframe.contentWindow.postMessage({ type: "creatr-wrapper-connected" }, "*");
      }

      if (e.data && e.data.type === "creatr-toggle-fullscreen") {
        const shouldBeFullscreen = !!e.data.value;
        if (shouldBeFullscreen) {
          if (this.requestFullscreen) {
            this.requestFullscreen().then(() => {
              this.classList.add("fullscreen");
            }).catch(() => {
              promoteToBody(this);
              this.classList.add("fullscreen");
              document.body.style.overflow = "hidden";
            });
          } else {
            promoteToBody(this);
            this.classList.add("fullscreen");
            document.body.style.overflow = "hidden";
          }
        } else {
          if (document.fullscreenElement === this) {
            document.exitFullscreen().catch(() => {});
          }
          demoteFromBody(this);
          this.classList.remove("fullscreen");
          document.body.style.overflow = "";
        }
        window.dispatchEvent(new Event("resize"));
      }
    }
  }

  customElements.define("creatr-art-piece", CreatrArtPiece);
  customElements.define("creatr-immersive-image", CreatrImmersiveImage);
  customElements.define("creatr-exhibit-wall", CreatrExhibitWall);
})();

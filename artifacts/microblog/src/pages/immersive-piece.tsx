import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ArrowLeft } from "lucide-react";
import {
  type EmbeddedArtPiece,
  getGetEmbeddedArtPieceQueryKey,
  useGetEmbeddedArtPiece,
} from "@workspace/api-client-react";
import { useLocation, useRoute } from "wouter";
import { ArtPieceRenderer } from "@/components/post/ArtPieceRenderer";
import {
  computeThreeAutoFitView,
  createFloorClickNavigation,
  createKeyboardNavigation,
  createPresentationSurface,
  createMountedGalleryShell,
  syncThreeRendererBackground,
  disposeObjectMaterial,
  drawContainedIntoPresentationSurface,
  fitMountedGalleryCamera,
  isCompactImmersiveViewport,
  NORMALIZED_PRESENTATION_GALLERY_PROFILE,
  updateMountedGalleryLayout,
} from "@/lib/immersive-gallery";
import {
  createImmersiveHost,
  DEFAULT_IMMERSIVE_RUNTIME_SIZE,
  getCanvasMetrics,
  normalizeManagedCanvasStyles,
  observeManagedCanvasContainment,
  resolveImmersiveElementBackground,
  resolveSketchFactory,
  type ImmersiveRuntimeSize,
} from "@/lib/immersive-piece-runtime";
import {
  ImmersiveMetadataCard,
  ImmersiveRouteShell,
} from "@/components/immersive/ImmersiveRouteShell";
import {
  buildImmersivePieceHref,
  buildPieceGalleryEmbedHtml,
} from "@/lib/immersive-view";

function useReturnToPrevious() {
  const [, setLocation] = useLocation();
  return () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setLocation("/");
  };
}

type PieceStageProps = {
  engine: "p5" | "c2" | "three";
  code: string;
  htmlCode?: string | null;
  cssCode?: string | null;
  title: string;
  onError: (message: string | null) => void;
};

function ImmersiveGalleryPieceStage({
  code,
  htmlCode,
  cssCode,
  title,
  engine,
  onError,
}: PieceStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);

  function sampleCanvasBackground(canvas: HTMLCanvasElement) {
    try {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return null;
      }
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${(pixel[3] / 255).toFixed(3)})`;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const stageEl = stage;
    const runtimeSize = { ...DEFAULT_IMMERSIVE_RUNTIME_SIZE };
    const presentationSurface =
      engine === "p5" ? createPresentationSurface(1200, 900, 72) : null;
    const shell = createMountedGalleryShell(
      stageEl,
      presentationSurface
        ? presentationSurface.width / presentationSurface.height
        : runtimeSize.width / runtimeSize.height,
      presentationSurface ? NORMALIZED_PRESENTATION_GALLERY_PROFILE : undefined,
    );
    const host = createImmersiveHost(
      htmlCode,
      cssCode,
      engine === "p5" ? '<div id="canvas-container"></div>' : '<canvas id="piece-canvas"></canvas>',
      runtimeSize,
    );

    let sourceCanvas: HTMLCanvasElement | null = null;
    let managedCanvasContainment:
      | ReturnType<typeof observeManagedCanvasContainment>
      | null = null;
    let artTexture: any = null;
    let frameId = 0;
    let detectCanvasTimer: number | null = null;
    let detectCanvasAttempts = 0;
    let stopSourceLoop: (() => void) | null = null;
    let p5Instance: { remove?: () => void } | null = null;
    let disposed = false;

    function syncCanvas(nextCanvas: HTMLCanvasElement) {
      sourceCanvas = nextCanvas;
      const displayCanvas = presentationSurface?.canvas ?? nextCanvas;
      if (!managedCanvasContainment) {
        const canvasHost =
          nextCanvas.parentElement instanceof HTMLElement ? nextCanvas.parentElement : host;
        managedCanvasContainment = observeManagedCanvasContainment(
          nextCanvas,
          canvasHost,
          runtimeSize,
        );
      }
      if (!artTexture) {
        artTexture = new THREE.CanvasTexture(displayCanvas);
        artTexture.colorSpace = THREE.SRGBColorSpace;
        shell.artMaterial.map = artTexture;
        shell.artMaterial.needsUpdate = true;
      }
      if (presentationSurface) {
        const presentationBackground =
          resolveImmersiveElementBackground([
            nextCanvas,
            nextCanvas.parentElement,
            host.querySelector("#canvas-container"),
            host,
          ])
          ?? sampleCanvasBackground(nextCanvas)
          ?? "#05070f";
        drawContainedIntoPresentationSurface(
          presentationSurface,
          nextCanvas.width || runtimeSize.width,
          nextCanvas.height || runtimeSize.height,
          (ctx, x, y, width, height) => {
            ctx.drawImage(nextCanvas, x, y, width, height);
          },
          presentationBackground,
        );
      }
      const metrics = getCanvasMetrics(displayCanvas, runtimeSize);
      updateMountedGalleryLayout(shell, metrics.aspect);
      fitMountedGalleryCamera(shell, stageEl);
      onError(null);
    }

    function pollForCanvas(root: ParentNode, onMissing: string) {
      const candidate = root.querySelector("canvas");
      if (candidate instanceof HTMLCanvasElement) {
        if (candidate.width === 0 || candidate.height === 0) {
          candidate.width = runtimeSize.width;
          candidate.height = runtimeSize.height;
        }
        syncCanvas(candidate);
        return;
      }
      if (detectCanvasAttempts >= 80) {
        onError(onMissing);
        return;
      }
      detectCanvasAttempts += 1;
      detectCanvasTimer = window.setTimeout(() => pollForCanvas(root, onMissing), 100);
    }

    async function bootRuntime() {
      try {
        if (engine === "p5") {
          const p5Module = await import("p5");
          const P5 = (p5Module.default ?? p5Module) as any;
          const sketchFactory = resolveSketchFactory(code);
          const mount =
            host.querySelector("#canvas-container") ||
            host.querySelector("#sketch-container") ||
            host;
          p5Instance = new P5(sketchFactory, mount);
          pollForCanvas(mount, "This p5 piece did not produce a canvas for immersive mode.");
          return;
        }

        const c2Module = await import("c2.js");
        const c2 = (c2Module.default ?? c2Module) as any;
        (window as any).c2 = c2;
        const sketchFactory = resolveSketchFactory(code);
        const managedCanvas =
          (host.querySelector("canvas") as HTMLCanvasElement | null) ||
          document.createElement("canvas");
        managedCanvas.width = runtimeSize.width;
        managedCanvas.height = runtimeSize.height;
        // Clear any AI-generated inline position:fixed that would escape the host's off-screen placement
        normalizeManagedCanvasStyles(managedCanvas, runtimeSize);
        if (!managedCanvas.parentNode) {
          host.appendChild(managedCanvas);
        }
        syncCanvas(managedCanvas);

        let rafId = 0;
        const startFrame = (handler: (frameCount: number) => void) => {
          let frameCount = 0;
          function tick() {
            frameCount += 1;
            try {
              handler(frameCount);
            } catch (err) {
              onError(`Piece runtime error: ${(err as Error)?.message ?? String(err)}`);
              return;
            }
            rafId = window.requestAnimationFrame(tick);
          }
          rafId = window.requestAnimationFrame(tick);
          return () => window.cancelAnimationFrame(rafId);
        };

        const cleanup = sketchFactory({
          c2,
          canvas: managedCanvas,
          startFrame,
          size: runtimeSize,
          width: runtimeSize.width,
          height: runtimeSize.height,
        });
        stopSourceLoop =
          typeof cleanup === "function"
            ? cleanup
            : () => window.cancelAnimationFrame(rafId);
      } catch {
        onError(`This ${engine} piece could not boot for immersive mode.`);
      }
    }

    const floorNav = createFloorClickNavigation(shell.camera, shell.controls, shell.floor, stageEl);
    const keyNav = createKeyboardNavigation(shell.controls, { container: stageEl });

    function animate() {
      frameId = requestAnimationFrame(animate);
      floorNav.update();
      keyNav.update();
      const activeSourceCanvas = sourceCanvas;
      if (activeSourceCanvas && artTexture) {
        if (engine !== "p5") {
          // c2's renderer.background(c) sets canvas.style.background (CSS only, not pixels).
          // destination-over compositing paints that color behind the already-drawn shapes.
          const bg = activeSourceCanvas.style.background || activeSourceCanvas.style.backgroundColor;
          if (bg) {
            const ctx = activeSourceCanvas.getContext("2d");
            if (ctx) {
              ctx.save();
              ctx.globalCompositeOperation = "destination-over";
              ctx.fillStyle = bg;
              ctx.fillRect(0, 0, activeSourceCanvas.width, activeSourceCanvas.height);
              ctx.restore();
            }
          }
        }
        if (presentationSurface) {
          drawContainedIntoPresentationSurface(
            presentationSurface,
            activeSourceCanvas.width || runtimeSize.width,
            activeSourceCanvas.height || runtimeSize.height,
            (ctx, x, y, width, height) => {
              ctx.drawImage(activeSourceCanvas, x, y, width, height);
            },
            "#05070f",
          );
        }
        artTexture.needsUpdate = true;
      }
      shell.controls.update();
      shell.renderer.render(shell.scene, shell.camera);
    }

    bootRuntime();
    fitMountedGalleryCamera(shell, stageEl);
    animate();
    function handleResize() {
      fitMountedGalleryCamera(shell, stageEl);
    }
    window.addEventListener("resize", handleResize);
    const observer = new ResizeObserver(handleResize);
    observer.observe(stageEl);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
      if (detectCanvasTimer) {
        window.clearTimeout(detectCanvasTimer);
      }
      cancelAnimationFrame(frameId);
      artTexture?.dispose?.();
      shell.controls.dispose();
      shell.floor.geometry.dispose();
      disposeObjectMaterial(shell.floor.material);
      shell.backWall.geometry.dispose();
      disposeObjectMaterial(shell.backWall.material);
      shell.framePanel.geometry.dispose();
      disposeObjectMaterial(shell.framePanel.material);
      shell.artMesh.geometry.dispose();
      shell.artMaterial.dispose();
      shell.frameMesh.geometry.dispose();
      disposeObjectMaterial(shell.frameMesh.material);
      shell.renderer.dispose();
      stopSourceLoop?.();
      p5Instance?.remove?.();
      floorNav.dispose();
      keyNav.dispose();
      managedCanvasContainment?.dispose();
      host.remove();
      stageEl.innerHTML = "";
    };
  }, [code, cssCode, engine, htmlCode, onError]);

  return <div ref={stageRef} className="h-full w-full overflow-hidden" />;
}

function ImmersiveThreePieceStage({
  code,
  htmlCode,
  cssCode,
  title,
  onError,
  interactive = true,
}: Omit<PieceStageProps, "engine"> & { interactive?: boolean }) {
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const stageEl = stage;

    const runtimeSize: ImmersiveRuntimeSize = { ...DEFAULT_IMMERSIVE_RUNTIME_SIZE };
    const host = createImmersiveHost(
      htmlCode,
      cssCode,
      '<div id="container"></div>',
      runtimeSize,
    );
    const canvas =
      (host.querySelector("canvas") as HTMLCanvasElement | null) ||
      document.createElement("canvas");
    canvas.width = runtimeSize.width;
    canvas.height = runtimeSize.height;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.touchAction = "none";

    stageEl.innerHTML = "";
    const hostChildren = Array.from(host.childNodes).map((node) => node.cloneNode(true));
    hostChildren.forEach((child) => stageEl.appendChild(child));
    const mount =
      stageEl.querySelector("#container") ||
      stageEl.querySelector("#canvas-container") ||
      stageEl.querySelector("#sketch-container") ||
      stageEl.querySelector(":scope > div") ||
      stageEl;
    stageEl.querySelectorAll("canvas").forEach((existingCanvas) => existingCanvas.remove());
    if (canvas.parentElement !== mount) {
      mount.appendChild(canvas);
    }

    let cleanup: (() => void) | void;
    let frameId = 0;
    let stopFrameHandles = new Set<() => void>();
    const state: {
      scene: any;
      camera: any;
      renderer: any;
      objects: any[];
    } = {
      scene: null,
      camera: null,
      renderer: null,
      objects: [],
    };

    const instrumentedThree: any = { ...THREE };
    const OriginalScene = THREE.Scene;
    instrumentedThree.Scene = class extends OriginalScene {
      constructor(...args: any[]) {
        super(...args);
        state.scene = this;
      }
      add(...objects: any[]) {
        objects.forEach((object) => {
          if (object?.geometry) {
            state.objects.push(object);
          }
        });
        return super.add(...objects);
      }
    };

    const OriginalPerspectiveCamera = THREE.PerspectiveCamera;
    instrumentedThree.PerspectiveCamera = class extends OriginalPerspectiveCamera {
      constructor(...args: any[]) {
        super(...args);
        state.camera = this;
      }
    };

    if ("OrthographicCamera" in THREE) {
      const OriginalOrthographicCamera = (THREE as any).OrthographicCamera;
      instrumentedThree.OrthographicCamera = class extends OriginalOrthographicCamera {
        constructor(...args: any[]) {
          super(...args);
          state.camera = this;
        }
      };
    }

    const OriginalRenderer = THREE.WebGLRenderer;
    instrumentedThree.WebGLRenderer = class extends OriginalRenderer {
      constructor(input: any) {
        super({
          ...input,
          canvas,
        });
        state.renderer = this;
        this.setPixelRatio?.(Math.min(window.devicePixelRatio, 2));
      }
    };
    (window as any).THREE = instrumentedThree;

    function autoFitCamera(viewportWidth = stageEl.clientWidth || window.innerWidth) {
      if (!state.scene || !state.camera) {
        return;
      }
      const box = getRenderableBounds();
      if (box.isEmpty()) {
        try { box.setFromObject(state.scene); } catch { return; }
      }
      if (box.isEmpty()) {
        return;
      }
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);
      const nextView = computeThreeAutoFitView(
        center,
        size,
        state.camera.aspect || 1,
        state.camera.fov || 45,
        isCompactImmersiveViewport(viewportWidth),
      );
      state.camera.position.set(
        nextView.camera.x,
        nextView.camera.y,
        nextView.camera.z,
      );
      state.camera.lookAt(nextView.target.x, nextView.target.y, nextView.target.z);
      
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dist = state.camera.position.distanceTo(center);
      state.camera.near = Math.max(0.01, dist / 1000);
      state.camera.far = Math.max(1000, dist * 100 + maxDim * 100);
      
      state.camera.updateProjectionMatrix?.();
      state.camera.updateMatrixWorld?.(true);
      if (controls) {
        controls.target.set(nextView.target.x, nextView.target.y, nextView.target.z);
        controls.update();
        saveOrbitState();
      }
    }

    const startFrame = (handler: (frameCount: number) => void) => {
      let frameCount = 0;
      let rafId = 0;
      function tick() {
        frameCount += 1;
        handler(frameCount);
        if (frameCount === 15) {
          autoFitCamera();
        }
        rafId = window.requestAnimationFrame(tick);
      }
      rafId = window.requestAnimationFrame(tick);
      const stop = () => window.cancelAnimationFrame(rafId);
      stopFrameHandles.add(stop);
      return () => {
        stop();
        stopFrameHandles.delete(stop);
      };
    };

    let controls: OrbitControls | null = null;
    let keyNav: ReturnType<typeof createKeyboardNavigation> | null = null;
    let isOrbitActive = false;
    const _orbitCamPos = new THREE.Vector3();
    const _orbitTarget = new THREE.Vector3();

    let threeAnimFromTarget: any = null;
    let threeAnimToTarget: any = null;
    let threeAnimFromCam: any = null;
    let threeAnimToCam: any = null;
    let threeAnimStart = 0;
    let threeDownX = 0;
    let threeDownY = 0;
    let threeDownButton = 0;
    const threeRaycaster = new THREE.Raycaster();
    const _activePointerIds = new Set<number>();

    function saveOrbitState() {
      if (!controls || !state.camera) return;
      _orbitCamPos.copy(state.camera.position);
      _orbitTarget.copy(controls.target);
    }

    function cancelThreeNavigationAnimation() {
      threeAnimFromTarget = null;
      threeAnimToTarget = null;
      threeAnimFromCam = null;
      threeAnimToCam = null;
      if (controls) {
        controls.enabled = true;
      }
    }

    function reassertThreeCanvasContainment() {
      if (canvas.parentElement !== mount) {
        mount.appendChild(canvas);
      }
      if (canvas.style.position || canvas.style.zIndex || canvas.style.width !== "100%" || canvas.style.height !== "100%") {
        canvas.style.position = "";
        canvas.style.top = "";
        canvas.style.left = "";
        canvas.style.bottom = "";
        canvas.style.right = "";
        canvas.style.zIndex = "";
        canvas.style.pointerEvents = "";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
      }
      canvas.style.touchAction = "none";

      // Hide any other canvases that might have been created by the sketch
      stageEl.querySelectorAll("canvas").forEach((candidate) => {
        if (candidate !== canvas) {
          candidate.style.display = "none";
          candidate.setAttribute("aria-hidden", "true");
        }
      });

      const resolvedBg = resolveThreeBackgroundFallback();
      stageEl.style.background = typeof resolvedBg === "string" 
        ? resolvedBg 
        : `#${resolvedBg.toString(16).padStart(6, "0")}`;
    }

    function getRenderableBounds() {
      const box = new THREE.Box3();
      if (!state.scene?.traverse) return box;
      state.scene.traverse((obj: any) => {
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

    function getThreeNavigationLimit() {
      if (!state.scene || state.objects.length === 0) {
        return 5;
      }
      const box = getRenderableBounds();
      if (box.isEmpty()) {
        try {
          box.setFromObject(state.scene);
        } catch {
          return 5;
        }
      }
      if (box.isEmpty()) {
        return 5;
      }
      const size = new THREE.Vector3();
      box.getSize(size);
      return Math.max(size.x, size.z, 1) * 0.7;
    }

    function moveThreeOrbitTo(hitPoint: any) {
      if (!controls || !state.camera) return;
      const dx = hitPoint.x - controls.target.x;
      const dz = hitPoint.z - controls.target.z;
      const maxOffset = getThreeNavigationLimit();
      const shift = new THREE.Vector3(
        Math.max(-maxOffset, Math.min(maxOffset, dx)),
        0,
        Math.max(-maxOffset, Math.min(maxOffset, dz)),
      );
      if (shift.lengthSq() < 0.003) return;

      cancelThreeNavigationAnimation();
      threeAnimFromTarget = controls.target.clone();
      threeAnimToTarget = threeAnimFromTarget.clone().add(shift);
      threeAnimFromCam = state.camera.position.clone();
      threeAnimToCam = threeAnimFromCam.clone().add(shift);
      threeAnimStart = performance.now();
      controls.enabled = false;
    }

    function zoomThreeOrbit(deltaY: number) {
      if (!controls || !state.camera) return;
      cancelThreeNavigationAnimation();
      const cameraPosition = state.camera.position;
      const direction = cameraPosition.clone().sub(controls.target);
      const currentDistance = direction.length();
      if (currentDistance < 1e-6) return;
      const minDistance = controls.minDistance || 0.6;
      const maxDistance = controls.maxDistance || Math.max(40, currentDistance * 4);
      const zoomScale = Math.exp(Math.max(-1, Math.min(1, deltaY / 600)));
      const nextDistance = Math.max(minDistance, Math.min(maxDistance, currentDistance * zoomScale));
      direction.setLength(nextDistance);
      cameraPosition.copy(controls.target).add(direction);
      controls.update();
      saveOrbitState();
    }

    function onThreePointerDown(e: PointerEvent) {
      _activePointerIds.add(e.pointerId);
      threeDownButton = e.button;
      threeDownX = e.clientX;
      threeDownY = e.clientY;
    }

    function onThreePointerUp(e: PointerEvent) {
      if (!controls || !state.camera) return;
      // If more than one finger was active this gesture is a pinch — skip floor-click.
      const wasMultiTouch = _activePointerIds.size > 1;
      _activePointerIds.delete(e.pointerId);
      if (wasMultiTouch) return;
      if (threeDownButton !== 0 || e.button !== 0) return;
      if (Math.hypot(e.clientX - threeDownX, e.clientY - threeDownY) >= 6) return;

      const rect = canvas.getBoundingClientRect();
      threeRaycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        state.camera,
      );

      let hitPoint: any = null;
      if (state.scene?.children?.length) {
        const hits = threeRaycaster.intersectObjects(state.scene.children, true);
        if (hits.length > 0) {
          hitPoint = hits[0].point;
        }
      }

      const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const planeHit = new THREE.Vector3();
      if (!hitPoint && threeRaycaster.ray.intersectPlane(floorPlane, planeHit)) {
        hitPoint = planeHit;
      }

      if (!hitPoint) return;
      moveThreeOrbitTo(hitPoint);
    }

    function onThreeWheel(e: WheelEvent) {
      if (!controls || !state.camera) return;
      e.preventDefault();
      e.stopPropagation();
      zoomThreeOrbit(e.deltaY);
    }

    function resize() {
      const width = stageEl.clientWidth || window.innerWidth;
      const height = stageEl.clientHeight || window.innerHeight;
      if (state.renderer?.setSize) {
        state.renderer.setSize(width, height, false);
      }
      if (state.camera) {
        if ("aspect" in state.camera) {
          state.camera.aspect = width / Math.max(height, 1);
        }
        state.camera.updateProjectionMatrix?.();
      }
    }

    function resolveThreeBackgroundFallback() {
      return resolveImmersiveElementBackground([
        canvas,
        mount,
        stageEl.querySelector("div"),
        stageEl,
        host.querySelector("#container"),
        host,
      ]) ?? 0x000000;
    }

    function ensureThreeFallbackLighting() {
      if (!state.scene?.traverse) return;
      let hasRealLight = false;
      let hasFallback = false;
      const fallbacks: any[] = [];
      state.scene.traverse((obj: any) => {
        if (!obj.isLight) return;
        if (obj.name?.startsWith("__viewer_fallback_")) {
          hasFallback = true;
          fallbacks.push(obj);
        } else {
          hasRealLight = true;
        }
      });

      if (hasRealLight) {
        fallbacks.forEach((obj) => state.scene.remove(obj));
        return;
      }
      if (hasFallback) return;

      const amb = new THREE.AmbientLight(0xffffff, 0.7);
      amb.name = "__viewer_fallback_ambient__";
      state.scene.add(amb);

      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(5, 10, 7.5);
      dir.name = "__viewer_fallback_dir__";
      state.scene.add(dir);
    }

    function prepareThreeSceneForImmersiveRender() {
      if (!state.scene?.traverse) return;
      ensureThreeFallbackLighting();
      state.scene.traverse((object: any) => {
        object.frustumCulled = false;
        object.layers?.enableAll?.();
        if (
          (object.isMesh || object.isLine || object.isPoints || object.isSprite) &&
          object.visible === false
        ) {
          object.visible = true;
        }
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material: any) => {
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

    function prepareThreeRendererForImmersiveRender() {
      if (!state.renderer) return;
      state.renderer.autoClear = true;
      state.renderer.localClippingEnabled = false;
      if (state.renderer.shadowMap) {
        state.renderer.shadowMap.enabled = false;
      }
    }

    function animateControls() {
      frameId = requestAnimationFrame(animateControls);
      // Re-assert canvas containment — AI startFrame handlers may call document.body.appendChild or set position:fixed every frame.
      reassertThreeCanvasContainment();
      if (controls && state.camera) {
        // Restore OrbitControls camera state only when the user is not actively interacting.
        // This allows OrbitControls' native touch gesture and zooming engine to function without being overridden.
        if (!isOrbitActive) {
          state.camera.position.copy(_orbitCamPos);
          controls.target.copy(_orbitTarget);
        }
        controls.update();

        if (threeAnimToTarget && threeAnimFromTarget) {
          const t = Math.min((performance.now() - threeAnimStart) / 350, 1);
          const eased = 1 - (1 - t) ** 3;
          controls.target.lerpVectors(threeAnimFromTarget, threeAnimToTarget, eased);
          state.camera.position.lerpVectors(threeAnimFromCam, threeAnimToCam, eased);
          controls.update();
          if (t >= 1) {
            controls.enabled = true;
            threeAnimFromTarget = threeAnimToTarget = threeAnimFromCam = threeAnimToCam = null;
            saveOrbitState();
          }
        }
        keyNav?.update();

        // Save OrbitControls state; restored at top of next frame.
        saveOrbitState();
      }
      if (state.renderer && state.scene && state.camera) {
        if ("aspect" in state.camera) {
          const width = stageEl.clientWidth || window.innerWidth;
          const height = stageEl.clientHeight || window.innerHeight;
          const aspect = width / Math.max(height, 1);
          if (Math.abs(state.camera.aspect - aspect) > 0.001) {
            state.camera.aspect = aspect;
            state.camera.updateProjectionMatrix?.();
          }
        }
        prepareThreeRendererForImmersiveRender();
        prepareThreeSceneForImmersiveRender();
        syncThreeRendererBackground(
          state.renderer,
          state.scene,
          resolveThreeBackgroundFallback(),
        );
        state.renderer.render(state.scene, state.camera);
      }
    }

    try {
      const sketchFactory = resolveSketchFactory(code);
      cleanup = sketchFactory({
        THREE: instrumentedThree,
        canvas,
        startFrame,
        size: runtimeSize,
        width: runtimeSize.width,
        height: runtimeSize.height,
      });

      if (!state.renderer || !state.camera) {
        throw new Error("This Three.js piece did not initialize a renderer and camera for immersive mode.");
      }

      // Boilerplate Three.js code commonly calls document.body.appendChild(renderer.domElement)
      // or sets position:fixed on the canvas. Because renderer.domElement IS our injected canvas,
      // either action pulls it out of stageEl and overlays the page header, blocking Back and other
      // shell controls. Re-assert containment before resize() so the stage dimensions are correct.
      reassertThreeCanvasContainment();

      resize();
      if (interactive) {
        controls = new OrbitControls(state.camera, canvas);
        controls.enableDamping = true;
        controls.enablePan = true;
        controls.minDistance = 0.6;
        const _initDir = new THREE.Vector3();
        state.camera.getWorldDirection(_initDir);
        const initialCamDist = state.camera.position.length();
        const targetDist = Math.max(initialCamDist * 0.8, 3);
        controls.target.copy(state.camera.position).addScaledVector(_initDir, targetDist);
        const initialTargetDist = state.camera.position.distanceTo(controls.target);
        controls.maxDistance = Math.max(40, initialTargetDist * 4);
        controls.update();
        keyNav = createKeyboardNavigation(controls, {
          container: stageEl,
          speed: (activeControls) => Math.max(0.05, activeControls.target.distanceTo(activeControls.object.position) * 0.03),
        });
        _orbitCamPos.copy(state.camera.position);
        _orbitTarget.copy(controls.target);
        canvas.addEventListener("pointerdown", onThreePointerDown);
        canvas.addEventListener("pointerup", onThreePointerUp);
        canvas.addEventListener("wheel", onThreeWheel, { passive: false, capture: true });

        // Standardize touch zoom behavior to match other immersive stages.
        // Listen to OrbitControls active user interactions to bypass frame coordinate resets.
        controls.addEventListener("start", () => {
          isOrbitActive = true;
        });
        controls.addEventListener("end", () => {
          isOrbitActive = false;
          saveOrbitState();
        });
      } else {
        canvas.style.pointerEvents = "none";
      }
      animateControls();
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Immersive runtime failed to boot.");
    }

    const observer = new ResizeObserver(resize);
    observer.observe(stageEl);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
      canvas.removeEventListener("pointerdown", onThreePointerDown);
      canvas.removeEventListener("pointerup", onThreePointerUp);
      canvas.removeEventListener("wheel", onThreeWheel, { capture: true });
      keyNav?.dispose();
      _activePointerIds.clear();
      if (controls) controls.enabled = true;
      controls?.dispose();
      stopFrameHandles.forEach((stop) => stop());
      stopFrameHandles.clear();
      cleanup?.();
      state.renderer?.dispose?.();
      host.remove();
      // Remove canvas from the document regardless of where piece code moved it.
      // React removes the fullscreen subtree before this cleanup runs, so if the
      // piece code (synchronously or asynchronously) moved the canvas to document.body
      // after our re-containment, it is NOT part of the removed subtree and would
      // persist — covering the header and blocking the Back button.
      canvas.remove();
      stageEl.innerHTML = "";
    };
  }, [code, cssCode, htmlCode, interactive, onError, title]);

  return <div ref={stageRef} className="h-full w-full overflow-hidden" />;
}

function formatEngineLabel(engine: EmbeddedArtPiece["version"]["engine"]) {
  if (engine === "p5") {
    return "P5.js";
  }
  if (engine === "c2") {
    return "C2.js";
  }
  return "Three.js";
}

export default function ImmersivePiecePage() {
  const [, params] = useRoute("/immersive/pieces/:id");
  const goBack = useReturnToPrevious();
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pieceId = Number(params?.id);
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const versionRaw = searchParams.get("version");
  const versionId = versionRaw ? Number(versionRaw) : undefined;
  const isEmbedMode = searchParams.get("embed") === "1";
  const isStaticEmbed = searchParams.get("static") === "1";

  const canonicalHref = useMemo(
    () => `${window.location.origin}${buildImmersivePieceHref(pieceId, versionId)}`,
    [pieceId, versionId],
  );

  const { data, isLoading, error } = useGetEmbeddedArtPiece(
    pieceId,
    versionId ? { version: versionId } : undefined,
    {
      query: {
        queryKey: getGetEmbeddedArtPieceQueryKey(
          pieceId,
          versionId ? { version: versionId } : undefined,
        ),
        enabled: Number.isFinite(pieceId) && pieceId > 0,
      },
    },
  );

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isFullscreen) {
          setIsFullscreen(false);
          return;
        }
        goBack();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goBack, isFullscreen]);

  const title = useMemo(() => data?.title || "Immersive piece", [data?.title]);

  if (isLoading || !data?.version) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050b16] px-6 text-sm text-white/60">
        Loading immersive scene…
      </div>
    );
  }

  if (!Number.isFinite(pieceId) || pieceId <= 0 || error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050b16] px-6 text-white">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Piece not found</h1>
          <p className="mt-3 text-sm text-white/70">
            The immersive route could not load this piece.
          </p>
          <button
            type="button"
            onClick={goBack}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>
      </div>
    );
  }

  const isThree = data.version.engine === "three";
  const engineLabel = formatEngineLabel(data.version.engine);

  const plainEmbedCode = `<iframe src="${window.location.origin}/embed/pieces/${pieceId}${versionId ? `?version=${versionId}` : ""}" width="100%" style="width:100%;aspect-ratio:16 / 9;display:block;" title="${title.replace(/"/g, "&quot;")}" frameborder="0" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>`;
  const galleryEmbedCode = buildPieceGalleryEmbedHtml(pieceId, versionId, title, window.location.origin);

  return (
    <ImmersiveRouteShell
      title={title}
      onBack={goBack}
      isFullscreen={isFullscreen}
      isEmbedMode={isEmbedMode}
      showEmbedFullscreenControl={!isStaticEmbed}
      canonicalHref={canonicalHref}
      embedCodes={{
        plain: { label: "Embed Piece", code: plainEmbedCode },
        gallery: { label: "Embed Interactive", code: galleryEmbedCode },
      }}
      onToggleFullscreen={() => setIsFullscreen((current) => !current)}
      metadataCard={
        <ImmersiveMetadataCard
          title={title}
          description={
            isThree
              ? "This Three.js piece now runs directly in a live immersive 3D canvas with viewer-managed camera controls."
              : `This ${engineLabel} piece uses the browser-based non-Three immersive gallery scene with a normalized presentation surface and centered default framing.`
          }
          fields={[
            {
              label: "Engine",
              value: engineLabel,
            },
            ...(versionId
              ? [
                  {
                    label: "Version",
                    value: `Version ${versionId}`,
                  },
                ]
              : []),
            {
              label: "Interaction",
              value: "Drag to orbit, scroll to zoom, right-drag or modifier-drag to pan.",
            },
            {
              label: "Alt text",
              value: data.version.prompt,
            },
            {
              label: "Source",
              value: (
                <span className="break-all text-white/60">
                  {`${window.location.origin}/embed/pieces/${pieceId}${versionId ? `?version=${versionId}` : ""}`}
                </span>
              ),
            },
            ...(runtimeError
              ? [
                  {
                    label: "Fallback",
                    value: runtimeError,
                    tone: "warning" as const,
                  },
                ]
              : []),
          ]}
        />
      }
      renderScene={({ fullscreen }) =>
        runtimeError ? (
          <div className="h-full overflow-auto p-4">
            <div className="mb-4 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
              <p className="font-medium">Immersive mode unavailable for this piece.</p>
              <p className="mt-1 text-amber-100/80">{runtimeError}</p>
            </div>
            <ArtPieceRenderer
              engine={data.version.engine}
              code={data.version.generatedCode}
              htmlCode={data.version.htmlCode}
              cssCode={data.version.cssCode}
              title={title}
              height={fullscreen ? 720 : 520}
            />
          </div>
        ) : isThree ? (
          <ImmersiveThreePieceStage
            code={data.version.generatedCode}
            htmlCode={data.version.htmlCode}
            cssCode={data.version.cssCode}
            title={title}
            onError={setRuntimeError}
            interactive={!isStaticEmbed}
          />
        ) : (
          <ImmersiveGalleryPieceStage
            engine={data.version.engine}
            code={data.version.generatedCode}
            htmlCode={data.version.htmlCode}
            cssCode={data.version.cssCode}
            title={title}
            onError={setRuntimeError}
          />
        )
      }
    />
  );
}

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
    let mcStyleObserver: MutationObserver | null = null;
    let mcBodyObserver: MutationObserver | null = null;
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
      if (!artTexture) {
        artTexture = new THREE.CanvasTexture(displayCanvas);
        artTexture.colorSpace = THREE.SRGBColorSpace;
        shell.artMaterial.map = artTexture;
        shell.artMaterial.needsUpdate = true;
      }
      if (presentationSurface) {
        drawContainedIntoPresentationSurface(
          presentationSurface,
          nextCanvas.width || runtimeSize.width,
          nextCanvas.height || runtimeSize.height,
          (ctx, x, y, width, height) => {
            ctx.drawImage(nextCanvas, x, y, width, height);
          },
          "#05070f",
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
        managedCanvas.style.position = "";
        managedCanvas.style.top = "";
        managedCanvas.style.left = "";
        managedCanvas.style.bottom = "";
        managedCanvas.style.right = "";
        managedCanvas.style.zIndex = "";
        managedCanvas.style.width = `${runtimeSize.width}px`;
        managedCanvas.style.height = `${runtimeSize.height}px`;
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

        // MutationObserver fires as microtask after each RAF callback but before browser paint —
        // clears any position:fixed the sketch sets before it becomes visible.
        const mc = managedCanvas;
        mcStyleObserver = new MutationObserver(() => {
          if (mc.style.position || mc.style.zIndex || mc.style.top || mc.style.left || mc.style.right || mc.style.bottom) {
            mc.style.position = "";
            mc.style.top = "";
            mc.style.left = "";
            mc.style.bottom = "";
            mc.style.right = "";
            mc.style.zIndex = "";
            mc.style.pointerEvents = "";
            mc.style.width = `${runtimeSize.width}px`;
            mc.style.height = `${runtimeSize.height}px`;
          }
        });
        mcStyleObserver.observe(mc, { attributes: true, attributeFilter: ["style"] });

        // If sketch code moves managedCanvas to document.body, pull it back into host.
        mcBodyObserver = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node === mc) host.appendChild(mc);
            }
          }
        });
        mcBodyObserver.observe(document.body, { childList: true });

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
      mcStyleObserver?.disconnect();
      mcBodyObserver?.disconnect();
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
}: Omit<PieceStageProps, "engine">) {
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

    const mount =
      host.querySelector("#container") ||
      host.querySelector("#canvas-container") ||
      host.querySelector("#sketch-container") ||
      host;
    if (!canvas.parentNode) {
      mount.appendChild(canvas);
    }

    stageEl.innerHTML = "";
    stageEl.appendChild(canvas);

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

    const startFrame = (handler: (frameCount: number) => void) => {
      let frameCount = 0;
      let rafId = 0;
      function tick() {
        frameCount += 1;
        handler(frameCount);
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
    const threeKeys = new Set<string>();
    const _threeFwd = new THREE.Vector3();
    const _threeRight = new THREE.Vector3();

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
      if (canvas.parentElement !== stageEl) {
        stageEl.appendChild(canvas);
      }
      if (canvas.style.position || canvas.style.zIndex) {
        canvas.style.position = "";
        canvas.style.top = "";
        canvas.style.left = "";
        canvas.style.bottom = "";
        canvas.style.right = "";
        canvas.style.zIndex = "";
        canvas.style.pointerEvents = "";
      }
      canvas.style.touchAction = "none";
    }

    function getThreeNavigationLimit() {
      if (!state.scene || state.objects.length === 0) {
        return 5;
      }
      const box = new THREE.Box3().setFromObject(state.scene);
      if (box.isEmpty()) {
        return 5;
      }
      const size = new THREE.Vector3();
      box.getSize(size);
      return Math.max(size.x, size.z, 1) * 0.7;
    }

    function panThreeOrbitBy(dx: number, dz: number) {
      if (!controls || !state.camera) return;
      const maxOffset = getThreeNavigationLimit();
      const clampedDx = Math.max(-maxOffset, Math.min(maxOffset, dx));
      const clampedDz = Math.max(-maxOffset, Math.min(maxOffset, dz));
      if (Math.abs(clampedDx) < 1e-6 && Math.abs(clampedDz) < 1e-6) return;
      controls.target.x += clampedDx;
      controls.target.z += clampedDz;
      state.camera.position.x += clampedDx;
      state.camera.position.z += clampedDz;
      controls.update();
      saveOrbitState();
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

    function onThreeKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        threeKeys.add(e.key);
      }
    }

    function onThreeKeyUp(e: KeyboardEvent) {
      threeKeys.delete(e.key);
    }

    function onThreePointerDown(e: PointerEvent) {
      threeDownButton = e.button;
      threeDownX = e.clientX;
      threeDownY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
    }

    function onThreePointerUp(e: PointerEvent) {
      if (!controls || !state.camera) return;
      canvas.releasePointerCapture?.(e.pointerId);
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

    function onThreeStageClick() {
      stageEl.focus();
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

    function autoFitCamera(viewportWidth = stageEl.clientWidth || window.innerWidth) {
      if (!state.scene || !state.camera || state.objects.length === 0) {
        return;
      }
      state.objects.forEach((object) => {
        object.geometry?.computeBoundingBox?.();
      });
      const box = new THREE.Box3().setFromObject(state.scene);
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
      state.camera.updateProjectionMatrix?.();
      state.camera.updateMatrixWorld?.(true);
      controls?.target.set?.(nextView.target.x, nextView.target.y, nextView.target.z);
      controls?.update();
    }

    function animateControls() {
      frameId = requestAnimationFrame(animateControls);
      // Re-assert canvas containment — AI startFrame handlers may call document.body.appendChild or set position:fixed every frame.
      reassertThreeCanvasContainment();
      if (controls && state.camera) {
        // Restore OrbitControls camera state, overriding any camera changes made
        // by the piece's startFrame handler (which fires first every RAF).
        state.camera.position.copy(_orbitCamPos);
        controls.target.copy(_orbitTarget);
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
        } else if (threeKeys.size > 0) {
          const speed = Math.max(0.05, controls.target.distanceTo(state.camera.position) * 0.03);
          let fwdScale = 0;
          let rightScale = 0;
          if (threeKeys.has("ArrowUp")) fwdScale += speed;
          if (threeKeys.has("ArrowDown")) fwdScale -= speed;
          if (threeKeys.has("ArrowLeft")) rightScale -= speed;
          if (threeKeys.has("ArrowRight")) rightScale += speed;
          if (fwdScale !== 0 || rightScale !== 0) {
            state.camera.getWorldDirection(_threeFwd);
            _threeFwd.y = 0;
            const len = _threeFwd.length();
            if (len > 1e-6) {
              _threeFwd.divideScalar(len);
              _threeRight.set(-_threeFwd.z, 0, _threeFwd.x);
              const dx = _threeFwd.x * fwdScale + _threeRight.x * rightScale;
              const dz = _threeFwd.z * fwdScale + _threeRight.z * rightScale;
              panThreeOrbitBy(dx, dz);
            }
          }
        }

        // Save OrbitControls state; restored at top of next frame.
        saveOrbitState();
      }
      if (state.renderer && state.scene && state.camera) {
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
      stageEl.innerHTML = "";
      stageEl.appendChild(canvas);
      canvas.style.position = "";
      canvas.style.top = "";
      canvas.style.left = "";
      canvas.style.bottom = "";
      canvas.style.right = "";
      canvas.style.zIndex = "";
      canvas.style.pointerEvents = "";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.touchAction = "none";

      resize();
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
      _orbitCamPos.copy(state.camera.position);
      _orbitTarget.copy(controls.target);
      animateControls();
      canvas.addEventListener("pointerdown", onThreePointerDown);
      canvas.addEventListener("pointerup", onThreePointerUp);
      canvas.addEventListener("wheel", onThreeWheel, { passive: false, capture: true });
      stageEl.tabIndex = 0;
      window.addEventListener("keydown", onThreeKeyDown);
      window.addEventListener("keyup", onThreeKeyUp);
      stageEl.addEventListener("click", onThreeStageClick, { passive: true } as AddEventListenerOptions);
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
      window.removeEventListener("keydown", onThreeKeyDown);
      window.removeEventListener("keyup", onThreeKeyUp);
      stageEl.removeEventListener("click", onThreeStageClick);
      threeKeys.clear();
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
  }, [code, cssCode, htmlCode, onError, title]);

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

  const plainEmbedCode = `<iframe src="${window.location.origin}/embed/pieces/${pieceId}${versionId ? `?version=${versionId}` : ""}" width="100%" height="480" title="${title.replace(/"/g, "&quot;")}" frameborder="0" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>`;
  const galleryEmbedCode = buildPieceGalleryEmbedHtml(pieceId, versionId, title, window.location.origin);

  return (
    <ImmersiveRouteShell
      title={title}
      onBack={goBack}
      isFullscreen={isFullscreen}
      isEmbedMode={isEmbedMode}
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

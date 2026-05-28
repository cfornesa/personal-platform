import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const WALL_CENTER = new THREE.Vector3(0, 1.35, -1.08);
const TARGET_OFFSET = new THREE.Vector3(0, -0.16, 0);
const MAX_ART_WIDTH = 6.4;
const MAX_ART_HEIGHT = 4.6;
const PRESENTATION_MAX_ART_WIDTH = 5.2;
const PRESENTATION_MAX_ART_HEIGHT = 3.9;

export type MountedGalleryProfile = {
  maxArtWidth?: number;
  maxArtHeight?: number;
  framingMultiplier?: number;
  targetOffset?: { x: number; y: number; z: number };
  cameraYOffset?: number;
};

export const NORMALIZED_PRESENTATION_GALLERY_PROFILE: MountedGalleryProfile = {
  maxArtWidth: PRESENTATION_MAX_ART_WIDTH,
  maxArtHeight: PRESENTATION_MAX_ART_HEIGHT,
  framingMultiplier: 1.58,
  targetOffset: { x: 0, y: 0, z: 0 },
  cameraYOffset: 0.02,
};

export type MountedArtworkLayout = {
  width: number;
  height: number;
  aspect: number;
};

export type MountedGalleryShell = {
  canvas: HTMLCanvasElement;
  renderer: any;
  scene: any;
  camera: any;
  controls: OrbitControls;
  floor: any;
  backWall: any;
  framePanel: any;
  artMesh: any;
  artMaterial: any;
  frameMesh: any;
  layout: MountedArtworkLayout;
  profile: MountedGalleryProfile;
};

export type PresentationSurface = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  padding: number;
};

export function computeMountedArtworkLayout(
  aspect: number,
  profile: MountedGalleryProfile = {},
): MountedArtworkLayout {
  const safeAspect = Math.max(aspect, 0.35);
  const maxArtWidth = profile.maxArtWidth ?? MAX_ART_WIDTH;
  const maxArtHeight = profile.maxArtHeight ?? MAX_ART_HEIGHT;
  let width = maxArtWidth;
  let height = width / safeAspect;
  if (height > maxArtHeight) {
    height = maxArtHeight;
    width = height * safeAspect;
  }
  return {
    width,
    height,
    aspect: safeAspect,
  };
}

export function createMountedGalleryShell(
  stage: HTMLDivElement,
  aspect: number,
  profile: MountedGalleryProfile = {},
): MountedGalleryShell {
  const layout = computeMountedArtworkLayout(aspect, profile);
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.innerHTML = "";
  stage.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f1ece2");
  scene.fog = new THREE.Fog("#f1ece2", 13, 34);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.minPolarAngle = 0.01;
  controls.maxPolarAngle = Math.PI - 0.01;

  scene.add(new THREE.AmbientLight(0xffffff, 1.38));

  const keyLight = new THREE.DirectionalLight(0xfffcf6, 0.9);
  keyLight.position.set(0.8, 4.8, 5.2);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xf3ede2, 0.35);
  fillLight.position.set(-3.1, 2.4, 1.8);
  scene.add(fillLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 18),
    new THREE.MeshStandardMaterial({
      color: "#d7d0c4",
      roughness: 0.98,
      metalness: 0,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 1.9);
  scene.add(floor);

  const backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 11),
    new THREE.MeshStandardMaterial({
      color: "#f8f5ee",
      roughness: 1,
      metalness: 0,
    }),
  );
  backWall.position.set(0, 2.7, -1.35);
  scene.add(backWall);

  const framePanel = new THREE.Mesh(
    new THREE.BoxGeometry(layout.width + 0.3, layout.height + 0.3, 0.05),
    new THREE.MeshStandardMaterial({
      color: "#fcfaf6",
      roughness: 0.96,
      metalness: 0,
    }),
  );
  framePanel.position.set(WALL_CENTER.x, WALL_CENTER.y, -1.16);
  scene.add(framePanel);

  const artMaterial = new THREE.MeshBasicMaterial({
    color: "#ffffff",
  });
  const artMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(layout.width, layout.height),
    artMaterial,
  );
  artMesh.position.copy(WALL_CENTER);
  scene.add(artMesh);

  const frameMesh = new THREE.Mesh(
    new THREE.BoxGeometry(layout.width + 0.12, layout.height + 0.12, 0.03),
    new THREE.MeshStandardMaterial({
      color: "#d8d1c7",
      roughness: 0.92,
      metalness: 0,
    }),
  );
  frameMesh.position.set(WALL_CENTER.x, WALL_CENTER.y, -1.12);
  scene.add(frameMesh);

  const shell = {
    canvas,
    renderer,
    scene,
    camera,
    controls,
    floor,
    backWall,
    framePanel,
    artMesh,
    artMaterial,
    frameMesh,
    layout,
    profile,
  };
  fitMountedGalleryCamera(shell, stage);
  return shell;
}

export function updateMountedGalleryLayout(
  shell: MountedGalleryShell,
  aspect: number,
) {
  const layout = computeMountedArtworkLayout(aspect, shell.profile);
  shell.layout = layout;
  shell.artMesh.geometry.dispose();
  shell.artMesh.geometry = new THREE.PlaneGeometry(layout.width, layout.height);
  shell.frameMesh.geometry.dispose();
  shell.frameMesh.geometry = new THREE.BoxGeometry(layout.width + 0.12, layout.height + 0.12, 0.03);
  shell.framePanel.geometry.dispose();
  shell.framePanel.geometry = new THREE.BoxGeometry(layout.width + 0.3, layout.height + 0.3, 0.05);
}

export function fitMountedGalleryCamera(
  shell: MountedGalleryShell,
  stage: HTMLDivElement,
  framingMultiplier = shell.profile.framingMultiplier ?? 1.28,
) {
  const width = stage.clientWidth || window.innerWidth;
  const height = stage.clientHeight || window.innerHeight;
  shell.camera.aspect = width / Math.max(height, 1);
  shell.camera.updateProjectionMatrix();
  shell.renderer.setSize(width, height, false);

  const targetOffset = shell.profile.targetOffset
    ? new THREE.Vector3(
        shell.profile.targetOffset.x,
        shell.profile.targetOffset.y,
        shell.profile.targetOffset.z,
      )
    : TARGET_OFFSET;
  const target = WALL_CENTER.clone().add(targetOffset);
  const verticalFov = THREE.MathUtils.degToRad(shell.camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * shell.camera.aspect);
  const distanceForHeight = (shell.layout.height / 2) / Math.tan(verticalFov / 2);
  const distanceForWidth = (shell.layout.width / 2) / Math.tan(horizontalFov / 2);
  const distance = Math.max(distanceForHeight, distanceForWidth) * framingMultiplier;

  shell.camera.position.set(
    WALL_CENTER.x,
    WALL_CENTER.y + (shell.profile.cameraYOffset ?? 0.2),
    WALL_CENTER.z + distance,
  );
  shell.camera.lookAt(target);
  shell.controls.target.copy(target);
  shell.controls.minDistance = Math.max(1.25, distance * 0.34);
  shell.controls.maxDistance = Math.max(18, distance * 5.5);
  shell.controls.minPolarAngle = 0.01;
  shell.controls.maxPolarAngle = Math.PI - 0.01;
  shell.controls.update();
}

export function createPresentationSurface(
  width: number,
  height: number,
  padding = 48,
): PresentationSurface {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Presentation surface could not create a 2D context.");
  }
  return {
    canvas,
    context,
    width,
    height,
    padding,
  };
}

export function drawContainedIntoPresentationSurface(
  surface: PresentationSurface,
  sourceWidth: number,
  sourceHeight: number,
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => void,
  background = "#f8f5ee",
) {
  const ctx = surface.context;
  ctx.save();
  ctx.clearRect(0, 0, surface.width, surface.height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, surface.width, surface.height);

  const availableWidth = Math.max(surface.width - (surface.padding * 2), 1);
  const availableHeight = Math.max(surface.height - (surface.padding * 2), 1);
  const aspect = sourceWidth / Math.max(sourceHeight, 1);
  let drawWidth = availableWidth;
  let drawHeight = drawWidth / Math.max(aspect, 0.0001);
  if (drawHeight > availableHeight) {
    drawHeight = availableHeight;
    drawWidth = drawHeight * aspect;
  }
  const x = (surface.width - drawWidth) / 2;
  const y = (surface.height - drawHeight) / 2;
  draw(ctx, x, y, drawWidth, drawHeight);
  ctx.restore();
}

export function disposeObjectMaterial(material: unknown) {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry?.dispose?.());
    return;
  }
  material && (material as { dispose?: () => void }).dispose?.();
}

export function isCompactImmersiveViewport(width: number) {
  return width < 1024;
}

export type FloorClickNavigation = {
  update: () => void;
  dispose: () => void;
};

export function createFloorClickNavigation(
  camera: any,
  controls: OrbitControls,
  floorMesh: any,
  domElement: HTMLElement,
  options: {
    minZ?: number;
    maxZ?: number;
    maxX?: number;
    duration?: number;
  } = {},
): FloorClickNavigation {
  const { minZ = 0.5, maxZ = 8, maxX = 8, duration = 350 } = options;

  const raycaster = new THREE.Raycaster();
  let animFromTarget: any = null;
  let animToTarget: any = null;
  let animFromCam: any = null;
  let animToCam: any = null;
  let animStart = 0;
  let downX = 0;
  let downY = 0;

  function onPointerDown(e: PointerEvent) {
    downX = e.clientX;
    downY = e.clientY;
  }

  function onPointerUp(e: PointerEvent) {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) >= 6) return;

    const rect = domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hits = raycaster.intersectObject(floorMesh, false);
    if (!hits.length) return;

    const hit = hits[0].point;
    const shift = new THREE.Vector3(
      Math.max(-maxX, Math.min(maxX, hit.x)) - camera.position.x,
      0,
      Math.max(minZ, Math.min(maxZ, hit.z)) - camera.position.z,
    );
    if (shift.lengthSq() < 0.003) return;

    animFromTarget = controls.target.clone();
    animToTarget = animFromTarget.clone().add(shift);
    animFromCam = camera.position.clone();
    animToCam = animFromCam.clone().add(shift);
    animStart = performance.now();
    controls.enabled = false;
  }

  function update() {
    if (!animFromTarget || !animToTarget) return;
    const t = Math.min((performance.now() - animStart) / duration, 1);
    const eased = 1 - (1 - t) ** 3;
    controls.target.lerpVectors(animFromTarget, animToTarget, eased);
    camera.position.lerpVectors(animFromCam, animToCam, eased);
    controls.update();
    if (t >= 1) {
      controls.enabled = true;
      animFromTarget = animToTarget = animFromCam = animToCam = null;
    }
  }

  function dispose() {
    domElement.removeEventListener("pointerdown", onPointerDown);
    domElement.removeEventListener("pointerup", onPointerUp);
    controls.enabled = true;
  }

  domElement.addEventListener("pointerdown", onPointerDown);
  domElement.addEventListener("pointerup", onPointerUp);
  return { update, dispose };
}

export type KeyboardNavigation = {
  update: () => void;
  dispose: () => void;
};

export type OrbitKeyboardMotion = {
  dx: number;
  dy: number;
  dz: number;
};

export function computeOrbitKeyboardMotion(
  forward: { x: number; y: number; z: number },
  keys: Iterable<string>,
  speed: number,
): OrbitKeyboardMotion {
  const activeKeys = keys instanceof Set ? keys : new Set(keys);
  let fwdScale = 0;
  let rightScale = 0;
  if (activeKeys.has("ArrowUp")) fwdScale += speed;
  if (activeKeys.has("ArrowDown")) fwdScale -= speed;
  if (activeKeys.has("ArrowLeft")) rightScale -= speed;
  if (activeKeys.has("ArrowRight")) rightScale += speed;
  if (fwdScale === 0 && rightScale === 0) {
    return { dx: 0, dy: 0, dz: 0 };
  }

  const horizontalLength = Math.sqrt(forward.x ** 2 + forward.z ** 2);
  const right =
    horizontalLength > 1e-6
      ? { x: -forward.z / horizontalLength, y: 0, z: forward.x / horizontalLength }
      : { x: 1, y: 0, z: 0 };

  return {
    dx: (forward.x * fwdScale) + (right.x * rightScale),
    dy: forward.y * fwdScale,
    dz: (forward.z * fwdScale) + (right.z * rightScale),
  };
}

export function syncThreeRendererBackground(
  renderer: {
    setClearAlpha?: (alpha: number) => void;
    setClearColor?: (color: unknown, alpha?: number) => void;
  } | null | undefined,
  scene: { background?: unknown } | null | undefined,
  fallbackColor?: string | number | null,
) {
  if (!renderer?.setClearColor) {
    return;
  }

  const background = scene?.background;
  if (background) {
    renderer.setClearColor(background, 1);
    renderer.setClearAlpha?.(1);
    return;
  }

  if (fallbackColor != null) {
    renderer.setClearColor(fallbackColor, 1);
    renderer.setClearAlpha?.(1);
    return;
  }

  renderer.setClearAlpha?.(0);
}

export function createKeyboardNavigation(
  controls: OrbitControls,
  options: {
    speed?: number | ((controls: OrbitControls) => number);
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
    minZ?: number;
    maxZ?: number;
    container?: HTMLElement;
  } = {},
): KeyboardNavigation {
  const { speed = 0.05, minX = -8, maxX = 8, minY = -Infinity, maxY = Infinity, minZ = 0.5, maxZ = Infinity, container } = options;
  const keys = new Set<string>();

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      keys.add(e.key);
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.key);
  }

  const _fwd = new THREE.Vector3();

  function update() {
    if (!controls.enabled || keys.size === 0) return;
    controls.object.getWorldDirection(_fwd);
    const resolvedSpeed = typeof speed === "function" ? speed(controls) : speed;
    const { dx, dy, dz } = computeOrbitKeyboardMotion(_fwd, keys, resolvedSpeed);
    const newCamX = Math.max(minX, Math.min(maxX, controls.object.position.x + dx));
    const newCamY = Math.max(minY, Math.min(maxY, controls.object.position.y + dy));
    const newCamZ = Math.max(minZ, Math.min(maxZ, controls.object.position.z + dz));
    const actualDx = newCamX - controls.object.position.x;
    const actualDy = newCamY - controls.object.position.y;
    const actualDz = newCamZ - controls.object.position.z;
    if (Math.abs(actualDx) < 1e-6 && Math.abs(actualDy) < 1e-6 && Math.abs(actualDz) < 1e-6) return;
    controls.object.position.x = newCamX;
    controls.object.position.y = newCamY;
    controls.object.position.z = newCamZ;
    controls.target.x += actualDx;
    controls.target.y += actualDy;
    controls.target.z += actualDz;
    // No controls.update() here — the main animate loop calls it once per frame.
    // Calling it here too would double-process sphericalDelta.
  }

  function onContainerClick() { container?.focus(); }
  if (container) {
    container.tabIndex = 0;
    container.addEventListener("click", onContainerClick, { passive: true });
  }
  const target: EventTarget = container ?? window;

  function dispose() {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    if (container) container.removeEventListener("click", onContainerClick);
    keys.clear();
  }

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  return { update, dispose };
}

const WALL_FRAME_ART_WIDTH = 2.2;
const WALL_FRAME_ART_HEIGHT = 1.65;
const WALL_FRAME_SLOT_WIDTH = 3.2;
const WALL_FRAME_SLOT_HEIGHT = 2.4;
const WALL_LABEL_HEIGHT = WALL_FRAME_ART_WIDTH * (80 / 512);
const WALL_LABEL_GAP = 0.08;
const EXHIBIT_FLOOR_CLEARANCE = 0.2;

export type ExhibitFrameSlot = {
  artMesh: any;
  artMaterial: any;
  frameMesh: any;
  framePanel: any;
  labelMesh?: any;
  labelMaterial?: any;
};

export type ExhibitWallShell = {
  canvas: HTMLCanvasElement;
  renderer: any;
  scene: any;
  camera: any;
  controls: OrbitControls;
  floor: any;
  backWall: any;
  slots: ExhibitFrameSlot[];
  gridRows: number;
  gridCols: number;
  gridCenterY: number;
};

export function computeExhibitGridCenterY(rows: number) {
  const gridRows = Math.max(1, rows);
  const minBottomSlotCenterY =
    (WALL_FRAME_ART_HEIGHT / 2)
    + (WALL_LABEL_HEIGHT / 2)
    + WALL_LABEL_GAP
    + EXHIBIT_FLOOR_CLEARANCE;
  return Math.max(
    WALL_CENTER.y,
    ((gridRows - 1) / 2) * WALL_FRAME_SLOT_HEIGHT + minBottomSlotCenterY,
  );
}

export function computeExhibitBottomVisibleY(rows: number) {
  const gridRows = Math.max(1, rows);
  const gridCenterY = computeExhibitGridCenterY(gridRows);
  const bottomSlotCenterY =
    gridCenterY - (((gridRows - 1) / 2) * WALL_FRAME_SLOT_HEIGHT);
  return bottomSlotCenterY
    - (WALL_FRAME_ART_HEIGHT / 2)
    - (WALL_LABEL_HEIGHT / 2)
    - WALL_LABEL_GAP;
}

function createFrameLabel(title: string, subtitle: string): { mesh: any; material: any } {
  const cw = 512;
  const ch = 80;
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.fillRect(0, 0, cw, ch);
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  ctx.font = "bold 22px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(title.slice(0, 38), 16, ch * 0.38);
  ctx.fillStyle = "rgba(0,0,0,0.52)";
  ctx.font = "16px sans-serif";
  ctx.fillText(subtitle.slice(0, 42), 16, ch * 0.72);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const labelHeight = WALL_LABEL_HEIGHT;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WALL_FRAME_ART_WIDTH, labelHeight), material);
  return { mesh, material };
}

export function createMultiFrameExhibitWall(
  stage: HTMLDivElement,
  frameCount: number,
  rows = 1,
  cols = frameCount,
  labels?: Array<{ title: string; subtitle: string } | null>,
): ExhibitWallShell {
  const n = Math.max(1, frameCount);
  const gridRows = Math.max(1, rows);
  const gridCols = Math.max(1, cols);

  const wallWidth = Math.max(22, gridCols * WALL_FRAME_SLOT_WIDTH + 2);
  const wallMeshHeight = Math.max(11, gridRows * WALL_FRAME_SLOT_HEIGHT + 5);
  const gridCenterY = computeExhibitGridCenterY(gridRows);

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.innerHTML = "";
  stage.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f1ece2");
  scene.fog = new THREE.Fog("#f1ece2", Math.max(20, wallWidth + 4), Math.max(40, wallWidth * 3));

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.minPolarAngle = 0.01;
  controls.maxPolarAngle = Math.PI - 0.01;

  scene.add(new THREE.AmbientLight(0xffffff, 1.38));
  const keyLight = new THREE.DirectionalLight(0xfffcf6, 0.9);
  keyLight.position.set(0.8, 4.8, 5.2);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xf3ede2, 0.35);
  fillLight.position.set(-3.1, 2.4, 1.8);
  scene.add(fillLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(wallWidth + 8, 18),
    new THREE.MeshStandardMaterial({ color: "#d7d0c4", roughness: 0.98, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 1.9);
  scene.add(floor);

  const backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(wallWidth + 4, wallMeshHeight),
    new THREE.MeshStandardMaterial({ color: "#f8f5ee", roughness: 1, metalness: 0 }),
  );
  backWall.position.set(0, gridCenterY, -1.35);
  scene.add(backWall);

  const wallCenterZ = WALL_CENTER.z;
  const slots: ExhibitFrameSlot[] = [];
  const labelHeight = WALL_LABEL_HEIGHT;

  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / gridCols);
    const col = i % gridCols;
    const slotX = (col - (gridCols - 1) / 2) * WALL_FRAME_SLOT_WIDTH;
    const slotY = gridCenterY + ((gridRows - 1) / 2 - row) * WALL_FRAME_SLOT_HEIGHT;

    const framePanel = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_FRAME_ART_WIDTH + 0.3, WALL_FRAME_ART_HEIGHT + 0.3, 0.05),
      new THREE.MeshStandardMaterial({ color: "#fcfaf6", roughness: 0.96, metalness: 0 }),
    );
    framePanel.position.set(slotX, slotY, -1.16);
    scene.add(framePanel);

    const artMaterial = new THREE.MeshBasicMaterial({ color: "#e8e4de" });
    const artMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WALL_FRAME_ART_WIDTH, WALL_FRAME_ART_HEIGHT),
      artMaterial,
    );
    artMesh.position.set(slotX, slotY, wallCenterZ);
    scene.add(artMesh);

    const frameMesh = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_FRAME_ART_WIDTH + 0.12, WALL_FRAME_ART_HEIGHT + 0.12, 0.03),
      new THREE.MeshStandardMaterial({ color: "#d8d1c7", roughness: 0.92, metalness: 0 }),
    );
    frameMesh.position.set(slotX, slotY, -1.12);
    scene.add(frameMesh);

    const slot: ExhibitFrameSlot = { artMesh, artMaterial, frameMesh, framePanel };

    const label = labels?.[i];
    if (label) {
      const { mesh: labelMesh, material: labelMaterial } = createFrameLabel(label.title, label.subtitle);
      labelMesh.position.set(
        slotX,
        slotY - WALL_FRAME_ART_HEIGHT / 2 - labelHeight / 2 - WALL_LABEL_GAP,
        wallCenterZ + 0.01,
      );
      scene.add(labelMesh);
      slot.labelMesh = labelMesh;
      slot.labelMaterial = labelMaterial;
    }

    slots.push(slot);
  }

  const shell: ExhibitWallShell = {
    canvas, renderer, scene, camera, controls, floor, backWall, slots,
    gridRows, gridCols, gridCenterY,
  };
  fitMultiFrameExhibitCamera(shell, stage);
  return shell;
}

export function fitMultiFrameExhibitCamera(
  shell: ExhibitWallShell,
  stage: HTMLDivElement,
) {
  const width = stage.clientWidth || window.innerWidth;
  const height = stage.clientHeight || window.innerHeight;
  shell.camera.aspect = width / Math.max(height, 1);
  shell.camera.updateProjectionMatrix();
  shell.renderer.setSize(width, height, false);

  const { gridRows, gridCols, gridCenterY } = shell;
  const totalWidth = Math.max(WALL_FRAME_ART_WIDTH, (gridCols - 1) * WALL_FRAME_SLOT_WIDTH + WALL_FRAME_ART_WIDTH);
  const totalHeight = Math.max(WALL_FRAME_ART_HEIGHT, (gridRows - 1) * WALL_FRAME_SLOT_HEIGHT + WALL_FRAME_ART_HEIGHT);

  const target = new THREE.Vector3(0, gridCenterY - 0.16, WALL_CENTER.z);
  const verticalFov = THREE.MathUtils.degToRad(shell.camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * shell.camera.aspect);
  const distanceForHeight = (totalHeight / 2) / Math.tan(verticalFov / 2);
  const distanceForWidth = (totalWidth / 2) / Math.tan(horizontalFov / 2);
  const distance = Math.max(distanceForHeight, distanceForWidth) * 1.45;

  shell.camera.position.set(0, gridCenterY + 0.2, WALL_CENTER.z + distance);
  shell.camera.lookAt(target);
  shell.controls.target.copy(target);
  shell.controls.minDistance = Math.max(1.2, distance * 0.25);
  shell.controls.maxDistance = Math.max(20, distance * 6);
  shell.controls.minAzimuthAngle = -Math.PI;
  shell.controls.maxAzimuthAngle = Math.PI;
  shell.controls.update();
}

export function computeThreeAutoFitView(
  center: { x: number; y: number; z: number },
  size: { x: number; y: number; z: number },
  aspect: number,
  fovDegrees: number,
  compactViewport: boolean,
) {
  const verticalFov = (fovDegrees * Math.PI) / 180;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(aspect, 0.1));
  const fitWidth = Math.max(size.x, size.z, 1);
  const fitHeight = Math.max(size.y, size.z * 1.08, 1);
  const distanceForHeight = (fitHeight / 2) / Math.tan(verticalFov / 2);
  const distanceForWidth = (fitWidth / 2) / Math.tan(horizontalFov / 2);
  const cameraZ = Math.max(distanceForHeight, distanceForWidth) * (compactViewport ? 1.46 : 1.34);
  const targetY = center.y + (fitHeight * (compactViewport ? 0.08 : 0.12));
  const cameraY = targetY + (fitHeight * (compactViewport ? 0.02 : 0.04));
  return {
    camera: {
      x: center.x,
      y: cameraY,
      z: center.z + cameraZ,
    },
    target: {
      x: center.x,
      y: targetY,
      z: center.z,
    },
  };
}

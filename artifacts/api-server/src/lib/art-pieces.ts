import { randomUUID } from "node:crypto";
import type { ArtPiece, ArtPieceEngine, ArtPieceVersion } from "@workspace/db";
import { artPieceEngineSchema, artPieceStatusSchema } from "@workspace/db";
import { z } from "zod/v4";

const DISALLOWED_CODE_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bimport\s*\(/i, message: "Generated code cannot use dynamic imports" },
  { pattern: /\bimport\s+[^("'`]/i, message: "Generated code cannot use import statements" },
  { pattern: /\bexport\s+/i, message: "Generated code cannot use export statements" },
  { pattern: /<\/?script\b/i, message: "Generated code cannot contain script tags" },
  { pattern: /\bfetch\s*\(/i, message: "Generated code cannot fetch remote resources" },
  { pattern: /\bXMLHttpRequest\b/i, message: "Generated code cannot make XHR requests" },
  { pattern: /\bWebSocket\b/i, message: "Generated code cannot open WebSockets" },
  { pattern: /\bEventSource\b/i, message: "Generated code cannot open EventSource streams" },
  { pattern: /\blocalStorage\b/i, message: "Generated code cannot access localStorage" },
  { pattern: /\bsessionStorage\b/i, message: "Generated code cannot access sessionStorage" },
  { pattern: /\bdocument\.cookie\b/i, message: "Generated code cannot access cookies" },
  { pattern: /\bwindow\.location\b/i, message: "Generated code cannot navigate the page" },
  { pattern: /\bdocument\.location\b/i, message: "Generated code cannot navigate the page" },
  { pattern: /\btop\./i, message: "Generated code cannot access the top window" },
  { pattern: /\bparent\./i, message: "Generated code cannot access the parent window" },
];

const MAX_ART_PIECE_ELEMENTS = 24;
const MAX_ART_PIECE_ATTEMPTS = 5;
const ART_PIECE_TIMEOUT_MS = 600_000;
const VALIDATED_DRAFT_TTL_MS = 10 * 60 * 1000;

const colorSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[#(),.%\sa-zA-Z0-9-]+$/, "Colors must be CSS-compatible strings");

const finiteNumberSchema = z.number().finite().min(-4_000).max(4_000);
const positiveNumberSchema = z.number().finite().min(0).max(4_000);
const angleSchema = z.number().finite().min(-360).max(360);
const scalarSchema = z.number().finite().min(0.1).max(10);

const vec3Schema = z.object({
  x: z.number().finite().min(-100).max(100),
  y: z.number().finite().min(-100).max(100),
  z: z.number().finite().min(-100).max(100),
});

const baseAnimationSchema = z
  .object({
    kind: z.enum(["none", "drift", "pulse", "orbit", "spin", "wave"]).default("none"),
    speed: z.number().finite().min(0).max(5).optional(),
    amplitudeX: z.number().finite().min(0).max(320).optional(),
    amplitudeY: z.number().finite().min(0).max(320).optional(),
    scaleMin: z.number().finite().min(0.2).max(3).optional(),
    scaleMax: z.number().finite().min(0.2).max(3).optional(),
    rotationDegrees: angleSchema.optional(),
    phase: angleSchema.optional(),
  })
  .optional();

const base3dAnimationSchema = z
  .object({
    kind: z.enum(["none", "spin", "float", "pulse"]).default("none"),
    speed: z.number().finite().min(0).max(5).optional(),
    amplitude: z.number().finite().min(0).max(5).optional(),
    scaleMin: z.number().finite().min(0.2).max(3).optional(),
    scaleMax: z.number().finite().min(0.2).max(3).optional(),
    axis: z.enum(["x", "y", "z"]).optional(),
  })
  .optional();

const repeatSchema = z
  .object({
    count: z.number().int().min(1).max(12),
    offsetX: finiteNumberSchema.optional(),
    offsetY: finiteNumberSchema.optional(),
    rotationStep: angleSchema.optional(),
    scaleStep: z.number().finite().min(-1).max(1).optional(),
  })
  .optional();

const p5BaseElementSchema = z.object({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  rotation: angleSchema.optional(),
  scale: z.number().finite().min(0.1).max(4).optional(),
  fill: colorSchema.optional(),
  stroke: colorSchema.optional(),
  strokeWeight: z.number().finite().min(0).max(20).optional(),
  animation: baseAnimationSchema,
  repeat: repeatSchema,
});

const p5ElementSchema = z.discriminatedUnion("type", [
  p5BaseElementSchema.extend({
    type: z.literal("ellipse"),
    width: positiveNumberSchema,
    height: positiveNumberSchema,
  }),
  p5BaseElementSchema.extend({
    type: z.literal("rect"),
    width: positiveNumberSchema,
    height: positiveNumberSchema,
    cornerRadius: z.number().finite().min(0).max(200).optional(),
  }),
  p5BaseElementSchema.extend({
    type: z.literal("line"),
    x2: finiteNumberSchema,
    y2: finiteNumberSchema,
  }),
  p5BaseElementSchema.extend({
    type: z.literal("triangle"),
    x2: finiteNumberSchema,
    y2: finiteNumberSchema,
    x3: finiteNumberSchema,
    y3: finiteNumberSchema,
  }),
  p5BaseElementSchema.extend({
    type: z.literal("quad"),
    x2: finiteNumberSchema,
    y2: finiteNumberSchema,
    x3: finiteNumberSchema,
    y3: finiteNumberSchema,
    x4: finiteNumberSchema,
    y4: finiteNumberSchema,
  }),
  p5BaseElementSchema.extend({
    type: z.literal("bezier"),
    cp1x: finiteNumberSchema,
    cp1y: finiteNumberSchema,
    cp2x: finiteNumberSchema,
    cp2y: finiteNumberSchema,
    x2: finiteNumberSchema,
    y2: finiteNumberSchema,
  }),
  p5BaseElementSchema.extend({
    type: z.literal("arc"),
    width: positiveNumberSchema,
    height: positiveNumberSchema,
    startAngle: angleSchema,
    endAngle: angleSchema,
  }),
  p5BaseElementSchema.extend({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(80),
    fontSize: z.number().finite().min(8).max(160),
    align: z.enum(["left", "center", "right"]).optional(),
  }),
]);

export const structuredP5ArtPieceSpecSchema = z.object({
  version: z.literal(1).default(1),
  title: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(4000).optional().default(""),
  canvas: z.object({
    width: z.number().int().min(240).max(960),
    height: z.number().int().min(180).max(720),
    frameRate: z.number().int().min(1).max(60).optional().default(30),
  }),
  background: colorSchema,
  elements: z.array(p5ElementSchema).min(1).max(MAX_ART_PIECE_ELEMENTS),
});

const c2AnimationSchema = z
  .object({
    kind: z.enum(["none", "drift", "pulse"]).default("none"),
    speed: z.number().finite().min(0).max(5).optional(),
    amplitudeX: z.number().finite().min(0).max(240).optional(),
    amplitudeY: z.number().finite().min(0).max(240).optional(),
    scaleMin: z.number().finite().min(0.2).max(3).optional(),
    scaleMax: z.number().finite().min(0.2).max(3).optional(),
  })
  .optional();

const c2ElementSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("circle"),
    x: finiteNumberSchema,
    y: finiteNumberSchema,
    radius: positiveNumberSchema,
    fill: colorSchema.optional(),
    stroke: colorSchema.optional(),
    strokeWeight: z.number().finite().min(0).max(20).optional(),
    animation: c2AnimationSchema,
  }),
  z.object({
    type: z.literal("rect"),
    x: finiteNumberSchema,
    y: finiteNumberSchema,
    width: positiveNumberSchema,
    height: positiveNumberSchema,
    fill: colorSchema.optional(),
    stroke: colorSchema.optional(),
    strokeWeight: z.number().finite().min(0).max(20).optional(),
    animation: c2AnimationSchema,
  }),
  z.object({
    type: z.literal("line"),
    x1: finiteNumberSchema,
    y1: finiteNumberSchema,
    x2: finiteNumberSchema,
    y2: finiteNumberSchema,
    stroke: colorSchema.optional(),
    strokeWeight: z.number().finite().min(0).max(20).optional(),
    animation: c2AnimationSchema,
  }),
]);

export const structuredC2ArtPieceSpecSchema = z.object({
  version: z.literal(1).default(1),
  title: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(4000).optional().default(""),
  canvas: z.object({
    width: z.number().int().min(240).max(960),
    height: z.number().int().min(180).max(720),
  }),
  background: colorSchema,
  elements: z.array(c2ElementSchema).min(1).max(MAX_ART_PIECE_ELEMENTS),
});

const threeEntitySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("box"),
    size: vec3Schema,
    position: vec3Schema,
    rotation: vec3Schema.optional(),
    scale: vec3Schema.optional(),
    color: colorSchema,
    animation: base3dAnimationSchema,
  }),
  z.object({
    type: z.literal("sphere"),
    radius: z.number().finite().min(0.1).max(20),
    position: vec3Schema,
    rotation: vec3Schema.optional(),
    scale: vec3Schema.optional(),
    color: colorSchema,
    animation: base3dAnimationSchema,
  }),
  z.object({
    type: z.literal("plane"),
    width: z.number().finite().min(0.1).max(40),
    height: z.number().finite().min(0.1).max(40),
    position: vec3Schema,
    rotation: vec3Schema.optional(),
    scale: vec3Schema.optional(),
    color: colorSchema,
    animation: base3dAnimationSchema,
  }),
  z.object({
    type: z.literal("torusKnot"),
    radius: z.number().finite().min(0.1).max(10),
    tube: z.number().finite().min(0.05).max(5),
    position: vec3Schema,
    rotation: vec3Schema.optional(),
    scale: vec3Schema.optional(),
    color: colorSchema,
    animation: base3dAnimationSchema,
  }),
]);

export const structuredThreeArtPieceSpecSchema = z.object({
  version: z.literal(1).default(1),
  title: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(4000).optional().default(""),
  scene: z.object({
    width: z.number().int().min(320).max(1200),
    height: z.number().int().min(240).max(900),
    background: colorSchema,
    camera: z.object({
      fov: z.number().int().min(20).max(100).default(60),
      position: vec3Schema.default({ x: 0, y: 1.5, z: 6 }),
    }),
    ambientLight: colorSchema.optional().default("#ffffff"),
    directionalLight: colorSchema.optional().default("#ffffff"),
  }),
  entities: z.array(threeEntitySchema).min(1).max(MAX_ART_PIECE_ELEMENTS),
});

export type StructuredP5ArtPieceSpec = z.infer<typeof structuredP5ArtPieceSpecSchema>;
export type StructuredC2ArtPieceSpec = z.infer<typeof structuredC2ArtPieceSpecSchema>;
export type StructuredThreeArtPieceSpec = z.infer<typeof structuredThreeArtPieceSpecSchema>;
export type StructuredArtPieceSpec =
  | StructuredP5ArtPieceSpec
  | StructuredC2ArtPieceSpec
  | StructuredThreeArtPieceSpec;

type EngineAdapter<TSpec extends StructuredArtPieceSpec> = {
  schema: z.ZodType<TSpec>;
  systemPrompt: string;
  normalizeParsed?: (input: unknown) => {
    value: unknown;
    didNormalize: boolean;
    normalizationSummary?: string | null;
  };
  compile: (spec: TSpec) => string;
  preflight: (code: string) => string;
};

export type GeneratedArtPieceDraft = {
  draftToken: string;
  title: string;
  engine: ArtPieceEngine;
  htmlCode: string | null;
  cssCode: string | null;
  generatedCode: string;
  structuredSpec: StructuredArtPieceSpec | null;
  notes: string | null;
  vendor: string;
  vendorLabel: string;
  model: string;
  validationStatus: "validated";
  attemptCount: number;
  maxAttempts: number;
  timedOut: boolean;
  cancelled: boolean;
  wasRepaired: boolean;
};

export type PersistableValidatedArtPieceDraft = {
  ownerUserId: string;
  title: string;
  prompt: string;
  engine: ArtPieceEngine;
  htmlCode: string | null;
  cssCode: string | null;
  generatedCode: string;
  structuredSpec: StructuredArtPieceSpec | null;
  notes: string | null;
  generationVendor: string;
  generationModel: string;
  validationStatus: "validated";
  attemptCount: number;
  maxAttempts: number;
  vendorLabel: string;
  createdAt: number;
};

type StoredDraftRecord = PersistableValidatedArtPieceDraft & {
  expiresAt: number;
};

const validatedDraftStore = new Map<string, StoredDraftRecord>();

export class ArtPieceGenerationError extends Error {
  statusCode: number;
  attemptCount: number;
  maxAttempts: number;
  timedOut: boolean;
  cancelled: boolean;
  engine: ArtPieceEngine | null;
  failureStage: string | null;
  rawResponsePreview: string | null;

  constructor(
    message: string,
    input: {
      statusCode?: number;
      attemptCount?: number;
      maxAttempts?: number;
      timedOut?: boolean;
      cancelled?: boolean;
      engine?: ArtPieceEngine | null;
      failureStage?: string | null;
      rawResponsePreview?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "ArtPieceGenerationError";
    this.statusCode = input.statusCode ?? 422;
    this.attemptCount = input.attemptCount ?? 0;
    this.maxAttempts = input.maxAttempts ?? MAX_ART_PIECE_ATTEMPTS;
    this.timedOut = input.timedOut ?? false;
    this.cancelled = input.cancelled ?? false;
    this.engine = input.engine ?? null;
    this.failureStage = input.failureStage ?? null;
    this.rawResponsePreview = input.rawResponsePreview ?? null;
  }
}

export class StructuredArtPieceParseError extends Error {
  engine: ArtPieceEngine;
  failureStage: "json_parse" | "schema_validation";
  rawResponse: string | null;
  normalizedResponse: string | null;
  normalizationApplied: boolean;
  normalizationSummary: string | null;
  issuePath: Array<string | number>;
  entityType: string | null;

  constructor(
    message: string,
    input: {
      engine: ArtPieceEngine;
      failureStage: "json_parse" | "schema_validation";
      rawResponse?: string | null;
      normalizedResponse?: string | null;
      normalizationApplied?: boolean;
      normalizationSummary?: string | null;
      issuePath?: Array<string | number>;
      entityType?: string | null;
    },
  ) {
    super(message);
    this.name = "StructuredArtPieceParseError";
    this.engine = input.engine;
    this.failureStage = input.failureStage;
    this.rawResponse = input.rawResponse ?? null;
    this.normalizedResponse = input.normalizedResponse ?? null;
    this.normalizationApplied = input.normalizationApplied ?? false;
    this.normalizationSummary = input.normalizationSummary ?? null;
    this.issuePath = input.issuePath ?? [];
    this.entityType = input.entityType ?? null;
  }
}

export function getArtPieceGenerationLimits() {
  return {
    maxAttempts: MAX_ART_PIECE_ATTEMPTS,
    timeoutMs: ART_PIECE_TIMEOUT_MS,
  };
}

const ENGINE_ADAPTERS: Record<ArtPieceEngine, EngineAdapter<any>> = {
  p5: {
    schema: structuredP5ArtPieceSpecSchema, // Kept for backwards compatibility parsing
    systemPrompt: [
      "You generate reusable interactive art sketches for a self-hosted p5 runtime.",
      "You MUST return your response as three separate Markdown code blocks (```html, ```css, and ```javascript).",
      "Return ONLY those three fenced code blocks. Do NOT include prose, explanations, titles, bullets, or notes before, between, or after the code blocks.",
      "The HTML block must contain ONLY this exact mount element: `<div id=\"canvas-container\"></div>`. Do NOT use custom ids such as 'book-container', 'scene-container', 'app', or 'root'. Do NOT include <style>, <script>, <link>, <base>, <html>, <head>, or <body> tags in the HTML block.",
      "The CSS block may style only mount IDs/classes that you define in the HTML block. Do NOT target `html`, `body`, or global `canvas`, and do NOT use `position: fixed`, `display: none`, `visibility: hidden`, or `opacity: 0`.",
      "Do NOT use import statements for p5; the runtime provides it globally.",
      "Use p5 instance mode. The JS must assign its sketch function to `window.sketch = (p) => { ... }` and follow this shape: `window.sketch = (p) => { p.setup = () => {}; p.draw = () => {}; };`.",
      "Always call `p.createCanvas(p.windowWidth, p.windowHeight)` inside `setup()` so the sketch fills the iframe. Do NOT hardcode small fixed dimensions like `createCanvas(400, 400)`.",
      "CRITICAL: Animations MUST be infinite and engaging. Use periodic functions like Math.sin() or Math.cos() combined with p.frameCount to ensure movement loops or pulsates indefinitely.",
      "Avoid logic that permanently removes all elements from the screen. If elements are destroyed, they must be periodically respawned.",
      "Keep the composition self-contained and visually intentional.",
      "NEVER use `p` as a variable name for anything other than the p5 instance. In forEach/map/filter callbacks and class instances, use names like `particle`, `item`, `shape`, `obj` — using `p` shadows the outer p5 instance and causes all p5 calls inside the callback to fail.",
      "Always initialize every state/config object inside `setup()`, not at the top of the sketch. In `draw()` and event handlers, guard any access to objects that might not yet exist: `if (!myObj) return;`. Do NOT call methods on variables that are declared but not yet initialized.",
    ].join(" "),
    compile: compileP5StructuredSpec, // Kept for backwards compatibility
    preflight: preflightP5Code,
  },
  c2: {
    schema: structuredC2ArtPieceSpecSchema,
    systemPrompt: [
      "You generate reusable interactive art sketches for a self-hosted c2.js runtime.",
      "You MUST return your response as three separate Markdown code blocks (```html, ```css, and ```javascript).",
      "Return ONLY those three fenced code blocks. Do NOT include prose, explanations, titles, bullets, or notes before, between, or after the code blocks.",
      "The HTML block must contain ONLY a mount canvas such as `<canvas id=\"piece-canvas\"></canvas>`. Do NOT include <style>, <script>, <link>, <base>, <html>, <head>, or <body> tags in the HTML block.",
      "The CSS block may style only mount IDs/classes that you define in the HTML block. Do NOT target `html`, `body`, or global `canvas`, and do NOT use `position: fixed`, `display: none`, `visibility: hidden`, or `opacity: 0`.",
      "Do NOT use import statements for c2; the runtime provides it globally.",
      "The JS must assign its setup function to `window.sketch` like this: `window.sketch = (runtime) => { const { c2, canvas, startFrame } = runtime; const renderer = new c2.Renderer(canvas); startFrame((frameCount) => { renderer.clear(); /* draw */ }); };`. CALL `startFrame(handler)` inside the sketch to register the animation loop — do NOT return it or return an object containing it.",
      "Do NOT include any <script src> tags — the runtime is already loaded, and any <script src> referencing an external file will cause a fatal error.",
      "Use `new c2.Renderer(canvas)` to create the renderer. Do NOT call any canvas-sizing or canvas-context methods directly.",
      "RENDERER API (call on the renderer object): renderer.clear(), renderer.clear(cssColor) [fills canvas with that color — use this for background fills], renderer.fill(cssColor), renderer.stroke(cssColor), renderer.fill(false), renderer.stroke(false), renderer.lineWidth(n), renderer.alpha(a), renderer.fontSize(n), renderer.fontFamily(f), renderer.textAlign(a), renderer.text(str,x,y). IMPORTANT: renderer.background(c) only sets a CSS style and does NOT paint the canvas — NEVER use renderer.background() for background fills; use renderer.clear('#color') instead.",
      "DRAWING METHODS — use these exact signatures: renderer.circle(x,y,r) OR renderer.circle(new c2.Circle(x,y,r)); renderer.rect(x,y,w,h) OR renderer.rect(new c2.Rect(x,y,w,h)); renderer.line(x1,y1,x2,y2) OR renderer.line(new c2.Line(p1,p2)); renderer.ellipse(x,y,rx,ry) [no c2.Ellipse constructor exists — always call directly]; renderer.triangle(x1,y1,x2,y2,x3,y3); renderer.polygon([{x,y},...]); renderer.arc(new c2.Arc(p,r,start,end)); renderer.sector(new c2.Sector(p,r1,r2,start,end)).",
      "NEVER use: c2.Ellipse, c2.Text, c2.Path, c2.Shape, beginShape, endShape, vertex, bezierVertex, curveVertex, noFill, noStroke, push, pop, strokeWeight, beginFill, endFill — these do not exist in c2.js. renderer.fill() and renderer.stroke() each take exactly ONE argument (a CSS color string, e.g. '#ff0000'). Do not call renderer.draw(), renderer.animation(), or renderer.loop() — the runtime drives the animation loop.",
      "The `c2` library object comes from `runtime.c2` — always destructure it as `const { c2, canvas, startFrame } = runtime`. Do NOT assume `c2` is a global variable.",
      "Do NOT use `c2.Ease`, `c2.Mouse`, `c2.Keyboard`, `c2.Touch`, `.linear`, `.pressed`, or any c2 input/easing helper. Those helpers are not provided by this runtime. For easing, write local math functions such as `const ease = (t) => t * t * (3 - 2 * t);`. For motion, use `frameCount`, `Math.sin`, and `Math.cos`.",
      "ALWAYS use `canvas.width` and `canvas.height` (not hardcoded pixel values) for ALL coordinate and size calculations — the canvas dimensions vary by context. To center a shape: `canvas.width/2, canvas.height/2`. To fill the background: draw from `0,0` to `canvas.width, canvas.height`.",
      "NEVER call `document.body.appendChild(canvas)` or any DOM method that moves the canvas element. The runtime manages canvas placement.",
      "CRITICAL: Animations MUST be infinite. Use the frameCount passed to startFrame() with periodic functions like Math.sin() to ensure the piece loops or pulsates indefinitely. Respawn elements if they move off-screen or are destroyed.",
      "Keep the work visually intentional.",
    ].join(" "),
    compile: compileC2StructuredSpec,
    preflight: preflightC2Code,
  },
  three: {
    schema: structuredThreeArtPieceSpecSchema,
    systemPrompt: [
      "You generate reusable interactive 3D scenes for a self-hosted Three.js runtime.",
      "You MUST return your response as three separate Markdown code blocks (```html, ```css, and ```javascript).",
      "Return ONLY those three fenced code blocks. Do NOT include prose, explanations, titles, bullets, or notes before, between, or after the code blocks.",
      "Include a container <div> or <canvas> and relevant CSS for centering or sizing.",
      "The runtime provides THREE globally. Do NOT use import statements.",
      "The JS must assign its setup function to `window.sketch` like this:",
      "`window.sketch = (runtime) => { const { THREE, canvas, startFrame, width, height } = runtime; /* setup scene, return cleanup function */ return () => {}; };`.",
      "CRITICAL: Always create the WebGLRenderer with the provided canvas: `new THREE.WebGLRenderer({ canvas, antialias: true })`. If you omit `{ canvas }`, Three.js creates a second canvas element that is not positioned in the DOM — the scene will be invisible. NEVER call `document.body.appendChild(renderer.domElement)` — the canvas is already in the correct position.",
      "CRITICAL: The HTML container div MUST use id=\"container\" — do NOT use custom ids such as 'book-container', 'scene-container', 'app', or 'root'. The runtime only mounts the WebGL canvas inside elements with known ids (container, canvas-container, sketch-container). Any other id causes the canvas to be placed outside the styled container, making the scene invisible in the normal preview.",
      "CRITICAL: Use `width` and `height` from the runtime for ALL sizing — never use `window.innerWidth` or `window.innerHeight`. Pass `false` as the third argument to `renderer.setSize(width, height, false)` to prevent CSS override. Do NOT add `window.addEventListener('resize', ...)` — the runtime handles resize. Incorrect sizing makes the scene invisible in the default post view.",
      "CRITICAL: If you use MeshPhongMaterial, MeshLambertMaterial, or MeshStandardMaterial, you MUST add at least one light (e.g. AmbientLight + DirectionalLight). These materials are invisible without lights. MeshBasicMaterial does not need lights and is suitable for simple solid-colored objects.",
      "Prefer `startFrame(handler)` for animation and render inside that handler. If you use another Three.js animation pattern, it must still render into the provided canvas and remain self-contained.",
      "CRITICAL: Animations MUST be infinite. Use Math.sin/cos, elapsed time, frameCount, or a supervised render loop to create periodic motion or pulsating effects. Ensure elements don't just disappear; the scene must remain visually active indefinitely.",
      "Keep the scene self-contained.",
    ].join(" "),
    normalizeParsed: normalizeThreeStructuredSpecInput,
    compile: compileThreeStructuredSpec,
    preflight: preflightThreeCode,
  },
};

function getEngineAdapter(engine: ArtPieceEngine) {
  return ENGINE_ADAPTERS[engine];
}

export function getArtPieceGenerationSystemPrompt(engine: ArtPieceEngine): string {
  return getEngineAdapter(engine).systemPrompt;
}

export function extractCodeBlocks(raw: string): { htmlCode: string | null; cssCode: string | null; generatedCode: string } {
  const extract = (langs: string[]) => {
    for (const lang of langs) {
      const match = raw.match(new RegExp("```" + lang + "\\s*([\\s\\S]*?)```", "i"));
      if (match) return match[1]!.trim();
    }
    return null;
  };

  const htmlCode = extract(["html"]);
  const cssCode = extract(["css"]);
  const generatedCode = extract(["javascript", "js", "javascript"]);

  if (!generatedCode) {
    throw new Error("AI response did not contain a ```javascript code block");
  }

  return { htmlCode, cssCode, generatedCode };
}

export function parseStructuredArtPieceSpec(
  engine: ArtPieceEngine,
  raw: string,
): StructuredArtPieceSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StructuredArtPieceParseError("AI response was not valid JSON", {
      engine,
      failureStage: "json_parse",
      rawResponse: raw,
    });
  }

  const adapter = getEngineAdapter(engine);
  const normalized = adapter.normalizeParsed
    ? adapter.normalizeParsed(parsed)
    : { value: parsed, didNormalize: false, normalizationSummary: null as string | null };

  const result = adapter.schema.safeParse(normalized.value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const issuePath = narrowIssuePath(issue?.path);
    throw new StructuredArtPieceParseError(
      formatStructuredArtPieceSchemaIssue(
        engine,
        normalized.value,
        issue,
        normalized.normalizationSummary ?? null,
      ),
      {
        engine,
        failureStage: "schema_validation",
        rawResponse: raw,
        normalizedResponse: safeJsonStringify(normalized.value),
        normalizationApplied: normalized.didNormalize,
        normalizationSummary: normalized.normalizationSummary ?? null,
        issuePath,
        entityType: getEntityTypeAtIssuePath(normalized.value, issuePath),
      },
    );
  }

  return result.data;
}

export function validateArtPieceEngine(value: string): ArtPieceEngine | null {
  const parsed = artPieceEngineSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validateArtPieceStatus(value: string): string | null {
  const parsed = artPieceStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validateArtPieceCode(input: string): string {
  const code = input.trim();
  if (!code) {
    throw new Error("Generated code cannot be empty");
  }
  if (code.length > 120_000) {
    throw new Error("Generated code is too large");
  }
  for (const rule of DISALLOWED_CODE_PATTERNS) {
    if (rule.pattern.test(code)) {
      throw new Error(rule.message);
    }
  }
  try {
    // Syntax check only
    new Function(code);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown syntax error";
    throw new Error(`Generated code did not parse: ${message}`);
  }
  return code;
}

export function compileStructuredArtPieceSpec(
  engine: ArtPieceEngine,
  spec: StructuredArtPieceSpec,
): string {
  return getEngineAdapter(engine).compile(spec as never);
}

export function preflightCompiledArtPieceCode(
  engine: ArtPieceEngine,
  code: string,
): string {
  return getEngineAdapter(engine).preflight(code);
}

export function buildArtPieceRepairPrompt(input: {
  engine: ArtPieceEngine;
  originalPrompt: string;
  previousRawResponse?: string | null;
  failureMessage: string;
}): string {
  const segments = [
    `Target engine: ${input.engine}`,
    `Original prompt: ${input.originalPrompt}`,
    `The previous art-piece attempt failed validation: ${input.failureMessage}`,
    "Return a corrected response that fixes the error while staying visually faithful to the original prompt. Provide the HTML, CSS, and JS in Markdown code blocks.",
    "CRITICAL: Animations MUST be infinite. They must loop, reset their state, or pulsate continuously. Never allow the piece to end on a blank screen or permanently destroy all elements.",
  ];
  if (input.previousRawResponse) {
    segments.push(`Previous invalid response: ${input.previousRawResponse}`);
  }
  return segments.join("\n\n");
}

export function issueValidatedDraftToken(input: PersistableValidatedArtPieceDraft) {
  pruneExpiredValidatedDrafts();
  const token = randomUUID();
  validatedDraftStore.set(token, {
    ...input,
    expiresAt: Date.now() + VALIDATED_DRAFT_TTL_MS,
  });
  return token;
}

export function readValidatedDraftToken(token: string, ownerUserId: string) {
  pruneExpiredValidatedDrafts();
  const record = validatedDraftStore.get(token) ?? null;
  if (!record || record.ownerUserId !== ownerUserId) {
    return null;
  }
  return record;
}

export function consumeValidatedDraftToken(token: string, ownerUserId: string) {
  const record = readValidatedDraftToken(token, ownerUserId);
  if (!record) {
    return null;
  }
  validatedDraftStore.delete(token);
  return record;
}

export function serializeArtPiece(piece: ArtPiece, version: ArtPieceVersion | null) {
  return {
    id: piece.id,
    ownerUserId: piece.ownerUserId,
    title: piece.title,
    prompt: piece.prompt,
    engine: piece.engine as ArtPieceEngine,
    status: piece.status,
    currentVersionId: piece.currentVersionId ?? null,
    thumbnailUrl: piece.thumbnailUrl ?? null,
    description: piece.description ?? null,
    createdAt: piece.createdAt,
    updatedAt: piece.updatedAt,
    currentVersion: version ? serializeArtPieceVersion(version) : null,
  };
}

export function serializeArtPieceVersion(version: ArtPieceVersion) {
  return {
    id: version.id,
    artPieceId: version.artPieceId,
    prompt: version.prompt,
    structuredSpec: parseStoredStructuredSpec(version.engine as ArtPieceEngine, version.structuredSpec),
    htmlCode: version.htmlCode ?? null,
    cssCode: version.cssCode ?? null,
    generatedCode: version.generatedCode,
    engine: version.engine as ArtPieceEngine,
    generationVendor: version.generationVendor ?? null,
    generationModel: version.generationModel ?? null,
    validationStatus: version.validationStatus ?? "validated",
    generationAttemptCount: version.generationAttemptCount ?? 1,
    notes: version.notes ?? null,
    createdAt: version.createdAt,
  };
}

export function buildInteractivePieceIframeHtml(input: {
  origin: string;
  pieceId: number;
  versionId: number;
  title: string;
}): string {
  const src = `${input.origin.replace(/\/$/, "")}/embed/pieces/${input.pieceId}`;
  const title = escapeHtml(input.title || "Interactive piece");
  return `<iframe src="${src}" width="100%" style="width:100%;aspect-ratio:16 / 9;display:block;" title="${title}" frameborder="0" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>`;
}

function compileP5StructuredSpec(spec: StructuredP5ArtPieceSpec): string {
  const payload = JSON.stringify(spec);
  return `(p) => {
    const spec = ${payload};
    const toRadians = (degrees) => (degrees || 0) * (Math.PI / 180);
    const animationTransform = (element, index, frameCount) => {
      const animation = element.animation || { kind: "none" };
      const phase = ((animation.phase || 0) * Math.PI) / 180;
      const speed = animation.speed || 1;
      const t = frameCount / 60 * speed + phase;
      let x = element.x;
      let y = element.y;
      let rotation = toRadians(element.rotation || 0);
      let scale = element.scale || 1;

      switch (animation.kind) {
        case "drift":
          x += Math.sin(t) * (animation.amplitudeX || 0);
          y += Math.cos(t) * (animation.amplitudeY || animation.amplitudeX || 0);
          break;
        case "pulse": {
          const minScale = animation.scaleMin || Math.max(0.6, scale * 0.8);
          const maxScale = animation.scaleMax || Math.max(minScale, scale * 1.2);
          const mid = (minScale + maxScale) / 2;
          const amp = (maxScale - minScale) / 2;
          scale = mid + Math.sin(t) * amp;
          break;
        }
        case "orbit":
          x += Math.cos(t) * (animation.amplitudeX || 0);
          y += Math.sin(t) * (animation.amplitudeY || animation.amplitudeX || 0);
          break;
        case "spin":
          rotation += toRadians((animation.rotationDegrees || 180) * t);
          break;
        case "wave":
          y += Math.sin(t + (index * 0.3)) * (animation.amplitudeY || animation.amplitudeX || 0);
          x += Math.cos(t + (index * 0.2)) * ((animation.amplitudeX || 0) * 0.25);
          break;
        default:
          break;
      }

      return { x, y, rotation, scale };
    };

    const applyStyle = (element) => {
      if (element.fill) p.fill(element.fill);
      else p.noFill();
      if (element.stroke) p.stroke(element.stroke);
      else p.noStroke();
      if (typeof element.strokeWeight === "number") p.strokeWeight(element.strokeWeight);
    };

    const drawOnce = (element, x, y) => {
      switch (element.type) {
        case "ellipse":
          p.ellipse(x, y, element.width, element.height);
          break;
        case "rect":
          p.rect(x, y, element.width, element.height, element.cornerRadius || 0);
          break;
        case "line":
          p.line(x, y, element.x2, element.y2);
          break;
        case "triangle":
          p.triangle(x, y, element.x2, element.y2, element.x3, element.y3);
          break;
        case "quad":
          p.quad(x, y, element.x2, element.y2, element.x3, element.y3, element.x4, element.y4);
          break;
        case "bezier":
          p.bezier(x, y, element.cp1x, element.cp1y, element.cp2x, element.cp2y, element.x2, element.y2);
          break;
        case "arc":
          p.arc(x, y, element.width, element.height, toRadians(element.startAngle), toRadians(element.endAngle));
          break;
        case "text":
          p.textSize(element.fontSize);
          p.textAlign(
            element.align === "center" ? p.CENTER : element.align === "right" ? p.RIGHT : p.LEFT,
            p.CENTER,
          );
          p.text(element.text, x, y);
          break;
        default:
          break;
      }
    };

    const drawElement = (element, index) => {
      const repeat = element.repeat || { count: 1 };
      const count = repeat.count || 1;
      for (let repeatIndex = 0; repeatIndex < count; repeatIndex += 1) {
        const animated = animationTransform(element, index + repeatIndex, p.frameCount || 0);
        p.push();
        p.translate(animated.x + ((repeat.offsetX || 0) * repeatIndex), animated.y + ((repeat.offsetY || 0) * repeatIndex));
        p.rotate(animated.rotation + toRadians((repeat.rotationStep || 0) * repeatIndex));
        const scaled = animated.scale + ((repeat.scaleStep || 0) * repeatIndex);
        p.scale(Math.max(0.1, scaled));
        applyStyle(element);
        drawOnce(element, 0, 0);
        p.pop();
      }
    };

    p.setup = () => {
      p.createCanvas(spec.canvas.width, spec.canvas.height);
      p.frameRate(spec.canvas.frameRate || 30);
    };

    p.draw = () => {
      p.background(spec.background);
      spec.elements.forEach((element, index) => drawElement(element, index));
    };
  }`;
}

function compileC2StructuredSpec(spec: StructuredC2ArtPieceSpec): string {
  const payload = JSON.stringify(spec);
  return `(runtime) => {
    const spec = ${payload};
    const { c2, canvas, startFrame } = runtime;
    const renderer = new c2.Renderer(canvas);
    renderer.size(spec.canvas.width, spec.canvas.height);
    renderer.background(spec.background);
    const transform = (element, frameCount) => {
      const animation = element.animation || { kind: "none" };
      const t = frameCount / 60 * (animation.speed || 1);
      const dx = animation.kind === "drift" ? Math.sin(t) * (animation.amplitudeX || 0) : 0;
      const dy = animation.kind === "drift" ? Math.cos(t) * (animation.amplitudeY || animation.amplitudeX || 0) : 0;
      let scale = 1;
      if (animation.kind === "pulse") {
        const minScale = animation.scaleMin || 0.8;
        const maxScale = animation.scaleMax || 1.2;
        scale = ((minScale + maxScale) / 2) + (Math.sin(t) * ((maxScale - minScale) / 2));
      }
      return { dx, dy, scale };
    };
    const applyStyle = (element) => {
      renderer.fill(element.fill || false);
      renderer.stroke(element.stroke || false);
      renderer.lineWidth(element.strokeWeight || 1);
    };
    startFrame((frameCount) => {
      renderer.clear();
      renderer.background(spec.background);
      spec.elements.forEach((element) => {
        const motion = transform(element, frameCount);
        applyStyle(element);
        if (element.type === "circle") {
          renderer.circle(new c2.Circle(element.x + motion.dx, element.y + motion.dy, element.radius * motion.scale));
          return;
        }
        if (element.type === "rect") {
          renderer.rect(new c2.Rect(
            element.x - ((element.width * motion.scale) / 2) + motion.dx,
            element.y - ((element.height * motion.scale) / 2) + motion.dy,
            element.width * motion.scale,
            element.height * motion.scale,
          ));
          return;
        }
        renderer.line(new c2.Line(
          element.x1 + motion.dx,
          element.y1 + motion.dy,
          element.x2 + motion.dx,
          element.y2 + motion.dy,
        ));
      });
    });
  }`;
}

function compileThreeStructuredSpec(spec: StructuredThreeArtPieceSpec): string {
  const payload = JSON.stringify(spec);
  return `(runtime) => {
    const spec = ${payload};
    const { THREE, canvas, startFrame } = runtime;
    const width = spec.scene.width;
    const height = spec.scene.height;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(spec.scene.background);
    const camera = new THREE.PerspectiveCamera(spec.scene.camera.fov, width / height, 0.1, 100);
    camera.position.set(spec.scene.camera.position.x, spec.scene.camera.position.y, spec.scene.camera.position.z);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height, false);
    const ambient = new THREE.AmbientLight(spec.scene.ambientLight, 1);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(spec.scene.directionalLight, 1.1);
    directional.position.set(3, 4, 5);
    scene.add(directional);
    const animated = [];
    const toRadians = (degrees) => (degrees || 0) * (Math.PI / 180);
    spec.entities.forEach((entity) => {
      let geometry;
      if (entity.type === "box") geometry = new THREE.BoxGeometry(entity.size.x, entity.size.y, entity.size.z);
      else if (entity.type === "sphere") geometry = new THREE.SphereGeometry(entity.radius, 24, 24);
      else if (entity.type === "plane") geometry = new THREE.PlaneGeometry(entity.width, entity.height);
      else geometry = new THREE.TorusKnotGeometry(entity.radius, entity.tube, 96, 16);
      const material = new THREE.MeshStandardMaterial({ color: entity.color });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
      if (entity.rotation) mesh.rotation.set(toRadians(entity.rotation.x), toRadians(entity.rotation.y), toRadians(entity.rotation.z));
      const scale = entity.scale || { x: 1, y: 1, z: 1 };
      mesh.scale.set(scale.x, scale.y, scale.z);
      scene.add(mesh);
      animated.push({ mesh, animation: entity.animation || { kind: "none" }, originY: entity.position.y, baseScale: scale });
    });
    startFrame((frameCount) => {
      animated.forEach(({ mesh, animation, originY, baseScale }) => {
        const t = frameCount / 60 * (animation.speed || 1);
        if (animation.kind === "spin") {
          const axis = animation.axis || "y";
          mesh.rotation[axis] += 0.02 * (animation.speed || 1);
        }
        if (animation.kind === "float") {
          mesh.position.y = originY + Math.sin(t) * (animation.amplitude || 0.5);
        }
        if (animation.kind === "pulse") {
          const minScale = animation.scaleMin || 0.9;
          const maxScale = animation.scaleMax || 1.15;
          const nextScale = ((minScale + maxScale) / 2) + (Math.sin(t) * ((maxScale - minScale) / 2));
          mesh.scale.set(baseScale.x * nextScale, baseScale.y * nextScale, baseScale.z * nextScale);
        }
      });
      renderer.render(scene, camera);
    });
    return () => {
      animated.forEach(({ mesh }) => {
        mesh.geometry.dispose?.();
        mesh.material.dispose?.();
      });
      renderer.dispose?.();
    };
  }`;
}

function createPreflightPermissiveMock() {
  const mock: any = new Proxy(() => mock, {
    get(target, prop) {
      if (prop === "sketch") return (target as any).sketch;
      return mock;
    },
    set(target, prop, value) {
      (target as any)[prop] = value;
      return true;
    },
    apply() {
      return mock;
    },
    construct() {
      return mock;
    },
  });
  return mock;
}

function preflightP5Code(code: string) {
  const validatedCode = validateArtPieceCode(code);
  const mockWindow = createPreflightPermissiveMock();
  let sketchFactory: any = null;

  try {
    new Function("window", "document", validatedCode)(mockWindow, mockWindow);
    sketchFactory = mockWindow.sketch;
  } catch (err) {
    // Fallback to literal expression if window.sketch assignment fails
  }

  if (!sketchFactory || typeof sketchFactory !== "function") {
    try {
      // Trim trailing semicolon for expression evaluation
      const expression = validatedCode.trim().replace(/;+$/, "");
      sketchFactory = new Function(`return (${expression});`)();
    } catch (err) {
      // Both attempts failed
    }
  }

  if (typeof sketchFactory !== "function") {
    throw new Error("Generated code did not define window.sketch or evaluate to a function");
  }

  return validatedCode;
}

function preflightC2Code(code: string) {
  const validatedCode = validateArtPieceCode(code);
  const c2DisallowedPatterns: Array<{ pattern: RegExp; message: string }> = [
    {
      pattern: /\bc2\s*\.\s*Ease\b|\bEase\s*\.\s*linear\b|\.linear\s*\(/,
      message: "Generated C2.js code cannot use c2.Ease, Ease.linear, or .linear() easing helpers; define a local easing function instead.",
    },
    {
      pattern: /\bc2\s*\.\s*(Mouse|Keyboard|Touch)\b|\b(Mouse|Keyboard|Touch)\s*\(|\.(pressed|released|dragged)\b/,
      message: "Generated C2.js code cannot use c2 input helpers or .pressed/.released/.dragged state; this runtime only provides c2, canvas, and startFrame.",
    },
  ];
  for (const rule of c2DisallowedPatterns) {
    if (rule.pattern.test(validatedCode)) {
      throw new Error(rule.message);
    }
  }
  const mockWindow = createPreflightPermissiveMock();
  let sketchFactory: any = null;

  try {
    new Function("window", "document", validatedCode)(mockWindow, mockWindow);
    sketchFactory = mockWindow.sketch;
  } catch (err) {
    // Fallback
  }

  if (!sketchFactory || typeof sketchFactory !== "function") {
    try {
      const expression = validatedCode.trim().replace(/;+$/, "");
      sketchFactory = new Function(`return (${expression});`)();
    } catch (err) {
      // Both failed
    }
  }

  if (typeof sketchFactory !== "function") {
    throw new Error("Generated code did not define window.sketch or evaluate to a function");
  }

  const runtime = createMockC2Runtime();
  try {
    sketchFactory(runtime);
    runtime.flush();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown C2.js runtime error";
    throw new Error(`Generated C2.js code failed server preflight: ${message}`);
  }

  return validatedCode;
}

function preflightThreeCode(code: string) {
  const validatedCode = validateArtPieceCode(code);
  const mockWindow = createPreflightPermissiveMock();
  let sketchFactory: any = null;

  try {
    new Function("window", "document", validatedCode)(mockWindow, mockWindow);
    sketchFactory = mockWindow.sketch;
  } catch (err) {
    // Fallback
  }

  if (!sketchFactory || typeof sketchFactory !== "function") {
    try {
      const expression = validatedCode.trim().replace(/;+$/, "");
      sketchFactory = new Function(`return (${expression});`)();
    } catch (err) {
      // Both failed
    }
  }

  if (typeof sketchFactory !== "function") {
    throw new Error("Generated code did not define window.sketch or evaluate to a function");
  }

  return validatedCode;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryNormalizeVec3Input(value: unknown): { x: number; y: number; z: number } | null {
  if (isPlainObject(value)) {
    const x = value.x;
    const y = value.y;
    const z = value.z;
    if ([x, y, z].every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      return { x: x as number, y: y as number, z: z as number };
    }
  }

  if (typeof value === "string") {
    const parts = value
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 3) {
      const numbers = parts.map((part) => Number(part));
      if (numbers.every((entry) => Number.isFinite(entry))) {
        return { x: numbers[0]!, y: numbers[1]!, z: numbers[2]! };
      }
    }
  }

  return null;
}

function formatIssuePath(path: Array<string | number>) {
  if (path.length === 0) {
    return "root";
  }
  return path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
    .join(".");
}

function narrowIssuePath(path: readonly PropertyKey[] | undefined): Array<string | number> {
  if (!path) {
    return [];
  }
  return path.filter((segment): segment is string | number =>
    typeof segment === "string" || typeof segment === "number",
  );
}

function getEntityTypeAtIssuePath(value: unknown, path: Array<string | number>) {
  if (path[0] !== "entities" || typeof path[1] !== "number") {
    return null;
  }
  const entity = isPlainObject(value) && Array.isArray(value.entities)
    ? value.entities[path[1]]
    : null;
  return isPlainObject(entity) && typeof entity.type === "string" ? entity.type : null;
}

function formatStructuredArtPieceSchemaIssue(
  engine: ArtPieceEngine,
  parsed: unknown,
  issue: z.core.$ZodIssue | undefined,
  normalizationSummary: string | null,
) {
  if (engine === "three" && issue) {
    const issuePath = narrowIssuePath(issue.path);
    const entityType = getEntityTypeAtIssuePath(parsed, issuePath);
    if (
      entityType === "box" &&
      issue.code === "invalid_type" &&
      issuePath[0] === "entities" &&
      typeof issuePath[1] === "number" &&
      issuePath[2] === "size"
    ) {
      const entity = isPlainObject(parsed) && Array.isArray(parsed.entities)
        ? parsed.entities[issuePath[1]]
        : null;
      if (isPlainObject(entity) && entity.scale && !entity.size) {
        return "Three.js box entities require a size object { x, y, z }. The model returned scale without size.";
      }
    }

    if (
      entityType === "box" &&
      issue.code === "invalid_type" &&
      typeof issuePath[0] === "string" &&
      issuePath.at(-1) === "size"
    ) {
      return "Three.js box entities require a size object { x, y, z }.";
    }

    if (entityType === "sphere" && issuePath.at(-1) === "radius") {
      return "Three.js sphere entities require a radius number.";
    }

    if (entityType === "plane" && (issuePath.at(-1) === "width" || issuePath.at(-1) === "height")) {
      return "Three.js plane entities require width and height.";
    }

    if (entityType === "torusKnot" && (issuePath.at(-1) === "radius" || issuePath.at(-1) === "tube")) {
      return "Three.js torusKnot entities require radius and tube.";
    }
  }

  const detail = issue?.message || "AI response did not match the art piece schema";
  if (normalizationSummary) {
    return `${detail} (Normalization attempted: ${normalizationSummary}; failing path: ${formatIssuePath(narrowIssuePath(issue?.path))})`;
  }
  return detail;
}

function normalizeThreeStructuredSpecInput(input: unknown) {
  if (!isPlainObject(input) || !Array.isArray(input.entities)) {
    return {
      value: input,
      didNormalize: false,
      normalizationSummary: null,
    };
  }

  let didNormalize = false;
  const normalizationNotes: string[] = [];
  const nextEntities = input.entities.map((entity, index) => {
    if (!isPlainObject(entity) || typeof entity.type !== "string") {
      return entity;
    }

    const nextEntity: Record<string, unknown> = { ...entity };

    if (entity.type === "box" && !nextEntity.size) {
      const normalizedSize =
        tryNormalizeVec3Input(entity.dimensions) ??
        tryNormalizeVec3Input(entity.scale) ??
        tryNormalizeVec3Input(entity.size);
      if (normalizedSize) {
        nextEntity.size = normalizedSize;
        if (!entity.dimensions && entity.scale && !entity.size) {
          delete nextEntity.scale;
          normalizationNotes.push(`entities[${index}] box scale->size`);
        } else {
          normalizationNotes.push(`entities[${index}] box alias->size`);
        }
        didNormalize = true;
      }
    }

    if (entity.type === "sphere" && typeof nextEntity.radius !== "number") {
      const vec = tryNormalizeVec3Input(entity.size) ?? tryNormalizeVec3Input(entity.scale);
      if (vec) {
        const isUniform = vec.x === vec.y && vec.y === vec.z;
        nextEntity.radius = isUniform
          ? Math.min(20, Math.max(0.1, vec.x / 2))
          : Math.min(20, Math.max(0.1, Math.max(vec.x, vec.y, vec.z)));
        if (entity.scale && !entity.size) {
          delete nextEntity.scale;
        }
        normalizationNotes.push(`entities[${index}] sphere ${isUniform ? "uniform " : ""}size->radius`);
        didNormalize = true;
      } else if (typeof entity.size === "number" && Number.isFinite(entity.size)) {
        nextEntity.radius = Math.min(20, Math.max(0.1, entity.size / 2));
        normalizationNotes.push(`entities[${index}] sphere size->radius`);
        didNormalize = true;
      } else if (typeof (entity as Record<string, unknown>).diameter === "number" && Number.isFinite((entity as Record<string, unknown>).diameter as number)) {
        nextEntity.radius = Math.min(20, Math.max(0.1, ((entity as Record<string, unknown>).diameter as number) / 2));
        normalizationNotes.push(`entities[${index}] sphere diameter->radius`);
        didNormalize = true;
      } else {
        nextEntity.radius = 1;
        normalizationNotes.push(`entities[${index}] sphere missing->radius:1`);
        didNormalize = true;
      }
    }

    return nextEntity;
  });

  const nextScene = normalizeThreeSceneInput(input.scene, nextEntities);
  const sceneChanged = nextScene !== input.scene;

  if (!didNormalize && !sceneChanged) {
    return {
      value: input,
      didNormalize: false,
      normalizationSummary: null,
    };
  }

  if (sceneChanged) {
    normalizationNotes.push("scene camera->safeFrame");
  }

  return {
    value: {
      ...input,
      scene: nextScene,
      entities: nextEntities,
    },
    didNormalize: true,
    normalizationSummary: normalizationNotes.join(", "),
  };
}

function estimate3dEntityRadius(entity: Record<string, unknown>) {
  if (entity.type === "box" && isPlainObject(entity.size)) {
    const size = tryNormalizeVec3Input(entity.size);
    if (size) {
      return Math.max(size.x, size.y, size.z) * 0.75;
    }
  }
  if (entity.type === "sphere" && typeof entity.radius === "number" && Number.isFinite(entity.radius)) {
    return entity.radius;
  }
  if (entity.type === "cylinder" && typeof entity.radius === "number" && typeof entity.height === "number") {
    return Math.max(entity.radius, entity.height / 2);
  }
  if (entity.type === "plane" && typeof entity.width === "number" && typeof entity.height === "number") {
    return Math.max(entity.width, entity.height) * 0.6;
  }
  if (entity.type === "torus" && typeof entity.radius === "number" && typeof entity.radiusTubular === "number") {
    return entity.radius + entity.radiusTubular;
  }
  if (entity.type === "torusKnot" && typeof entity.radius === "number" && typeof entity.tube === "number") {
    return entity.radius + entity.tube;
  }
  return 1;
}

function estimate3dSceneExtent(entities: unknown[]) {
  let maxExtent = 2;
  for (const entity of entities) {
    if (!isPlainObject(entity) || !isPlainObject(entity.position)) {
      continue;
    }
    const position = tryNormalizeVec3Input(entity.position);
    if (!position) {
      continue;
    }
    const radius = estimate3dEntityRadius(entity);
    maxExtent = Math.max(
      maxExtent,
      Math.abs(position.x) + radius,
      Math.abs(position.y) + radius,
      Math.abs(position.z) + radius,
    );
  }
  return maxExtent;
}

function buildSafe3dCameraPosition(entities: unknown[]) {
  const extent = estimate3dSceneExtent(entities);
  const distance = Math.max(4.5, extent * 2.4);
  return {
    x: Number(distance.toFixed(3)),
    y: Number(Math.max(1.8, extent * 0.9).toFixed(3)),
    z: Number(distance.toFixed(3)),
  };
}

function normalizeThreeSceneInput(scene: unknown, entities: unknown[]) {
  if (!isPlainObject(scene) || !isPlainObject(scene.camera)) {
    return scene;
  }
  return {
    ...scene,
    camera: {
      ...scene.camera,
      position: buildSafe3dCameraPosition(entities),
    },
  };
}

function parseStoredStructuredSpec(
  engine: ArtPieceEngine,
  raw: string | null | undefined,
): StructuredArtPieceSpec | null {
  if (!raw) {
    return null;
  }
  try {
    return parseStructuredArtPieceSpec(engine, raw);
  } catch {
    return null;
  }
}

function pruneExpiredValidatedDrafts() {
  const now = Date.now();
  for (const [token, record] of validatedDraftStore.entries()) {
    if (record.expiresAt <= now) {
      validatedDraftStore.delete(token);
    }
  }
}

function createMockP5() {
  const ensureFinite = (...values: number[]) => {
    for (const value of values) {
      if (!Number.isFinite(value)) {
        throw new Error("Sketch attempted to use a non-finite number");
      }
    }
  };

  const ensureColor = (value: unknown) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("Sketch attempted to use an invalid color");
    }
  };

  return {
    width: 0,
    height: 0,
    frameCount: 0,
    CENTER: "center",
    LEFT: "left",
    RIGHT: "right",
    setup: undefined as undefined | (() => void),
    draw: undefined as undefined | (() => void),
    createCanvas(width: number, height: number) {
      ensureFinite(width, height);
      this.width = width;
      this.height = height;
      return { width, height };
    },
    frameRate(rate: number) {
      ensureFinite(rate);
      return rate;
    },
    background(color: string) {
      ensureColor(color);
    },
    fill(color: string) {
      ensureColor(color);
    },
    noFill() {},
    stroke(color: string) {
      ensureColor(color);
    },
    noStroke() {},
    strokeWeight(weight: number) {
      ensureFinite(weight);
    },
    push() {},
    pop() {},
    translate(x: number, y: number) {
      ensureFinite(x, y);
    },
    rotate(angle: number) {
      ensureFinite(angle);
    },
    scale(x: number) {
      ensureFinite(x);
    },
    ellipse(x: number, y: number, width: number, height: number) {
      ensureFinite(x, y, width, height);
    },
    rect(x: number, y: number, width: number, height: number, cornerRadius?: number) {
      ensureFinite(x, y, width, height, cornerRadius ?? 0);
    },
    line(x1: number, y1: number, x2: number, y2: number) {
      ensureFinite(x1, y1, x2, y2);
    },
    triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
      ensureFinite(x1, y1, x2, y2, x3, y3);
    },
    quad(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) {
      ensureFinite(x1, y1, x2, y2, x3, y3, x4, y4);
    },
    bezier(x1: number, y1: number, cp1x: number, cp1y: number, cp2x: number, cp2y: number, x2: number, y2: number) {
      ensureFinite(x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2);
    },
    arc(x: number, y: number, width: number, height: number, start: number, stop: number) {
      ensureFinite(x, y, width, height, start, stop);
    },
    textSize(size: number) {
      ensureFinite(size);
    },
    textAlign() {},
    text(value: string, x: number, y: number) {
      if (typeof value !== "string") {
        throw new Error("Sketch attempted to draw non-string text");
      }
      ensureFinite(x, y);
    },
  };
}

function createMockC2Runtime() {
  const ensureFinite = (...values: number[]) => {
    for (const value of values) {
      if (!Number.isFinite(value)) {
        throw new Error("Sketch attempted to use a non-finite number");
      }
    }
  };

  let frameHandler: ((frameCount: number) => void) | null = null;

  class Renderer {
    constructor(_canvas: unknown) {}
    size(width: number, height: number) {
      ensureFinite(width, height);
    }
    background(_color: string) {}
    clear(_color?: string) {}
    fill(_value: string | boolean) {}
    stroke(_value: string | boolean) {}
    alpha(value: number) {
      ensureFinite(value);
    }
    fontSize(value: number) {
      ensureFinite(value);
    }
    fontFamily(_value: string) {}
    textAlign(_value: string) {}
    text(value: string, x: number, y: number) {
      if (typeof value !== "string") {
        throw new Error("Sketch attempted to draw non-string text");
      }
      ensureFinite(x, y);
    }
    lineWidth(weight: number) {
      ensureFinite(weight);
    }
    circle(circleOrX: { x: number; y: number; r: number } | number, y?: number, r?: number) {
      if (typeof circleOrX === "number") {
        ensureFinite(circleOrX, y as number, r as number);
        return;
      }
      ensureFinite(circleOrX.x, circleOrX.y, circleOrX.r);
    }
    rect(rectOrX: { x: number; y: number; w: number; h: number } | number, y?: number, w?: number, h?: number) {
      if (typeof rectOrX === "number") {
        ensureFinite(rectOrX, y as number, w as number, h as number);
        return;
      }
      ensureFinite(rectOrX.x, rectOrX.y, rectOrX.w, rectOrX.h);
    }
    line(lineOrX1: { x1: number; y1: number; x2: number; y2: number } | number, y1?: number, x2?: number, y2?: number) {
      if (typeof lineOrX1 === "number") {
        ensureFinite(lineOrX1, y1 as number, x2 as number, y2 as number);
        return;
      }
      ensureFinite(lineOrX1.x1, lineOrX1.y1, lineOrX1.x2, lineOrX1.y2);
    }
    ellipse(x: number, y: number, rx: number, ry: number) {
      ensureFinite(x, y, rx, ry);
    }
    triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
      ensureFinite(x1, y1, x2, y2, x3, y3);
    }
    polygon(points: Array<{ x: number; y: number }>) {
      if (!Array.isArray(points)) {
        throw new Error("Sketch attempted to draw a polygon without point array");
      }
      points.forEach((point) => ensureFinite(point.x, point.y));
    }
    arc(arc: { p?: { x: number; y: number }; r?: number; start?: number; end?: number }) {
      ensureFinite(arc.p?.x as number, arc.p?.y as number, arc.r as number, arc.start as number, arc.end as number);
    }
    sector(sector: { p?: { x: number; y: number }; r1?: number; r2?: number; start?: number; end?: number }) {
      ensureFinite(
        sector.p?.x as number,
        sector.p?.y as number,
        sector.r1 as number,
        sector.r2 as number,
        sector.start as number,
        sector.end as number,
      );
    }
  }

  return {
    canvas: { width: 1280, height: 720 },
    c2: {
      Renderer,
      Point: class Point {
        x: number;
        y: number;
        constructor(x: number, y: number) {
          this.x = x;
          this.y = y;
        }
      },
      Circle: class Circle {
        x: number;
        y: number;
        r: number;
        constructor(x: number, y: number, r: number) {
          this.x = x;
          this.y = y;
          this.r = r;
        }
      },
      Rect: class Rect {
        x: number;
        y: number;
        w: number;
        h: number;
        constructor(x: number, y: number, w: number, h: number) {
          this.x = x;
          this.y = y;
          this.w = w;
          this.h = h;
        }
      },
      Line: class Line {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        constructor(x1: number, y1: number, x2: number, y2: number) {
          this.x1 = x1;
          this.y1 = y1;
          this.x2 = x2;
          this.y2 = y2;
        }
      },
      Arc: class Arc {
        p: { x: number; y: number };
        r: number;
        start: number;
        end: number;
        constructor(p: { x: number; y: number }, r: number, start: number, end: number) {
          this.p = p;
          this.r = r;
          this.start = start;
          this.end = end;
        }
      },
      Sector: class Sector {
        p: { x: number; y: number };
        r1: number;
        r2: number;
        start: number;
        end: number;
        constructor(p: { x: number; y: number }, r1: number, r2: number, start: number, end: number) {
          this.p = p;
          this.r1 = r1;
          this.r2 = r2;
          this.start = start;
          this.end = end;
        }
      },
    },
    startFrame(handler: (frameCount: number) => void) {
      frameHandler = handler;
    },
    flush() {
      if (!frameHandler) {
        throw new Error("Compiled sketch did not register a frame handler");
      }
      frameHandler(1);
      frameHandler(2);
    },
  };
}

function createMockThreeRuntime() {
  let frameHandler: ((frameCount: number) => void) | null = null;

  class Vector3 {
    x = 0;
    y = 0;
    z = 0;
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    clone() {
      const next = new Vector3();
      next.set(this.x, this.y, this.z);
      return next;
    }
    copy(value: { x?: number; y?: number; z?: number }) {
      this.x = value.x ?? this.x;
      this.y = value.y ?? this.y;
      this.z = value.z ?? this.z;
      return this;
    }
    normalize() {
      return this;
    }
    multiplyScalar(_value: number) {
      return this;
    }
  }

  class Euler extends Vector3 {}

  class Object3D {
    position = new Vector3();
    rotation = new Euler();
    scale = new Vector3();
    children: unknown[] = [];
    castShadow = false;
    receiveShadow = false;
    visible = true;
    add(...values: unknown[]) {
      this.children.push(...values);
    }
    remove(...values: unknown[]) {
      this.children = this.children.filter((child) => !values.includes(child));
    }
    lookAt(_x: number | Vector3, _y?: number, _z?: number) {}
  }

  class Mesh extends Object3D {
    geometry: { dispose: () => void };
    material: { dispose: () => void };
    constructor(geometry: { dispose: () => void }, material: { dispose: () => void }) {
      super();
      this.geometry = geometry;
      this.material = material;
    }
  }

  class Scene extends Object3D {
    background: unknown;
  }

  class PerspectiveCamera extends Object3D {
    aspect: number;
    updateProjectionMatrix() {}
    constructor(_fov: number, aspect: number, _near: number, _far: number) {
      super();
      this.aspect = aspect;
    }
  }

  class WebGLRenderer {
    domElement: unknown;
    shadowMap: { enabled: boolean; type?: unknown } = { enabled: false };
    constructor(input: { canvas?: unknown } | undefined) {
      this.domElement = input?.canvas ?? {};
    }
    setPixelRatio(_value: number) {}
    setClearColor(_value: unknown) {}
    setSize(_width: number, _height: number, _updateStyle: boolean) {}
    render(_scene: unknown, _camera: unknown) {}
    dispose() {}
  }

  class Color {
    constructor(_value: string) {}
  }

  class BaseLight extends Object3D {
    shadow = {
      mapSize: { width: 0, height: 0 },
      camera: {},
      bias: 0,
      radius: 0,
    };
    constructor(_color: string, _intensity: number) {
      super();
    }
  }

  class GenericDisposable {
    dispose() {}
    constructor(..._args: unknown[]) {}
  }

  class GenericObject extends Object3D {
    dispose() {}
    set(..._args: unknown[]) {
      return this;
    }
    clone() {
      return new GenericObject();
    }
    constructor(..._args: unknown[]) {
      super();
    }
  }

  const threeApi = {
    Scene,
    Color,
    PerspectiveCamera,
    OrthographicCamera: PerspectiveCamera,
    WebGLRenderer,
    Object3D,
    Group: class Group extends Object3D {},
    AmbientLight: BaseLight,
    DirectionalLight: BaseLight,
    PointLight: BaseLight,
    SpotLight: BaseLight,
    HemisphereLight: BaseLight,
    BoxGeometry: GenericDisposable,
    SphereGeometry: GenericDisposable,
    PlaneGeometry: GenericDisposable,
    TorusKnotGeometry: GenericDisposable,
    TorusGeometry: GenericDisposable,
    CylinderGeometry: GenericDisposable,
    ConeGeometry: GenericDisposable,
    ExtrudeGeometry: GenericDisposable,
    ShapeGeometry: GenericDisposable,
    BufferGeometry: GenericDisposable,
    MeshStandardMaterial: GenericDisposable,
    MeshBasicMaterial: GenericDisposable,
    MeshPhongMaterial: GenericDisposable,
    MeshLambertMaterial: GenericDisposable,
    CanvasTexture: GenericDisposable,
    TextureLoader: class TextureLoader {
      load(_url: string) {
        return new GenericObject();
      }
    },
    Mesh,
    Vector2: Vector3,
    Vector3,
    Euler,
    MathUtils: {
      degToRad(value: number) {
        return (value * Math.PI) / 180;
      },
      lerp(a: number, b: number, t: number) {
        return a + ((b - a) * t);
      },
      clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
      },
    },
    PCFSoftShadowMap: "PCFSoftShadowMap",
    DoubleSide: "DoubleSide",
    FrontSide: "FrontSide",
    BackSide: "BackSide",
    SRGBColorSpace: "SRGBColorSpace",
  };

  return {
    canvas: { width: 1280, height: 720, style: {} },
    width: 1280,
    height: 720,
    size: { width: 1280, height: 720 },
    THREE: new Proxy(threeApi, {
      get(target, prop: string | symbol) {
        if (prop in target) {
          return target[prop as keyof typeof target];
        }
        return GenericObject;
      },
    }),
    startFrame(handler: (frameCount: number) => void) {
      frameHandler = handler;
    },
    flush() {
      if (!frameHandler) {
        throw new Error("Compiled sketch did not register a frame handler");
      }
      frameHandler(1);
      frameHandler(2);
    },
  };
}

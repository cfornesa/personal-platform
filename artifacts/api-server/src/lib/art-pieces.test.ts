import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

vi.mock("@workspace/db", () => ({
  artPieceEngineSchema: z.enum(["p5", "c2", "three"]),
  artPieceStatusSchema: z.enum(["active", "archived"]),
}));

let helpers: typeof import("./art-pieces");

beforeAll(async () => {
  helpers = await import("./art-pieces");
});

describe("art piece helpers", () => {
  it("rejects aframe as an unsupported engine", () => {
    expect(helpers.validateArtPieceEngine("aframe")).toBeNull();
  });

  it("parses strict structured JSON generation output", () => {
    const parsed = helpers.parseStructuredArtPieceSpec(
      "p5",
      JSON.stringify({
        version: 1,
        title: "Orbit Bloom",
        notes: "Soft looping motion",
        canvas: {
          width: 640,
          height: 420,
          frameRate: 30,
        },
        background: "#f5f5f5",
        elements: [
          {
            type: "ellipse",
            x: 320,
            y: 210,
            width: 160,
            height: 120,
            fill: "#66ccff",
          },
        ],
      }),
    );

    expect(parsed.title).toBe("Orbit Bloom");
    expect("elements" in parsed && parsed.elements).toHaveLength(1);
  });

  it("compiles and preflights a structured sketch", () => {
    const code = helpers.compileStructuredArtPieceSpec("p5", {
      version: 1,
      title: "Orbit Bloom",
      notes: "",
      canvas: {
        width: 640,
        height: 420,
        frameRate: 30,
      },
      background: "#f5f5f5",
      elements: [
        {
          type: "ellipse",
          x: 320,
          y: 210,
          width: 160,
          height: 120,
          fill: "#66ccff",
          animation: {
            kind: "pulse",
            speed: 1,
          },
        },
      ],
    });

    expect(() => helpers.preflightCompiledArtPieceCode("p5", code)).not.toThrow();
  });

  it("compiles and preflights a c2 sketch", () => {
    const code = helpers.compileStructuredArtPieceSpec("c2", {
      version: 1,
      title: "Signal Study",
      notes: "",
      canvas: { width: 640, height: 420 },
      background: "#111111",
      elements: [
        {
          type: "circle",
          x: 320,
          y: 210,
          radius: 64,
          fill: "#66ccff",
        },
      ],
    });

    expect(() => helpers.preflightCompiledArtPieceCode("c2", code)).not.toThrow();
  });

  it("preflights C2 sketches that use direct renderer method signatures", () => {
    expect(() =>
      helpers.preflightCompiledArtPieceCode(
        "c2",
        `
          window.sketch = (runtime) => {
            const { c2, canvas, startFrame } = runtime;
            const renderer = new c2.Renderer(canvas);
            startFrame((frameCount) => {
              renderer.clear("#111");
              renderer.fill("#fff");
              renderer.circle(canvas.width / 2, canvas.height / 2, 40 + Math.sin(frameCount) * 8);
              renderer.ellipse(canvas.width / 2, canvas.height / 2, 120, 40);
              renderer.text("ok", 20, 30);
            });
          };
        `,
      ),
    ).not.toThrow();
  });

  it("rejects C2 drafts that use unsupported easing helpers before browser preview", () => {
    expect(() =>
      helpers.preflightCompiledArtPieceCode(
        "c2",
        `
          window.sketch = (runtime) => {
            const { c2, canvas, startFrame } = runtime;
            const renderer = new c2.Renderer(canvas);
            startFrame((frameCount) => {
              const t = c2.Ease.linear(frameCount / 60);
              renderer.circle(canvas.width / 2, canvas.height / 2, t * 40);
            });
          };
        `,
      ),
    ).toThrow("Generated C2.js code cannot use c2.Ease");
  });

  it("rejects C2 drafts that use unsupported pressed input state before browser preview", () => {
    expect(() =>
      helpers.preflightCompiledArtPieceCode(
        "c2",
        `
          window.sketch = (runtime) => {
            const { c2, canvas, startFrame } = runtime;
            const renderer = new c2.Renderer(canvas);
            const mouse = c2.Mouse(canvas);
            startFrame(() => {
              if (mouse.pressed) renderer.circle(20, 20, 10);
            });
          };
        `,
      ),
    ).toThrow("Generated C2.js code cannot use c2 input helpers");
  });

  it("compiles and preflights a three scene", () => {
    const code = helpers.compileStructuredArtPieceSpec("three", {
      version: 1,
      title: "Orbit Mesh",
      notes: "",
      scene: {
        width: 800,
        height: 600,
        background: "#0f172a",
        camera: { fov: 60, position: { x: 0, y: 1.5, z: 6 } },
        ambientLight: "#ffffff",
        directionalLight: "#ffffff",
      },
      entities: [
        {
          type: "torusKnot",
          radius: 1.1,
          tube: 0.35,
          position: { x: 0, y: 0, z: 0 },
          color: "#a855f7",
        },
      ],
    });

    expect(code).toContain("camera.lookAt(0, 0, 0)");
    expect(() => helpers.preflightCompiledArtPieceCode("three", code)).not.toThrow();
  });

  it("accepts Three.js sketches that use the preferred runtime contract", () => {
    expect(() =>
      helpers.preflightCompiledArtPieceCode(
        "three",
        `
          window.sketch = (runtime) => {
            const { THREE, canvas, startFrame, width, height } = runtime;
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
            camera.position.set(0, 1, 5);
            camera.lookAt(0, 0, 0);
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
            renderer.setSize(width, height, false);
            const mesh = new THREE.Mesh(
              new THREE.BoxGeometry(1, 1, 1),
              new THREE.MeshStandardMaterial({ color: "#ffffff" }),
            );
            scene.add(mesh);
            startFrame((frameCount) => {
              mesh.rotation.y = frameCount / 60;
              renderer.render(scene, camera);
            });
          };
        `,
      ),
    ).not.toThrow();
  });

  it("accepts Three.js sketches that use native setAnimationLoop", () => {
    expect(() =>
      helpers.preflightCompiledArtPieceCode(
        "three",
        `
          window.sketch = (runtime) => {
            const { THREE, canvas, width, height } = runtime;
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
            renderer.setAnimationLoop(() => renderer.render(scene, camera));
          };
        `,
      ),
    ).not.toThrow();
  });

  it("allows common Three.js scene graph and shadow APIs during preflight", () => {
    expect(() =>
      helpers.preflightCompiledArtPieceCode(
        "three",
        `
          window.sketch = (runtime) => {
            const { THREE, canvas, startFrame, width, height } = runtime;
            const scene = new THREE.Scene();
            const root = new THREE.Group();
            const pivot = new THREE.Object3D();
            root.add(pivot);
            scene.add(root);
            const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.setSize(width, height, false);
            const light = new THREE.DirectionalLight(0xffffff, 1);
            light.position.set(2, 4, 3);
            light.castShadow = true;
            light.shadow.mapSize.width = 1024;
            light.shadow.mapSize.height = 1024;
            scene.add(light);
            const mesh = new THREE.Mesh(
              new THREE.BoxGeometry(1, 1, 1),
              new THREE.MeshStandardMaterial({ color: "#ffffff" }),
            );
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            pivot.add(mesh);
            startFrame((frameCount) => {
              root.rotation.y = frameCount / 60;
              renderer.render(scene, camera);
            });
          };
        `,
      ),
    ).not.toThrow();
  });

  it("normalizes a three box that uses scale instead of size", () => {
    const parsed = helpers.parseStructuredArtPieceSpec(
      "three",
      JSON.stringify({
        version: 1,
        title: "2050 Aero-Coupe Concept",
        notes: "Minimalist aerodynamic vehicle with floating glass chassis",
        scene: {
          width: 800,
          height: 600,
          background: "#1a1a2e",
          camera: {
            fov: 45,
            position: { x: 8, y: 4, z: 8 },
          },
          ambientLight: "#444466",
          directionalLight: "#ffffff",
        },
        entities: [
          {
            type: "box",
            position: { x: 0, y: 0.5, z: 0 },
            scale: { x: 3, y: 0.8, z: 1.5 },
            color: "#0f3460",
            animation: { kind: "float", speed: 1, amplitude: 0.2 },
          },
          {
            type: "sphere",
            position: { x: -1, y: 0.2, z: 1 },
            scale: { x: 0.5, y: 0.5, z: 0.5 },
            color: "#e94560",
          },
        ],
      }),
    );

    expect("entities" in parsed && parsed.entities[0]).toMatchObject({
      type: "box",
      size: { x: 3, y: 0.8, z: 1.5 },
    });
    expect("entities" in parsed && parsed.entities[1]).toMatchObject({
      type: "sphere",
      radius: 0.25,
    });
    expect("scene" in parsed && "camera" in parsed.scene && parsed.scene.camera.position).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
    });
    expect(() =>
      helpers.preflightCompiledArtPieceCode(
        "three",
        helpers.compileStructuredArtPieceSpec("three", parsed),
      ),
    ).not.toThrow();
  });

  it("fails three schema validation with an entity-aware message for ambiguous box geometry", () => {
    expect(() =>
      helpers.parseStructuredArtPieceSpec(
        "three",
        JSON.stringify({
          version: 1,
          title: "Broken Coupe",
          notes: "",
          scene: {
            width: 800,
            height: 600,
            background: "#1a1a2e",
            camera: {
              fov: 45,
              position: { x: 8, y: 4, z: 8 },
            },
            ambientLight: "#444466",
            directionalLight: "#ffffff",
          },
          entities: [
            {
              type: "box",
              position: { x: 0, y: 0.5, z: 0 },
              color: "#0f3460",
            },
          ],
        }),
      ),
    ).toThrow("Three.js box entities require a size object { x, y, z }.");
  });

  it("issues and consumes validated draft tokens", () => {
    const draftToken = helpers.issueValidatedDraftToken({
      ownerUserId: "owner-1",
      title: "Orbit Bloom",
      prompt: "Make a glowing orbit bloom.",
      engine: "p5",
      htmlCode: null,
      cssCode: null,
      generatedCode: "(p) => { p.setup = () => { p.createCanvas(10, 10); }; p.draw = () => { p.background('#fff'); }; }",
      structuredSpec: {
        version: 1,
        title: "Orbit Bloom",
        notes: "",
        canvas: { width: 640, height: 420, frameRate: 30 },
        background: "#ffffff",
        elements: [
          { type: "ellipse", x: 100, y: 100, width: 50, height: 50, fill: "#00f" },
        ],
      },
      notes: null,
      generationVendor: "google",
      generationModel: "gemini-test",
      validationStatus: "validated",
      attemptCount: 2,
      maxAttempts: 5,
      vendorLabel: "Google",
      createdAt: Date.now(),
    });

    expect(helpers.consumeValidatedDraftToken(draftToken, "owner-1")?.attemptCount).toBe(2);
    expect(helpers.consumeValidatedDraftToken(draftToken, "owner-1")).toBeNull();
  });

  it.each(["p5", "c2", "three"] as const)(
    "requires code-block-only output in %s system prompt",
    (engine) => {
      const prompt = helpers.getArtPieceGenerationSystemPrompt(engine);

      expect(prompt).toContain("Return ONLY those three fenced code blocks");
      expect(prompt).toContain("```html");
      expect(prompt).toContain("```css");
      expect(prompt).toContain("```javascript");
      expect(prompt).toContain("Do NOT include prose");
    },
  );

  it("includes the p5 mount id and instance-mode requirements in the p5 system prompt", () => {
    const prompt = helpers.getArtPieceGenerationSystemPrompt("p5");

    expect(prompt).toContain('id="canvas-container"');
    expect(prompt).toContain("Do NOT use custom ids");
    expect(prompt).toContain("window.sketch = (p) => { ... }");
    expect(prompt).toContain("p5 instance mode");
  });

  it("keeps runtime-specific C2 requirements in the C2 system prompt", () => {
    const prompt = helpers.getArtPieceGenerationSystemPrompt("c2");

    expect(prompt).toContain("const { c2, canvas, startFrame } = runtime");
    expect(prompt).toContain("new c2.Renderer(canvas)");
    expect(prompt).toContain("CALL `startFrame(handler)`");
    expect(prompt).toContain("NEVER use: c2.Ellipse");
  });

  it("includes container id requirement in Three.js system prompt", () => {
    const prompt = helpers.getArtPieceGenerationSystemPrompt("three");

    expect(prompt).toContain('id="container"');
    expect(prompt).toContain("Any other id causes the canvas to be placed outside the styled container");
  });

  it("includes lighting requirement for standard materials in Three.js system prompt", () => {
    const prompt = helpers.getArtPieceGenerationSystemPrompt("three");

    expect(prompt).toContain("MeshPhongMaterial, MeshLambertMaterial, or MeshStandardMaterial");
    expect(prompt).toContain("These materials are invisible without lights");
  });

  it("builds a live iframe embed snippet that resolves the current piece version", () => {
    expect(
      helpers.buildInteractivePieceIframeHtml({
        origin: "https://creatr.example",
        pieceId: 12,
        versionId: 34,
        title: "Orbit Bloom",
      }),
    ).toContain("/embed/pieces/12");
    expect(
      helpers.buildInteractivePieceIframeHtml({
        origin: "https://creatr.example",
        pieceId: 12,
        versionId: 34,
        title: "Orbit Bloom",
      }),
    ).not.toContain("?version=");
    expect(
      helpers.buildInteractivePieceIframeHtml({
        origin: "https://creatr.example",
        pieceId: 12,
        versionId: 34,
        title: "Orbit Bloom",
      }),
    ).toContain('aspect-ratio:16 / 9');
  });
});

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useLocation, useRoute } from "wouter";
import {
  createFloorClickNavigation,
  createKeyboardNavigation,
  createPresentationSurface,
  createMountedGalleryShell,
  disposeObjectMaterial,
  drawContainedIntoPresentationSurface,
  fitMountedGalleryCamera,
  NORMALIZED_PRESENTATION_GALLERY_PROFILE,
  updateMountedGalleryLayout,
} from "@/lib/immersive-gallery";
import {
  buildImageGalleryEmbedHtml,
  buildImmersiveImageHref,
  buildPlainImageEmbedHtml,
  readImmersiveImageMetadata,
  resolveImmersiveImageSrc,
} from "@/lib/immersive-view";
import {
  ImmersiveMetadataCard,
  ImmersiveRouteShell,
} from "@/components/immersive/ImmersiveRouteShell";

function useReturnToPrevious() {
  const [, setLocation] = useLocation();
  return () => {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo");
    if (returnTo && returnTo.startsWith("/")) {
      if (returnTo.includes("#")) {
        window.location.href = returnTo;
      } else {
        setLocation(returnTo);
      }
      return;
    }
    const postId = params.get("post");
    if (postId && !isNaN(Number(postId))) {
      setLocation(`/posts/${postId}`);
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setLocation("/");
  };
}

function ImmersiveImageStage({
  imageSrc,
  onError,
  fullscreen,
}: {
  imageSrc: string;
  onError: (message: string | null) => void;
  fullscreen: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !imageSrc) {
      if (!imageSrc) {
        onError("The image route is missing a valid source.");
      }
      return;
    }

    const stageEl = container;
    const shell = createMountedGalleryShell(
      stageEl,
      16 / 9,
      NORMALIZED_PRESENTATION_GALLERY_PROFILE,
    );

    let textureRef: any = null;
    let frameId = 0;
    let disposed = false;

    const loader = new THREE.TextureLoader();
    loader.load(
      imageSrc,
      (texture: any) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        const image = texture.image as { width?: number; height?: number } | undefined;
        const width = image?.width ?? 1600;
        const height = image?.height ?? 900;
        const imgAspect = width / Math.max(height, 1);
        const presW = 1200;
        const presH = Math.round(presW / imgAspect);
        const presentation = createPresentationSurface(presW, presH, 72);
        drawContainedIntoPresentationSurface(
          presentation,
          width,
          height,
          (ctx, x, y, drawWidth, drawHeight) => {
            ctx.drawImage(texture.image, x, y, drawWidth, drawHeight);
          },
          "#f8f5ee",
        );
        texture.dispose();
        textureRef = new THREE.CanvasTexture(presentation.canvas);
        textureRef.colorSpace = THREE.SRGBColorSpace;
        updateMountedGalleryLayout(shell, imgAspect);
        shell.artMaterial.map = textureRef;
        shell.artMaterial.needsUpdate = true;
        fitMountedGalleryCamera(shell, stageEl);
        onError(null);
      },
      undefined,
      () => {
        onError("The image could not be loaded into immersive view.");
      },
    );

    const floorNav = createFloorClickNavigation(shell.camera, shell.controls, shell.floor, stageEl);
    const keyNav = createKeyboardNavigation(shell.controls);

    function animate() {
      frameId = requestAnimationFrame(animate);
      floorNav.update();
      keyNav.update();
      if (textureRef) {
        textureRef.needsUpdate = true;
      }
      shell.controls.update();
      shell.renderer.render(shell.scene, shell.camera);
    }
    animate();

    function handleResize() {
      fitMountedGalleryCamera(shell, stageEl, undefined, false);
    }
    window.addEventListener("resize", handleResize);
    const observer = new ResizeObserver(handleResize);
    observer.observe(stageEl);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
      cancelAnimationFrame(frameId);
      textureRef?.dispose?.();
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
      floorNav.dispose();
      keyNav.dispose();
      stageEl.innerHTML = "";
    };
  }, [fullscreen, imageSrc, onError]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}

export default function ImmersiveImagePage() {
  const [, params] = useRoute("/immersive/images/:encodedRef");
  const goBack = useReturnToPrevious();
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(() => {
    const searchParams = new URLSearchParams(window.location.search);
    return searchParams.get("fullscreen") === "1";
  });
  const encodedRef = params?.encodedRef ?? "";
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const metadata = useMemo(() => readImmersiveImageMetadata(searchParams), [searchParams]);
  const imageSrc = useMemo(
    () => (encodedRef ? resolveImmersiveImageSrc(encodedRef) : ""),
    [encodedRef],
  );
  const isEmbedMode = searchParams.get("embed") === "1";
  const isCmsEmbed = searchParams.get("cms") === "1";

  const canonicalHref = useMemo(
    () => encodedRef ? `${window.location.origin}${buildImmersiveImageHref(imageSrc, metadata)}` : "",
    [encodedRef, imageSrc, metadata],
  );

  const plainEmbedCode = useMemo(
    () => buildPlainImageEmbedHtml(imageSrc, metadata.alt),
    [imageSrc, metadata.alt],
  );
  const galleryEmbedCode = useMemo(
    () => encodedRef ? buildImageGalleryEmbedHtml(encodedRef, metadata) : "",
    [encodedRef, metadata],
  );
  const galleryCmsEmbedCode = useMemo(
    () => encodedRef ? buildImageGalleryEmbedHtml(encodedRef, metadata, window.location.origin, "cms") : "",
    [encodedRef, metadata],
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

  return (
    <ImmersiveRouteShell
      title={metadata.title || metadata.alt || "Image"}
      onBack={goBack}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => setIsFullscreen((current) => !current)}
      isEmbedMode={isEmbedMode}
      suppressFullscreenControlOnIPhone={isCmsEmbed}
      canonicalHref={canonicalHref}
      embedCodes={encodedRef ? {
        plain: { label: "Embed Piece", code: plainEmbedCode },
        gallery: { label: "Embed Interactive (Custom)", code: galleryEmbedCode },
        galleryCms: { label: "Embed Interactive (CMS)", code: galleryCmsEmbedCode },
      } : undefined}
      metadataCard={
        <ImmersiveMetadataCard
          title={metadata.title || metadata.alt || "Immersive image"}
          description={
            metadata.caption ? (
              <>
                <span className="block">{metadata.caption}</span>
                <span className="mt-3 block">
                  This image uses the browser-based 3D immersive gallery scene with a normalized presentation surface and centered default framing.
                </span>
              </>
            ) : (
              "This image uses the browser-based 3D immersive gallery scene with a normalized presentation surface and centered default framing."
            )
          }
          fields={[
            {
              label: "Alt text",
              value: metadata.alt || "No alt text provided in this view.",
            },
            {
              label: "Source",
              value: <span className="break-all text-white/60">{imageSrc}</span>,
            },
            ...(error
              ? [
                  {
                    label: "Fallback",
                    value: error,
                    tone: "warning" as const,
                  },
                ]
              : []),
          ]}
        />
      }
      renderScene={({ fullscreen }) =>
        error ? (
          <div className="flex h-full items-center justify-center p-6">
            <img
              src={imageSrc}
              alt={metadata.alt || metadata.title || "Immersive image fallback"}
              className="max-h-full w-auto max-w-full rounded-2xl border border-white/10 object-contain shadow-2xl"
            />
          </div>
        ) : (
          <ImmersiveImageStage
            imageSrc={imageSrc}
            onError={setError}
            fullscreen={fullscreen}
          />
        )
      }
    />
  );
}

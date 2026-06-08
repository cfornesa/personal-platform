import { type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowLeft, Box, Code, Maximize2, Minimize2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ImmersiveMetadataField = {
  label: string;
  value: ReactNode;
  tone?: "default" | "warning";
};

type ImmersiveMetadataCardProps = {
  title: string;
  description: ReactNode;
  fields: ImmersiveMetadataField[];
};

type EmbedCodes = {
  plain: { label: string; code: string };
  gallery: { label: string; code: string };
  galleryCms?: { label: string; code: string };
};

type ImmersiveRouteShellProps = {
  title: string;
  onBack: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  renderScene: (context: { fullscreen: boolean; isMobile: boolean }) => ReactNode;
  metadataCard: ReactNode;
  sceneHeightClassName?: string;
  isEmbedMode?: boolean;
  showEmbedFullscreenControl?: boolean;
  suppressFullscreenControlOnIPhone?: boolean;
  canonicalHref?: string;
  embedCodes?: EmbedCodes;
  enableIPhoneEmbedLauncher?: boolean;
};

type ImmersiveStyleSnapshot = {
  bodyOverflow: string;
  htmlOverflow: string;
  bodyOverscrollBehavior: string;
  htmlOverscrollBehavior: string;
  bodyTouchAction: string;
  htmlTouchAction: string;
};

const IMMERSIVE_VIEWPORT_WIDTH_VAR = "--immersive-viewport-width";
const IMMERSIVE_VIEWPORT_HEIGHT_VAR = "--immersive-viewport-height";

function isIPhoneWebKitBrowser() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const userAgent = navigator.userAgent || "";
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const isIPad =
    /\biPad\b/i.test(userAgent) || (/\bMacintosh\b/i.test(userAgent) && maxTouchPoints > 1);
  return /\biPhone\b/i.test(userAgent) && /AppleWebKit/i.test(userAgent) && !isIPad;
}

function getFullscreenElement() {
  return document.fullscreenElement;
}

function requestElementFullscreen(element: HTMLElement) {
  if (!element.requestFullscreen) {
    return Promise.reject(new Error("Fullscreen API is unavailable."));
  }
  return element.requestFullscreen();
}

function lockDocumentForImmersiveMode(): ImmersiveStyleSnapshot {
  const snapshot = {
    bodyOverflow: document.body.style.overflow,
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverscrollBehavior: document.body.style.overscrollBehavior,
    htmlOverscrollBehavior: document.documentElement.style.overscrollBehavior,
    bodyTouchAction: document.body.style.touchAction,
    htmlTouchAction: document.documentElement.style.touchAction,
  };
  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";
  document.body.style.overscrollBehavior = "none";
  document.documentElement.style.overscrollBehavior = "none";
  document.body.style.touchAction = "none";
  document.documentElement.style.touchAction = "none";
  return snapshot;
}

function restoreImmersiveDocumentLock(snapshot: ImmersiveStyleSnapshot) {
  document.body.style.overflow = snapshot.bodyOverflow;
  document.documentElement.style.overflow = snapshot.htmlOverflow;
  document.body.style.overscrollBehavior = snapshot.bodyOverscrollBehavior;
  document.documentElement.style.overscrollBehavior = snapshot.htmlOverscrollBehavior;
  document.body.style.touchAction = snapshot.bodyTouchAction;
  document.documentElement.style.touchAction = snapshot.htmlTouchAction;
}

function syncImmersiveViewportVars(element: HTMLElement) {
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width ?? window.innerWidth);
  const height = Math.round(viewport?.height ?? window.innerHeight);
  element.style.setProperty(IMMERSIVE_VIEWPORT_WIDTH_VAR, `${Math.max(width, 1)}px`);
  element.style.setProperty(IMMERSIVE_VIEWPORT_HEIGHT_VAR, `${Math.max(height, 1)}px`);
}

function clearImmersiveViewportVars(element: HTMLElement) {
  element.style.removeProperty(IMMERSIVE_VIEWPORT_WIDTH_VAR);
  element.style.removeProperty(IMMERSIVE_VIEWPORT_HEIGHT_VAR);
}

function FullscreenToggleButton({
  isFullscreen,
  onToggle,
}: {
  isFullscreen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isFullscreen ? "Return to gallery view" : "Expand immersive view"}
      className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
    </button>
  );
}

function EmbedCopyButton({ label, code }: { label: string; code: string }) {
  const { toast } = useToast();
  function handleCopy() {
    navigator.clipboard.writeText(code).then(
      () => toast({ title: "Copied", description: `${label} code is ready to paste.` }),
      () =>
        toast({
          title: "Copy failed",
          variant: "destructive",
          description: "Select and copy the code manually.",
        }),
    );
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <Code className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

export function ImmersiveMetadataCard({
  title,
  description,
  fields,
}: ImmersiveMetadataCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5">
        <Box className="h-5 w-5" />
      </div>
      <h1 className="break-words text-xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-white/70">{description}</p>
      <dl className="mt-5 space-y-3 text-sm text-white/75">
        {fields.map((field) => (
          <div key={field.label}>
            <dt
              className={cn(
                "text-xs uppercase tracking-[0.18em]",
                field.tone === "warning" ? "text-amber-300/80" : "text-white/45",
              )}
            >
              {field.label}
            </dt>
            <dd
              className={cn(
                "mt-1 break-words leading-relaxed",
                field.tone === "warning" ? "text-amber-100/80" : undefined,
              )}
            >
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ImmersiveRouteShell({
  title,
  onBack,
  isFullscreen,
  onToggleFullscreen,
  renderScene,
  metadataCard,
  sceneHeightClassName = "h-[40svh] min-h-[300px]",
  isEmbedMode = false,
  showEmbedFullscreenControl = true,
  suppressFullscreenControlOnIPhone = false,
  canonicalHref,
  embedCodes,
  enableIPhoneEmbedLauncher = false,
}: ImmersiveRouteShellProps) {
  const routeContainerRef = useRef<HTMLDivElement>(null);
  const embedContainerRef = useRef<HTMLDivElement>(null);
  const isFullscreenRef = useRef(isFullscreen);
  const [isEmbedFullscreen, setIsEmbedFullscreen] = useState(false);
  const [isEmbedFocusMode, setIsEmbedFocusMode] = useState(false);
  const isEmbedExpanded = isEmbedFullscreen || isEmbedFocusMode;
  const [hasWrapper, setHasWrapper] = useState(false);

  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  useEffect(() => {
    if (!isEmbedMode) return;
    function handleMessage(e: MessageEvent) {
      if (e.data && e.data.type === "creatr-wrapper-connected") {
        setHasWrapper(true);
      }
      if (e.data && e.data.type === "creatr-parent-exit-fullscreen") {
        setIsEmbedFocusMode(false);
      }
    }
    function announceReady() {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "creatr-iframe-ready" }, "*");
        }
      } catch {}
    }
    window.addEventListener("message", handleMessage);
    announceReady();
    // Heavier CMS pages can load embed.js (deferred) well after this iframe
    // mounts, so the wrapper element may not exist yet for the first
    // announcement. Re-announce for a bounded window so a late-defined
    // wrapper still completes the handshake instead of leaving hasWrapper
    // permanently false.
    const retryIntervalId = window.setInterval(announceReady, 800);
    const retryTimeoutId = window.setTimeout(() => window.clearInterval(retryIntervalId), 20000);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearInterval(retryIntervalId);
      window.clearTimeout(retryTimeoutId);
    };
  }, [isEmbedMode]);

  useEffect(() => {
    function onFullscreenChange() {
      const fullscreenElement = getFullscreenElement();
      setIsEmbedFullscreen(!!fullscreenElement && fullscreenElement === embedContainerRef.current);
      if (fullscreenElement === embedContainerRef.current) {
        setIsEmbedFocusMode(false);
      }

      if (
        !isEmbedMode
        && !fullscreenElement
        && isFullscreenRef.current
      ) {
        onToggleFullscreen();
      }
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [isEmbedMode, onToggleFullscreen]);

  useEffect(() => {
    if ((!isEmbedMode && !isFullscreen) || (isEmbedMode && !isEmbedExpanded)) return;
    const snapshot = lockDocumentForImmersiveMode();
    return () => restoreImmersiveDocumentLock(snapshot);
  }, [isEmbedExpanded, isEmbedMode, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen || isEmbedMode) {
      return;
    }
    const target = routeContainerRef.current;
    if (!target) {
      return;
    }
    const targetElement = target;
    function onFullscreenChange() {
      syncImmersiveViewportVars(targetElement);
    }
    syncImmersiveViewportVars(targetElement);
    window.addEventListener("resize", onFullscreenChange);
    window.visualViewport?.addEventListener("resize", onFullscreenChange);
    window.visualViewport?.addEventListener("scroll", onFullscreenChange);
    return () => {
      window.removeEventListener("resize", onFullscreenChange);
      window.visualViewport?.removeEventListener("resize", onFullscreenChange);
      window.visualViewport?.removeEventListener("scroll", onFullscreenChange);
      clearImmersiveViewportVars(targetElement);
    };
  }, [isFullscreen, isEmbedMode]);

  useEffect(() => {
    if (!isEmbedMode || !isEmbedExpanded) {
      return;
    }
    const target = embedContainerRef.current;
    if (!target) {
      return;
    }
    const targetElement = target;
    function onViewportChange() {
      syncImmersiveViewportVars(targetElement);
    }
    syncImmersiveViewportVars(targetElement);
    window.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
      clearImmersiveViewportVars(targetElement);
    };
  }, [isEmbedExpanded, isEmbedMode]);

  async function handleRouteFullscreenToggle() {
    if (isFullscreen) {
      if (getFullscreenElement()) {
        try {
          await document.exitFullscreen();
        } catch {
          if (isFullscreenRef.current) {
            onToggleFullscreen();
          }
        }
        return;
      }
      onToggleFullscreen();
      return;
    }

    const target = routeContainerRef.current;
    if (target) {
      void requestElementFullscreen(target).catch(() => undefined);
    }
    onToggleFullscreen();
  }

  if (isEmbedMode) {
    async function handleEmbedToggle() {
      if (isIPhoneWebKitBrowser()) {
        if (hasWrapper) {
          try {
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(
                { type: "creatr-toggle-fullscreen", value: !isEmbedFocusMode },
                "*"
              );
              setIsEmbedFocusMode((prev) => !prev);
              return;
            }
          } catch {}
        }

        // No wrapper connected (e.g. the CMS stripped the embed's <script>
        // tag, so embed.js never defined creatr-* on the parent page). Try
        // native fullscreen on this element directly before resorting to
        // navigation: the generated <iframe> already carries
        // allowfullscreen/allow="fullscreen", and unlike CSS position:fixed,
        // the Fullscreen API can promote the element to cover the entire
        // physical screen even though it lives inside an iframe.
        const embedTarget = embedContainerRef.current;
        if (embedTarget && typeof embedTarget.requestFullscreen === "function") {
          try {
            await requestElementFullscreen(embedTarget);
            setIsEmbedFocusMode(false);
            return;
          } catch {
            // Fullscreen unavailable inside this iframe (e.g. the CMS's own
            // wrapper iframe doesn't delegate the fullscreen permission) —
            // fall through to the navigation-based escape hatch below.
          }
        }

        const targetUrl = new URL(canonicalHref || window.location.href, window.location.origin);
        targetUrl.searchParams.set("fullscreen", "1");
        const redirectStr = targetUrl.toString();

        try {
          if (window.top && window.top !== window) {
            window.top.location.assign(redirectStr);
            return;
          }
        } catch {
          // Top navigation is blocked (e.g. strict cross-origin iframe sandbox rules)
        }
        window.open(redirectStr, "_blank", "noopener,noreferrer");
        return;
      }

      if (isEmbedExpanded) {
        if (document.fullscreenElement === embedContainerRef.current) {
          try {
            await document.exitFullscreen();
          } catch {
            setIsEmbedFocusMode(false);
          }
          return;
        }
        setIsEmbedFocusMode(false);
        return;
      }

      const target = embedContainerRef.current;
      if (!target) {
        return;
      }

      try {
        await requestElementFullscreen(target);
        setIsEmbedFocusMode(false);
      } catch {
        setIsEmbedFocusMode(true);
      }
    }

    return (
      <div
        ref={embedContainerRef}
        data-testid={isEmbedExpanded ? "immersive-embed-expanded-root" : "immersive-embed-root"}
        className={cn(
          "overflow-hidden bg-[#050b16]",
          isEmbedExpanded
            ? "fixed inset-0 z-[120] h-[var(--immersive-viewport-height,100dvh)] w-[var(--immersive-viewport-width,100vw)] [overscroll-behavior:none] [touch-action:none]"
            : "relative h-screen w-screen",
        )}
      >
        {renderScene({ fullscreen: isEmbedExpanded, isMobile: false })}
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="pointer-events-auto absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-20 flex items-center gap-2">
            {!(isEmbedMode && isIPhoneWebKitBrowser() && !hasWrapper) && (
              <>
                {canonicalHref && !showEmbedFullscreenControl ? (
                  <a
                    href={(() => {
                      try {
                        const u = new URL(canonicalHref, window.location.origin);
                        u.searchParams.set("fullscreen", "1");
                        return u.toString();
                      } catch {
                        return canonicalHref;
                      }
                    })()}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open in immersive view"
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border border-white/20 bg-black/55 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white shadow-lg backdrop-blur transition hover:bg-black/70"
                  >
                    <Box className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    <span aria-hidden="true">VR</span>
                  </a>
                ) : null}
                {showEmbedFullscreenControl
                && !(suppressFullscreenControlOnIPhone && isIPhoneWebKitBrowser()) ? (
                  <FullscreenToggleButton
                    isFullscreen={isEmbedExpanded}
                    onToggle={handleEmbedToggle}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={routeContainerRef} className="bg-[#050b16]">
      {isFullscreen ? (
        <div
          data-testid="immersive-fullscreen-root"
          className="fixed inset-0 z-[120] h-[var(--immersive-viewport-height,100dvh)] w-[var(--immersive-viewport-width,100vw)] overflow-hidden bg-[#050b16] [overscroll-behavior:none] [touch-action:none]"
        >
          <div className="relative h-full w-full overflow-hidden">
            {renderScene({ fullscreen: true, isMobile: true })}
            <div className="pointer-events-none absolute inset-0 z-10">
              <div className="pointer-events-auto absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-[130]">
                <FullscreenToggleButton isFullscreen onToggle={handleRouteFullscreenToggle} />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-screen overflow-x-hidden bg-[#050b16] text-white",
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="min-w-0 flex-1 text-right">
            <p className="text-xs uppercase tracking-[0.22em] text-white/55">Immersive View</p>
            <p className="break-words text-sm font-medium leading-tight text-white/80 sm:text-base">
              {title}
            </p>
          </div>
        </header>

        <main className="pb-6">
          <section className="relative shrink-0 border-b border-white/10">
            <div className={cn("w-full overflow-hidden", sceneHeightClassName)}>
              {!isFullscreen && renderScene({ fullscreen: false, isMobile: true })}
            </div>
            <div className="pointer-events-none absolute inset-0 z-10">
              <div className="pointer-events-auto absolute bottom-4 right-4 z-20">
                <FullscreenToggleButton isFullscreen={false} onToggle={handleRouteFullscreenToggle} />
              </div>
            </div>
          </section>

          {embedCodes && (
            <section className="flex flex-wrap gap-2 border-b border-white/10 px-4 py-3 sm:px-6">
              <EmbedCopyButton label={embedCodes.plain.label} code={embedCodes.plain.code} />
              <EmbedCopyButton label={embedCodes.gallery.label} code={embedCodes.gallery.code} />
              {embedCodes.galleryCms && (
                <EmbedCopyButton label={embedCodes.galleryCms.label} code={embedCodes.galleryCms.code} />
              )}
            </section>
          )}

          <section className="shrink-0 bg-white/[0.03] p-5">{metadataCard}</section>
        </main>
      </div>
    </div>
  );
}

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
  canonicalHref?: string;
  embedCodes?: EmbedCodes;
};

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
  sceneHeightClassName = "h-[40svh] min-h-[16rem]",
  isEmbedMode = false,
  canonicalHref,
  embedCodes,
}: ImmersiveRouteShellProps) {
  const embedContainerRef = useRef<HTMLDivElement>(null);
  const [isEmbedFullscreen, setIsEmbedFullscreen] = useState(false);

  useEffect(() => {
    if (!isEmbedMode) return;
    function onFullscreenChange() {
      setIsEmbedFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [isEmbedMode]);

  useEffect(() => {
    if (!isFullscreen || isEmbedMode) {
      return;
    }
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isFullscreen, isEmbedMode]);

  if (isEmbedMode) {
    function handleEmbedToggle() {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        embedContainerRef.current?.requestFullscreen();
      }
    }

    return (
      <div
        ref={embedContainerRef}
        className="relative h-screen w-screen overflow-hidden bg-[#050b16]"
      >
        {renderScene({ fullscreen: false, isMobile: false })}
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="pointer-events-auto absolute bottom-4 right-4 z-20">
            <FullscreenToggleButton
              isFullscreen={isEmbedFullscreen}
              onToggle={handleEmbedToggle}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {isFullscreen ? (
        <div className="fixed inset-0 z-[120] bg-[#050b16]">
          <div className="relative h-full w-full overflow-hidden">
            {renderScene({ fullscreen: true, isMobile: true })}
            <div className="pointer-events-none absolute inset-0 z-10">
              <div className="pointer-events-auto absolute bottom-4 right-4 z-[130]">
                <FullscreenToggleButton isFullscreen onToggle={onToggleFullscreen} />
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
              {renderScene({ fullscreen: false, isMobile: true })}
            </div>
            <div className="pointer-events-none absolute inset-0 z-10">
              <div className="pointer-events-auto absolute bottom-4 right-4 z-20">
                <FullscreenToggleButton isFullscreen={false} onToggle={onToggleFullscreen} />
              </div>
            </div>
          </section>

          {embedCodes && (
            <section className="flex flex-wrap gap-2 border-b border-white/10 px-4 py-3 sm:px-6">
              <EmbedCopyButton label={embedCodes.plain.label} code={embedCodes.plain.code} />
              <EmbedCopyButton label={embedCodes.gallery.label} code={embedCodes.gallery.code} />
            </section>
          )}

          <section className="shrink-0 bg-white/[0.03] p-5">{metadataCard}</section>
        </main>
      </div>
    </>
  );
}

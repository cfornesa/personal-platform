import React, { useEffect, useRef } from "react";
import type { ArtPieceEngine } from "@workspace/api-client-react";
import { ImmersiveMediaFrame } from "@/components/immersive/ImmersiveMediaFrame";
import { buildArtPieceSrcDoc } from "@/lib/art-piece-runtime";

type ArtPieceRendererProps = {
  engine: ArtPieceEngine;
  code: string;
  htmlCode?: string | null;
  cssCode?: string | null;
  className?: string;
  iframeClassName?: string;
  height?: number;
  title?: string;
  onStatusChange?: (status: { valid: boolean; error: string | null; warning?: string | null }) => void;
  immersiveHref?: string | null;
  diagnostics?: boolean;
};

export function ArtPieceRenderer({
  engine,
  code,
  htmlCode,
  cssCode,
  className,
  iframeClassName,
  height = 420,
  title,
  onStatusChange,
  immersiveHref,
  diagnostics = false,
}: ArtPieceRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "sketch-status") {
        onStatusChange?.({
          valid: event.data.valid,
          error: event.data.error ?? null,
          warning: event.data.warning ?? null,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onStatusChange]);

  const srcDoc = buildArtPieceSrcDoc(engine, code, htmlCode, cssCode, { diagnostics });

  const iframe = (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      title={title}
      className={iframeClassName ?? "w-full rounded-xl border border-border bg-transparent"}
      style={{ height: height, minHeight: height }}
      sandbox="allow-scripts allow-same-origin"
      frameBorder="0"
    />
  );

  if (immersiveHref) {
    return (
      <ImmersiveMediaFrame
        href={immersiveHref}
        label={`Open ${title || "piece"} in immersive view`}
        className={className}
      >
        {iframe}
      </ImmersiveMediaFrame>
    );
  }

  return (
    <div className={className}>
      {iframe}
    </div>
  );
}

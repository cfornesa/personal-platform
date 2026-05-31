import { useEffect, useMemo } from "react";
import { useRoute } from "wouter";
import {
  getGetEmbeddedArtPieceQueryKey,
  useGetEmbeddedArtPiece,
} from "@workspace/api-client-react";
import { ArtPieceRenderer } from "@/components/post/ArtPieceRenderer";
import { buildImmersivePieceHref } from "@/lib/immersive-view";

export default function PieceEmbed() {
  const [, params] = useRoute("/embed/pieces/:id");
  const pieceId = Number(params?.id);
  const searchParams = new URLSearchParams(window.location.search);
  const version = searchParams.get("version");
  const versionId = version ? Number(version) : undefined;
  const immersiveEmbedHref = useMemo(() => {
    const href = new URL(buildImmersivePieceHref(pieceId, versionId), window.location.origin);
    href.searchParams.set("embed", "1");
    return href.toString();
  }, [pieceId, versionId]);

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
    if (data?.version.engine !== "three") {
      return;
    }
    window.location.replace(immersiveEmbedHref);
  }, [data?.version.engine, immersiveEmbedHref]);

  if (isLoading) {
    return <div className="min-h-screen animate-pulse bg-transparent" />;
  }

  if (!data || error || !Number.isFinite(pieceId) || pieceId <= 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent p-8 text-center">
        <div>
          <h1 className="text-lg font-semibold">Piece not found</h1>
          <p className="text-sm text-muted-foreground">
            The interactive piece you requested is unavailable.
          </p>
        </div>
      </div>
    );
  }

  if (data.version.engine === "three") {
    return <div className="min-h-screen bg-[#050b16]" />;
  }

  return (
    <div className="min-h-screen bg-transparent">
      <ArtPieceRenderer
        engine={data.version.engine}
        code={data.version.generatedCode}
        htmlCode={data.version.htmlCode}
        cssCode={data.version.cssCode}
        className="h-screen"
        iframeClassName="h-full w-full bg-transparent"
        height={window.innerHeight || 460}
      />
    </div>
  );
}

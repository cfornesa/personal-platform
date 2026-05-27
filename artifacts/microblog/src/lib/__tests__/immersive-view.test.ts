import { describe, expect, it } from "vitest";
import {
  buildPieceGalleryEmbedHtml,
  buildImmersiveImageHref,
  buildImmersivePieceHref,
  encodeImmersiveImageRef,
  extractPieceEmbedMeta,
  resolveImmersiveImageSrc,
} from "../immersive-view";

describe("immersive-view helpers", () => {
  it("encodes same-origin images as relative immersive routes", () => {
    const href = buildImmersiveImageHref("http://localhost:4000/media/example.jpg", {
      alt: "Studio lights",
    });
    expect(href).toContain("/immersive/images/");
    expect(href).toContain("alt=Studio+lights");
  });

  it("restores an encoded relative image ref against the current origin", () => {
    const encoded = encodeImmersiveImageRef("/media/example.jpg");
    const resolved = resolveImmersiveImageSrc(encoded);
    expect(resolved).toBe("http://localhost:3000/media/example.jpg");
  });

  it("builds piece immersive routes with optional versions", () => {
    expect(buildImmersivePieceHref(12)).toBe("/immersive/pieces/12");
    expect(buildImmersivePieceHref(12, 4)).toBe("/immersive/pieces/12?version=4");
  });

  it("extracts piece metadata from embed urls", () => {
    expect(extractPieceEmbedMeta("/embed/pieces/9?version=3")).toEqual({
      id: 9,
      versionId: 3,
      pieceOrigin: "http://localhost:3000",
    });
  });

  it("builds interactive embeds from the immersive route contract", () => {
    expect(buildPieceGalleryEmbedHtml(7, 9, "Orbit Bloom")).toBe(
      '<iframe src="http://localhost:3000/immersive/pieces/7?embed=1&version=9" width="100%" style="width:100%;aspect-ratio:16 / 9;display:block;" title="Orbit Bloom" frameborder="0" loading="lazy" allowfullscreen allow="fullscreen" sandbox="allow-scripts allow-same-origin"></iframe>',
    );
  });
});

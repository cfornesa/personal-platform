import { describe, expect, it } from "vitest";
import {
  buildPieceGalleryEmbedHtml,
  buildImageGalleryEmbedHtml,
  buildExhibitGalleryEmbedHtml,
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
    expect(buildPieceGalleryEmbedHtml(7, 9, "Orbit Bloom", "http://localhost:3000")).toBe(
      '<creatr-art-piece piece-id="7" version="9" origin="http://localhost:3000"><iframe src="http://localhost:3000/immersive/pieces/7?embed=1&version=9" width="100%" style="width:100%;aspect-ratio:16 / 9;min-height:300px;display:block;" title="Orbit Bloom" frameborder="0" loading="lazy" allowfullscreen allow="fullscreen" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"></iframe></creatr-art-piece><script src="http://localhost:3000/embed.js" defer></script>',
    );
  });

  it("builds interactive image embeds with custom element wrappers", () => {
    const encodedRef = encodeImmersiveImageRef("/media/example.jpg", "http://localhost:3000");
    expect(
      buildImageGalleryEmbedHtml(
        encodedRef,
        { title: "My Image", alt: "Alt text" },
        "http://localhost:3000",
      ),
    ).toBe(
      `<creatr-immersive-image ref="${encodedRef}" origin="http://localhost:3000"><iframe src="http://localhost:3000/immersive/images/${encodedRef}?embed=1&alt=Alt+text&title=My+Image" width="100%" style="width:100%;aspect-ratio:16 / 9;min-height:300px;display:block;" title="My Image" frameborder="0" loading="lazy" allowfullscreen allow="fullscreen" sandbox="allow-scripts allow-same-origin"></iframe></creatr-immersive-image><script src="http://localhost:3000/embed.js" defer></script>`,
    );
  });

  it("builds interactive exhibit embeds with custom element wrappers", () => {
    expect(
      buildExhibitGalleryEmbedHtml("my-exhibit", "My Exhibit", "http://localhost:3000"),
    ).toBe(
      '<creatr-exhibit-wall slug="my-exhibit" origin="http://localhost:3000"><iframe src="http://localhost:3000/immersive/exhibits/my-exhibit?embed=1" width="100%" style="width:100%;aspect-ratio:16 / 9;min-height:300px;display:block;" title="My Exhibit" frameborder="0" loading="lazy" allowfullscreen allow="fullscreen" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"></iframe></creatr-exhibit-wall><script src="http://localhost:3000/embed.js" defer></script>',
    );
  });
});

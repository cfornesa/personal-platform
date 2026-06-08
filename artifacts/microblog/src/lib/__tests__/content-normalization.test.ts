import { describe, expect, it } from "vitest";
import {
  normalizeExhibitEmbedSrc,
  normalizePieceEmbedSrc,
  normalizePieceEmbedUrls,
} from "../content-normalization";

const CANONICAL_ORIGIN = "https://chrisfornesa.com";

describe("normalizePieceEmbedSrc", () => {
  it("rewrites a relative piece embed path to the canonical origin", () => {
    expect(normalizePieceEmbedSrc("/embed/pieces/5?version=2", CANONICAL_ORIGIN)).toBe(
      `${CANONICAL_ORIGIN}/embed/pieces/5?version=2`,
    );
  });

  it("rewrites a local-dev-host piece embed to the canonical origin", () => {
    expect(normalizePieceEmbedSrc("http://localhost:4000/embed/pieces/5?version=2", CANONICAL_ORIGIN)).toBe(
      `${CANONICAL_ORIGIN}/embed/pieces/5?version=2`,
    );
    expect(normalizePieceEmbedSrc("http://127.0.0.1:4000/embed/pieces/5", CANONICAL_ORIGIN)).toBe(
      `${CANONICAL_ORIGIN}/embed/pieces/5`,
    );
  });

  it("preserves a piece embed pointing at a different site's origin", () => {
    const foreignSrc = "https://platform.creatrweb.com/embed/pieces/9?version=3";
    expect(normalizePieceEmbedSrc(foreignSrc, CANONICAL_ORIGIN)).toBe(foreignSrc);
  });

  it("leaves non-piece-embed URLs untouched", () => {
    const youtubeSrc = "https://www.youtube.com/embed/dQw4w9WgXcQ";
    expect(normalizePieceEmbedSrc(youtubeSrc, CANONICAL_ORIGIN)).toBe(youtubeSrc);
  });
});

describe("normalizeExhibitEmbedSrc", () => {
  it("rewrites a relative exhibit embed path to the canonical origin", () => {
    expect(normalizeExhibitEmbedSrc("/immersive/exhibits/my-exhibit?embed=1", CANONICAL_ORIGIN)).toBe(
      `${CANONICAL_ORIGIN}/immersive/exhibits/my-exhibit?embed=1`,
    );
  });

  it("rewrites a local-dev-host exhibit embed to the canonical origin", () => {
    expect(normalizeExhibitEmbedSrc("http://localhost:4000/immersive/exhibits/my-exhibit", CANONICAL_ORIGIN)).toBe(
      `${CANONICAL_ORIGIN}/immersive/exhibits/my-exhibit`,
    );
  });

  it("preserves an exhibit embed pointing at a different site's origin", () => {
    const foreignSrc = "https://platform.creatrweb.com/immersive/exhibits/my-exhibit?embed=1";
    expect(normalizeExhibitEmbedSrc(foreignSrc, CANONICAL_ORIGIN)).toBe(foreignSrc);
  });
});

describe("normalizePieceEmbedUrls", () => {
  it("rewrites local-dev piece embeds while preserving cross-site embeds in the same document", () => {
    const html =
      '<p>Mine:</p><iframe src="http://localhost:4000/embed/pieces/5?version=2"></iframe>' +
      '<p>Cross-posted:</p><iframe src="https://platform.creatrweb.com/embed/pieces/9"></iframe>' +
      '<p>External:</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>';

    const result = normalizePieceEmbedUrls(html, CANONICAL_ORIGIN);

    expect(result).toContain(`src="${CANONICAL_ORIGIN}/embed/pieces/5?version=2"`);
    expect(result).toContain('src="https://platform.creatrweb.com/embed/pieces/9"');
    expect(result).toContain('src="https://www.youtube.com/embed/dQw4w9WgXcQ"');
  });
});

import { describe, expect, it } from "vitest";
import { normalizePieceUrlsInHtml } from "./feeds";

const FEED_ORIGIN = "https://chrisfornesa.com";

describe("normalizePieceUrlsInHtml", () => {
  it("rewrites relative piece embed src/href to the feed's origin", () => {
    const html = '<iframe src="/embed/pieces/5?version=2"></iframe><a href="/immersive/pieces/5">View</a>';
    const result = normalizePieceUrlsInHtml(html, FEED_ORIGIN);
    expect(result).toContain(`src="${FEED_ORIGIN}/embed/pieces/5?version=2"`);
    expect(result).toContain(`href="${FEED_ORIGIN}/immersive/pieces/5"`);
  });

  it("rewrites local-dev-host piece embeds to the feed's origin", () => {
    const html = '<iframe src="http://localhost:4000/embed/pieces/5?version=2"></iframe>';
    expect(normalizePieceUrlsInHtml(html, FEED_ORIGIN)).toContain(
      `src="${FEED_ORIGIN}/embed/pieces/5?version=2"`,
    );
  });

  it("preserves piece embeds pointing at a different site's origin", () => {
    const html =
      '<iframe src="https://platform.creatrweb.com/embed/pieces/9?version=3"></iframe>' +
      '<a href="https://platform.creatrweb.com/immersive/pieces/9">View</a>';
    expect(normalizePieceUrlsInHtml(html, FEED_ORIGIN)).toBe(html);
  });

  it("returns the input untouched when no piece URLs are present", () => {
    const html = '<p>Hello</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>';
    expect(normalizePieceUrlsInHtml(html, FEED_ORIGIN)).toBe(html);
  });
});

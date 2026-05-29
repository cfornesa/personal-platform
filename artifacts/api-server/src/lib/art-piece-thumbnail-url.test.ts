import { describe, expect, it } from "vitest";
import { isValidArtPieceThumbnailUrl } from "./art-piece-thumbnail-url";

describe("isValidArtPieceThumbnailUrl", () => {
  it("accepts self-hosted media URLs", () => {
    expect(isValidArtPieceThumbnailUrl("/api/media/art-piece-1-thumbnail.png")).toBe(true);
  });

  it("accepts absolute HTTP URLs", () => {
    expect(isValidArtPieceThumbnailUrl("https://example.com/thumb.png")).toBe(true);
  });

  it("rejects invalid thumbnail strings", () => {
    expect(isValidArtPieceThumbnailUrl("media/thumb.png")).toBe(false);
    expect(isValidArtPieceThumbnailUrl("/api/media/")).toBe(false);
    expect(isValidArtPieceThumbnailUrl("javascript:alert(1)")).toBe(false);
  });
});

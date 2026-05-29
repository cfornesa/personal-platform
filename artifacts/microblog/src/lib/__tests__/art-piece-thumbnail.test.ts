import { describe, expect, it, vi } from "vitest";
import { persistArtPieceThumbnailBlob } from "@/lib/art-piece-thumbnail";
import { updateArtPiece, uploadMedia } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    uploadMedia: vi.fn(),
    updateArtPiece: vi.fn(),
  };
});

describe("persistArtPieceThumbnailBlob", () => {
  it("uploads a captured thumbnail and patches the piece thumbnail URL", async () => {
    vi.mocked(uploadMedia).mockResolvedValue({
      url: "/api/media/thumb.png",
      title: "thumb",
      mimeType: "image/png",
      width: null,
      height: null,
    });
    vi.mocked(updateArtPiece).mockResolvedValue({} as any);

    await persistArtPieceThumbnailBlob(
      { id: 12 },
      new Blob(["png"], { type: "image/png" }),
    );

    expect(uploadMedia).toHaveBeenCalledWith({
      file: expect.any(File),
    });
    expect(updateArtPiece).toHaveBeenCalledWith(12, {
      thumbnailUrl: "/api/media/thumb.png",
    });
  });
});

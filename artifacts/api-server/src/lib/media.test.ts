import { beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.fn();
const lookup = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn(() => ({ values: insertValues })),
    select: vi.fn(),
    update: vi.fn(),
  },
  mediaAssetsTable: {},
  eq: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  default: { lookup },
}));

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

describe("media helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookup.mockResolvedValue([{ address: "93.184.216.34" }]);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("derives readable titles from filenames and URLs", async () => {
    const { deriveMediaTitle } = await import("./media");

    expect(deriveMediaTitle("my-photo_upload.jpg")).toBe("my photo upload");
    expect(deriveMediaTitle("https://example.com/images/sunset-over-lake.webp?size=large")).toBe("sunset over lake");
    expect(deriveMediaTitle("")).toBe("Untitled image");
  });

  it("stores uploaded images with a title", async () => {
    const { storeUploadedImage } = await import("./media");

    const uploaded = await storeUploadedImage(png1x1, "Test image");

    expect(uploaded.title).toBe("Test image");
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      title: "Test image",
      mimeType: "image/png",
      fileData: png1x1,
    }));
  });

  it("fetches a public remote image for import", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(png1x1, {
      status: 200,
      headers: { "content-type": "image/png" },
    }));
    const { fetchRemoteImageForImport } = await import("./media");

    const buffer = await fetchRemoteImageForImport("https://example.com/image.png");

    expect(buffer.equals(png1x1)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "manual" }));
  });

  it("rejects oversized remote images by content length", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("too large", {
      status: 200,
      headers: { "content-length": String(8 * 1024 * 1024 + 1) },
    }));
    const { fetchRemoteImageForImport } = await import("./media");

    await expect(fetchRemoteImageForImport("https://example.com/image.png"))
      .rejects.toMatchObject({ statusCode: 413, message: "Imported images must be 8 MB or smaller." });
  });

  it("rejects invalid URL input", async () => {
    const { fetchRemoteImageForImport } = await import("./media");

    await expect(fetchRemoteImageForImport("not a url"))
      .rejects.toThrow("Enter a valid image URL.");
  });

  it("rejects private and local targets", async () => {
    const { fetchRemoteImageForImport } = await import("./media");

    await expect(fetchRemoteImageForImport("http://127.0.0.1/image.png"))
      .rejects.toThrow("Image URL must point to a public host.");
    await expect(fetchRemoteImageForImport("http://localhost/image.png"))
      .rejects.toThrow("Image URL must point to a public host.");
  });

  it("rejects redirects to private targets", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/image.png" },
    }));
    const { fetchRemoteImageForImport } = await import("./media");

    await expect(fetchRemoteImageForImport("https://example.com/image.png"))
      .rejects.toThrow("Image URL must point to a public host.");
  });
});

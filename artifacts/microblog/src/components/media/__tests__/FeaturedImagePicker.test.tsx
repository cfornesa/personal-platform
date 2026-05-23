import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeaturedImagePicker } from "../FeaturedImagePicker";

const importMedia = vi.fn();
const uploadMedia = vi.fn();
const updateMediaAltText = vi.fn();
const toast = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getListMediaQueryKey: () => ["listMedia"],
  useListMedia: () => ({ data: [], isLoading: false }),
  useUploadMedia: () => ({ mutateAsync: uploadMedia, isPending: false }),
  useImportMedia: () => ({ mutateAsync: importMedia, isPending: false }),
  useUpdateMediaAltText: () => ({ mutateAsync: updateMediaAltText }),
  useDescribeImage: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

function renderPicker(onSelect = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <FeaturedImagePicker open onOpenChange={vi.fn()} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return { onSelect };
}

describe("FeaturedImagePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importMedia.mockResolvedValue({
      url: "/api/media/imported.png",
      title: "Imported",
      mimeType: "image/png",
      width: null,
      height: null,
    });
    uploadMedia.mockResolvedValue({
      url: "/api/media/uploaded.png",
      title: "Uploaded",
      mimeType: "image/png",
      width: null,
      height: null,
    });
    updateMediaAltText.mockResolvedValue({});
  });

  it("imports pasted image URLs before selecting them", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();

    await user.click(screen.getByRole("button", { name: "URL" }));
    await user.type(screen.getByLabelText("External image URL"), "https://example.com/photo.png");
    expect(screen.queryByLabelText("Alt text (optional)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import image" }));

    await waitFor(() => {
      expect(importMedia).toHaveBeenCalledWith({
        data: {
          imageUrl: "https://example.com/photo.png",
        },
      });
    });
    expect(screen.getByLabelText("Title")).toHaveValue("Imported");
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Updated title");
    await user.type(screen.getByPlaceholderText("Describe this image for screen readers"), "A photo");
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use this image" }));
    await waitFor(() => {
      expect(updateMediaAltText).toHaveBeenCalledWith({
        fileName: "imported.png",
        data: {
          title: "Updated title",
          altText: "A photo",
        },
      });
    });
    expect(onSelect).toHaveBeenCalledWith("/api/media/imported.png", "A photo");
  });

  it("requires an explicit upload button before selecting uploaded images", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();
    const file = new File(["image"], "uploaded.png", { type: "image/png" });

    await user.click(screen.getByRole("button", { name: "Upload" }));
    await user.upload(screen.getByLabelText("Choose image file"), file);

    expect(uploadMedia).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Upload image" }));

    await waitFor(() => {
      expect(uploadMedia).toHaveBeenCalledWith({ data: { file } });
    });
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use this image" }));
    expect(onSelect).toHaveBeenCalledWith("/api/media/uploaded.png", undefined);
  });

  it("warns before closing with an unimported URL", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("button", { name: "URL" }));
    await user.type(screen.getByLabelText("External image URL"), "https://example.com/photo.png");
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getByText("Discard image changes?")).toBeInTheDocument();
    expect(screen.getByText(/started an upload\/import/)).toBeInTheDocument();
  });
});

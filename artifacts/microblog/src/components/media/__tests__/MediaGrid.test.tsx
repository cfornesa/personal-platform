import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@workspace/api-client-react";
import { MediaGrid } from "../MediaGrid";

const toast = vi.fn();
const writeText = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

const asset: MediaAsset = {
  id: 1,
  url: "/api/media/test.png",
  filename: "test.png",
  title: "Test image",
  mimeType: "image/png",
  altText: "Existing alt",
  uploadedAt: "2026-05-22T12:00:00.000Z",
};

describe("MediaGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
  });

  it("shows titles on tiles and saves details from the dialog", async () => {
    const user = userEvent.setup();
    const onSaveDetails = vi.fn().mockResolvedValue(undefined);

    render(
      <MediaGrid
        assets={[asset]}
        mode="manage"
        onSaveDetails={onSaveDetails}
      />,
    );

    expect(screen.getByText("Test image")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Test image" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Updated title");
    await user.clear(screen.getByLabelText("Alt text"));
    await user.type(screen.getByLabelText("Alt text"), "Updated alt");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(onSaveDetails).toHaveBeenCalledWith(asset, {
        title: "Updated title",
        altText: "Updated alt",
      });
    });
  });

  it("copies the local media URL from the dialog", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<MediaGrid assets={[asset]} mode="manage" />);

    await user.click(screen.getByRole("button", { name: "Open Test image" }));
    await user.click(screen.getByRole("button", { name: "Copy URL" }));

    await waitFor(() => {
    expect(writeText).toHaveBeenCalledWith(new URL("/api/media/test.png", window.location.origin).toString());
      expect(toast).toHaveBeenCalledWith({ title: "Image URL copied" });
    });
  });

  it("confirms before deleting an image", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(<MediaGrid assets={[asset]} mode="manage" onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "Open Test image" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByText("Delete this image?")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete image" }));
    expect(onDelete).toHaveBeenCalledWith(asset);
  });

  it("warns before closing with unsaved metadata changes", async () => {
    const user = userEvent.setup();

    render(<MediaGrid assets={[asset]} mode="manage" />);

    await user.click(screen.getByRole("button", { name: "Open Test image" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Changed but unsaved");
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getByText("Discard unsaved image details?")).toBeInTheDocument();
    expect(screen.getByText(/Closing now will discard them/)).toBeInTheDocument();
  });
});

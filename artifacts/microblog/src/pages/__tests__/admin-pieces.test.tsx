import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminPiecesPage from "@/pages/admin/admin-pieces";

vi.mock("@workspace/api-client-react", () => ({
  ApiError: class extends Error {},
  generateArtPiece: vi.fn(),
  getGetArtPieceQueryKey: () => ["art-piece", 1],
  getGetMyAiSettingsQueryKey: () => ["ai-settings"],
  getListExhibitsQueryKey: () => ["exhibits"],
  getListArtPiecesQueryKey: () => ["art-pieces"],
  useCreateArtPiece: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateArtPieceVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteArtPiece: () => ({ mutate: vi.fn(), isPending: false }),
  useGetArtPiece: () => ({
    data: {
      id: 1,
      title: "Three.js Abstract",
      prompt: "Main description text",
      engine: "three",
      exhibitIds: [1],
      currentVersionId: 10,
      currentVersion: {
        id: 10,
        engine: "three",
        htmlCode: "<div id='container'></div>",
        cssCode: "",
        generatedCode: "window.sketch = () => {};",
        structuredSpec: null,
      },
      versions: [
        {
          id: 10,
          engine: "three",
          prompt: "Main description text",
          createdAt: "2026-05-28T00:00:00.000Z",
        },
      ],
    },
    isLoading: false,
  }),
  useListArtPieces: () => ({
    data: {
      pieces: [
        {
          id: 1,
          title: "Three.js Abstract",
          prompt: "Main description text",
          engine: "three",
        },
      ],
    },
    isLoading: false,
  }),
  useProcessAiText: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMyAiSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateArtPiece: () => ({ mutate: vi.fn(), isPending: false }),
  useSetArtPieceExhibits: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/post/ArtPieceRenderer", () => ({
  ArtPieceRenderer: () => <div data-testid="piece-renderer" />,
}));

vi.mock("@/components/post/ArtPieceDraftDialog", () => ({
  ArtPieceDraftDialog: () => null,
}));

vi.mock("@/components/post/ArtPieceGenerationDialog", () => ({
  ArtPieceGenerationDialog: () => null,
}));

vi.mock("@/components/post/ExhibitMultiSelect", () => ({
  ExhibitMultiSelect: () => <div data-testid="exhibit-multi-select" />,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-owner-ai-vendors", () => ({
  useOwnerAiVendors: () => ({
    aiVendors: [{ id: "google", label: "Google" }],
    pieceVendors: [{ id: "google", label: "Google" }],
    preferredArtPieceVendor: "google",
    preferredVendorTextImprove: "google",
  }),
}));

vi.mock("@/lib/immersive-view", () => ({
  buildImmersivePieceHref: () => "/immersive/pieces/1",
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AdminPiecesPage />
    </QueryClientProvider>,
  );
}

describe("AdminPiecesPage", () => {
  it("uses only the main description field for piece metadata", async () => {
    renderPage();

    expect(await screen.findByLabelText("Description")).toBeInTheDocument();
    expect(screen.queryByLabelText("Piece Description (optional)")).toBeNull();
  });
});

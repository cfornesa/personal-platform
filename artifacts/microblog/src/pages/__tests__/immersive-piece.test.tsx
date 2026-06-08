import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import ImmersivePiecePage from "@/pages/immersive-piece";

const mockUseRoute = vi.fn();
const mockUseLocation = vi.fn();
const mockUseGetEmbeddedArtPiece = vi.fn();
const capturedShellProps: Array<Record<string, unknown>> = [];

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    useRoute: (...args: unknown[]) => mockUseRoute(...args),
    useLocation: (...args: unknown[]) => mockUseLocation(...args),
  };
});

vi.mock("@workspace/api-client-react", () => ({
  getGetEmbeddedArtPieceQueryKey: (pieceId: number, params?: unknown) => [
    "embedded-art-piece",
    pieceId,
    params,
  ],
  useGetEmbeddedArtPiece: (...args: unknown[]) => mockUseGetEmbeddedArtPiece(...args),
}));

vi.mock("@/components/post/ArtPieceRenderer", () => ({
  ArtPieceRenderer: () => <div data-testid="art-piece-renderer" />,
}));

vi.mock("@/components/immersive/ImmersiveRouteShell", () => ({
  ImmersiveMetadataCard: ({ title }: { title: string }) => <div>{title}</div>,
  ImmersiveRouteShell: (props: Record<string, unknown>) => {
    capturedShellProps.push(props);
    return <div data-testid="immersive-route-shell" />;
  },
}));

function renderPage(url: string) {
  window.history.replaceState(null, "", url);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <ImmersivePiecePage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("ImmersivePiecePage", () => {
  beforeEach(() => {
    capturedShellProps.length = 0;
    mockUseRoute.mockReturnValue([true, { id: "7" }]);
    mockUseLocation.mockReturnValue(["/immersive/pieces/7", vi.fn()]);
    mockUseGetEmbeddedArtPiece.mockReturnValue({
      data: {
        title: "Orbit Bloom",
        version: {
          engine: "p5",
          generatedCode: "window.sketch = () => {};",
          htmlCode: null,
          cssCode: null,
          prompt: "Alt text prompt.",
        },
      },
      isLoading: false,
      error: null,
    });
  });

  it("passes the canonical immersive href into embed mode", () => {
    renderPage("/immersive/pieces/7?embed=1&version=9");

    expect(screen.getByTestId("immersive-route-shell")).toBeTruthy();
    expect(capturedShellProps.at(-1)?.isEmbedMode).toBe(true);
    expect(capturedShellProps.at(-1)?.canonicalHref).toBe(
      `${window.location.origin}/immersive/pieces/7?version=9`,
    );
    expect(capturedShellProps.at(-1)?.enableIPhoneEmbedLauncher).toBe(true);
  });
});

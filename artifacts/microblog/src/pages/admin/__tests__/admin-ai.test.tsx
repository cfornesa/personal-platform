import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminAiPage from "@/pages/admin/admin-ai";

const updateAiMutate = vi.fn();
const toastSpy = vi.fn();
const mockAiSettings = {
  availableVendors: [
    { id: "openrouter", label: "OpenRouter" },
    { id: "opencode-zen", label: "Opencode Zen" },
    { id: "opencode-go", label: "Opencode Go" },
    { id: "google", label: "Google" },
    { id: "mistral", label: "Mistral AI" },
    { id: "mistral-vibe", label: "Mistral Vibe" },
    { id: "deepseek", label: "DeepSeek" },
  ],
  preferredArtPieceVendor: null,
  preferredVendorTextImprove: null,
  preferredVendorAltText: null,
  settings: [
    { vendor: "openrouter", vendorLabel: "OpenRouter", enabled: false, configured: false, model: null },
    { vendor: "opencode-zen", vendorLabel: "Opencode Zen", enabled: false, configured: false, model: null },
    { vendor: "opencode-go", vendorLabel: "Opencode Go", enabled: false, configured: false, model: null },
    { vendor: "google", vendorLabel: "Google", enabled: true, configured: true, model: "gemini-2.5-flash" },
    { vendor: "mistral", vendorLabel: "Mistral AI", enabled: false, configured: false, model: null },
    { vendor: "mistral-vibe", vendorLabel: "Mistral Vibe", enabled: false, configured: false, model: null },
    { vendor: "deepseek", vendorLabel: "DeepSeek", enabled: true, configured: true, model: null },
  ],
};

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => ({
    currentUser: { id: "owner-1", role: "owner" },
    isOwner: true,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMyAiSettings: () => ({
    data: mockAiSettings,
    isLoading: false,
  }),
  getGetMyAiSettingsQueryKey: () => ["ai-settings"],
  useUpdateMyAiSettings: (options?: any) => ({
    mutate: (payload: unknown) => {
      updateAiMutate(payload);
      options?.mutation?.onSuccess?.(mockAiSettings);
    },
    isPending: false,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminAiPage />
    </QueryClientProvider>,
  );
}

describe("AdminAiPage", () => {
  beforeEach(() => {
    updateAiMutate.mockReset();
    toastSpy.mockReset();
  });

  it("renders one section per supported vendor", () => {
    renderPage();

    expect(screen.getByText("OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("Opencode Zen")).toBeInTheDocument();
    expect(screen.getByText("Opencode Go")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Google" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mistral AI" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mistral Vibe" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DeepSeek" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("deepseek-v4-flash")).toBeInTheDocument();
  });

  it("blocks enabling a vendor without an API key on first setup", async () => {
    const user = userEvent.setup();
    renderPage();

    const openrouterSection = screen.getByText("OpenRouter").closest("section");
    expect(openrouterSection).not.toBeNull();
    await user.click(within(openrouterSection!).getByRole("checkbox"));
    await user.type(within(openrouterSection!).getByLabelText("Model Slug"), "anthropic/claude-sonnet-4.5");
    await user.click(screen.getByRole("button", { name: "Save AI Settings" }));

    expect(updateAiMutate).not.toHaveBeenCalled();
    expect(screen.getByText("OpenRouter requires an API key before it can be enabled.")).toBeInTheDocument();
  });

  it("submits per-vendor settings", async () => {
    const user = userEvent.setup();
    renderPage();

    const openrouterSection = screen.getByText("OpenRouter").closest("section");
    expect(openrouterSection).not.toBeNull();
    await user.click(within(openrouterSection!).getByRole("checkbox"));
    await user.type(within(openrouterSection!).getByLabelText("Model Slug"), "anthropic/claude-sonnet-4.5");
    await user.type(within(openrouterSection!).getByLabelText("API Key"), "sk-openrouter");
    await user.click(screen.getByRole("button", { name: "Save AI Settings" }));

    expect(updateAiMutate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settings: expect.arrayContaining([
          expect.objectContaining({
            vendor: "openrouter",
            enabled: true,
            model: "anthropic/claude-sonnet-4.5",
            apiKey: "sk-openrouter",
          }),
        ]),
      }),
    });
  });

  it("offers DeepSeek for text and art piece preferences but not visual descriptions", async () => {
    const user = userEvent.setup();
    renderPage();

    const textPreference = screen.getByLabelText("Text improvement");
    const visualPreference = screen.getByLabelText("Visual descriptions");
    const artPreference = screen.getByLabelText("Art pieces");

    expect(within(textPreference).getByRole("option", { name: "DeepSeek" })).toBeInTheDocument();
    expect(within(artPreference).getByRole("option", { name: "DeepSeek" })).toBeInTheDocument();
    expect(within(visualPreference).queryByRole("option", { name: "DeepSeek" })).not.toBeInTheDocument();

    await user.selectOptions(textPreference, "deepseek");
    await user.selectOptions(artPreference, "deepseek");
    await user.click(screen.getByRole("button", { name: "Save AI Settings" }));

    expect(updateAiMutate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        preferredVendorTextImprove: "deepseek",
        preferredArtPieceVendor: "deepseek",
        preferredVendorAltText: null,
      }),
    });
  });
});

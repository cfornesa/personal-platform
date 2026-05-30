import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import SettingsPage from "@/pages/settings";

const updateMeMutate = vi.fn();
const uploadProfilePhotoMutate = vi.fn();
const toastMock = vi.fn();
let uploadProfilePhotoOptions: any;
let mockCurrentUser = {
  id: "owner-1",
  name: "Owner",
  email: "owner@example.com",
  username: "owner",
  imageUrl: null,
  bio: "Bio",
  website: "https://example.com",
  socialLinks: {},
  role: "owner",
};
const mockSiteSettings = {
  theme: "bauhaus",
  palette: "bauhaus",
};

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@workspace/api-client-react", () => ({
  ApiError: class ApiError extends Error {},
  useUpdateMe: () => ({
    mutate: updateMeMutate,
    isPending: false,
  }),
  useUploadProfilePhoto: (options: any) => {
    uploadProfilePhotoOptions = options;
    return {
      mutate: uploadProfilePhotoMutate,
      isPending: false,
    };
  },
  getGetMeQueryKey: () => ["me"],
  getGetUserQueryKey: (id: string) => ["user", id],
  getGetPostsByUserQueryKey: (id: string) => ["postsByUser", id],
  getListPostsQueryKey: () => ["posts"],
}));

vi.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => ({
    currentUser: mockCurrentUser,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-site-settings", () => ({
  useSiteSettings: () => ({
    data: mockSiteSettings,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("@/components/layout/UserPageCustomizationCard", () => ({
  UserPageCustomizationCard: () => <div data-testid="user-theme-card" />,
}));

vi.mock("@/components/media/FeaturedImagePicker", () => ({
  FeaturedImagePicker: ({ open, onSelect }: { open: boolean; onSelect: (url: string) => void }) => (
    open ? (
      <button type="button" onClick={() => onSelect("/api/media/library.png")}>
        Mock image library picker
      </button>
    ) : null
  ),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <SettingsPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    updateMeMutate.mockReset();
    uploadProfilePhotoMutate.mockReset();
    toastMock.mockReset();
    uploadProfilePhotoOptions = undefined;
    mockCurrentUser = {
      id: "owner-1",
      name: "Owner",
      email: "owner@example.com",
      username: "owner",
      imageUrl: null,
      bio: "Bio",
      website: "https://example.com",
      socialLinks: {},
      role: "owner",
    };
  });

  it("does not render the old AI assistant card", () => {
    renderPage();

    expect(screen.queryByText("AI Writing Assistant")).toBeNull();
    expect(screen.getByText("Profile Information")).toBeInTheDocument();
  });

  it("still submits profile updates", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.clear(screen.getByLabelText("Bio"));
    await user.type(screen.getByLabelText("Bio"), "Updated bio");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateMeMutate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bio: "Updated bio",
      }),
    });
  });

  it("renders profile photo upload for members without the Image Library picker", () => {
    mockCurrentUser = {
      ...mockCurrentUser,
      id: "member-1",
      role: "member",
    };

    renderPage();

    expect(screen.getByText("Profile Photo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload photo/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose from library/i })).toBeNull();
  });

  it("renders the Image Library picker for the owner", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /choose from library/i }));
    await user.click(screen.getByRole("button", { name: "Mock image library picker" }));

    expect(updateMeMutate).toHaveBeenCalledWith({
      data: { imageUrl: "/api/media/library.png" },
    });
  });

  it("uploads a selected profile photo file", async () => {
    const user = userEvent.setup();
    renderPage();

    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Choose profile photo"), file);

    expect(uploadProfilePhotoMutate).toHaveBeenCalledWith({
      data: { file },
    });
  });

  it("invalidates profile queries after successful profile photo upload", () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    renderPage();

    uploadProfilePhotoOptions.mutation.onSuccess();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["me"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["user", "owner"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["user", "owner-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["postsByUser", "owner-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["posts"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["listPosts"] });
    invalidateSpy.mockRestore();
  });

  it("surfaces profile photo upload errors", () => {
    renderPage();

    uploadProfilePhotoOptions.mutation.onError(new Error("bad file"));

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Upload failed",
      variant: "destructive",
    }));
  });
});

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { RichPostEditor } from "@/components/post/RichPostEditor";

const editorState = {
  html: "<p>Hello world</p>",
  text: "Hello world",
  isEmpty: false,
};

const setContent = vi.fn((next: string) => {
  editorState.html = next;
});
const toggleBoldRun = vi.fn();
const toggleItalicRun = vi.fn();
const toggleUnderlineRun = vi.fn();
const toggleHeadingRun = vi.fn();
const toggleBulletListRun = vi.fn();
const toggleBlockquoteRun = vi.fn();
const setTextAlignRun = vi.fn();
const setParagraphRun = vi.fn();
const setLinkRun = vi.fn();
const unsetLinkRun = vi.fn();
const setImageRun = vi.fn();
const insertIframeRun = vi.fn();
const insertIframe = vi.fn(() => ({ run: insertIframeRun }));
const undoRun = vi.fn();
const redoRun = vi.fn();
const processMutateAsync = vi.fn();
const hoistedApiMocks = vi.hoisted(() => ({
  generatePieceRequest: vi.fn(),
}));
const createPieceMutate = vi.fn();
const toastSpy = vi.fn();
let processPending = false;
let createPending = false;

vi.mock("@tiptap/react", () => ({
  useEditor: () => ({
    isEmpty: editorState.isEmpty,
    isActive: () => false,
    getHTML: () => editorState.html,
    getText: () => editorState.text,
    getAttributes: () => ({}),
    can: () => ({
      undo: () => true,
      redo: () => true,
    }),
    chain: () => ({
      focus: () => ({
        toggleBold: () => ({ run: toggleBoldRun }),
        toggleItalic: () => ({ run: toggleItalicRun }),
        toggleUnderline: () => ({ run: toggleUnderlineRun }),
        toggleHeading: () => ({ run: toggleHeadingRun }),
        toggleBulletList: () => ({ run: toggleBulletListRun }),
        toggleBlockquote: () => ({ run: toggleBlockquoteRun }),
        setTextAlign: () => ({ run: setTextAlignRun }),
        setParagraph: () => ({ run: setParagraphRun }),
        extendMarkRange: () => ({ setLink: () => ({ run: setLinkRun }) }),
        unsetLink: () => ({ run: unsetLinkRun }),
        setImage: (attrs: { src: string; alt?: string }) => ({
          run: () => {
            editorState.html = `${editorState.html}<img src="${attrs.src}" alt="${attrs.alt ?? ""}">`;
            setImageRun();
          },
        }),
        insertIframe,
        undo: () => ({ run: undoRun }),
        redo: () => ({ run: redoRun }),
      }),
    }),
    commands: {
      setContent,
    },
  }),
  EditorContent: () => <div data-testid="editor-content" />,
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useProcessAiText: (options?: any) => ({
      isPending: processPending,
      mutateAsync: async (payload: unknown) => {
        try {
          return await processMutateAsync(payload);
        } catch (error) {
          options?.mutation?.onError?.(error);
          throw error;
        }
      },
    }),
    generateArtPiece: hoistedApiMocks.generatePieceRequest,
    useCreateArtPiece: () => ({
      isPending: createPending,
      mutate: createPieceMutate,
    }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock("../iframe-embed", () => ({
  IframeEmbed: {},
}));

vi.mock("../CategoryMultiSelect", () => ({
  CategoryMultiSelect: () => <div data-testid="category-multiselect" />,
}));

vi.mock("../PlatformMultiSelect", () => ({
  PlatformMultiSelect: ({
    value,
    onChange,
    connections,
  }: {
    value: number[];
    onChange: (next: number[]) => void;
    connections: Array<{ id: number; platform: string }>;
  }) => (
    <div>
      {connections.map((connection) => {
        const selected = value.includes(connection.id);
        return (
          <button
            key={connection.id}
            type="button"
            aria-label={connection.platform}
            onClick={() =>
              onChange(
                selected
                  ? value.filter((id) => id !== connection.id)
                  : [...value, connection.id],
              )
            }
          >
            {connection.platform}
          </button>
        );
      })}
    </div>
  ),
}));

vi.mock("../P5PieceRenderer", () => ({
  P5PieceRenderer: ({ onStatusChange }: { onStatusChange?: (status: { valid: boolean; error: string | null }) => void }) => {
    onStatusChange?.({ valid: true, error: null });
    return <div data-testid="p5-piece-renderer" />;
  },
}));

vi.mock("@tiptap/starter-kit", () => ({
  default: {
    configure: () => ({}),
  },
}));

vi.mock("@tiptap/extension-image", () => ({
  default: {},
}));

vi.mock("@tiptap/extension-link", () => ({
  default: {
    configure: () => ({}),
  },
}));

vi.mock("@tiptap/extension-text-align", () => ({
  default: {
    configure: () => ({}),
  },
}));

vi.mock("@tiptap/extension-underline", () => ({
  default: {},
}));

function renderEditor(aiVendors: Array<{ id: string; label: string }>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RichPostEditor
        aiVendors={aiVendors}
        initialContent={editorState.html}
        submitLabel="Post"
        onUpload={async () => "/api/media/image.jpg"}
        onSubmit={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function renderEditorWithPlatforms() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSubmit = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <RichPostEditor
        initialContent={editorState.html}
        submitLabel="Post"
        onUpload={async () => "/api/media/image.jpg"}
        onSubmit={onSubmit}
        platformConnections={[
          { id: 1, platform: "substack", displayName: "Substack" } as never,
          { id: 2, platform: "blogger", displayName: "Blogger" } as never,
        ]}
      />
    </QueryClientProvider>,
  );
  return { onSubmit };
}

function renderEditorForFeaturedImages(options: {
  onUpload?: (file: File) => Promise<string>;
  onSubmit?: ReturnType<typeof vi.fn>;
  initialFeaturedImageUrl?: string | null;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSubmit = options.onSubmit ?? vi.fn();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RichPostEditor
        initialContent={editorState.html}
        submitLabel="Post"
        onUpload={options.onUpload ?? (async () => "/api/media/image.jpg")}
        onSubmit={onSubmit}
        initialFeaturedImageUrl={options.initialFeaturedImageUrl}
      />
    </QueryClientProvider>,
  );
  return { ...result, onSubmit };
}

describe("RichPostEditor AI action", () => {
  beforeEach(() => {
    editorState.html = "<p>Hello world</p>";
    editorState.text = "Hello world";
    editorState.isEmpty = false;
    setContent.mockClear();
    toggleBoldRun.mockClear();
    toggleItalicRun.mockClear();
    toggleUnderlineRun.mockClear();
    toggleHeadingRun.mockClear();
    toggleBulletListRun.mockClear();
    toggleBlockquoteRun.mockClear();
    setTextAlignRun.mockClear();
    setParagraphRun.mockClear();
    setLinkRun.mockClear();
    unsetLinkRun.mockClear();
    setImageRun.mockClear();
    insertIframe.mockClear();
    insertIframeRun.mockClear();
    undoRun.mockClear();
    redoRun.mockClear();
    processMutateAsync.mockReset();
    hoistedApiMocks.generatePieceRequest.mockReset();
    createPieceMutate.mockReset();
    toastSpy.mockReset();
    processPending = false;
    createPending = false;
  });

  it("hides the AI button when AI is unavailable", () => {
    renderEditor([]);
    expect(screen.queryByRole("button", { name: /AI/i })).toBeNull();
  });

  it("shows the AI button and replaces editor content on success", async () => {
    const user = userEvent.setup();
    processMutateAsync.mockResolvedValue({ text: "Improved draft text" });
    renderEditor([{ id: "opencode-zen", label: "Opencode Zen" }]);

    await user.click(screen.getByRole("button", { name: /AI/i }));

    expect(processMutateAsync).toHaveBeenCalledWith({
      data: { content: "<p>Hello world</p>", vendor: "opencode-zen" },
    });
    await waitFor(() => {
      expect(setContent).toHaveBeenCalledWith("<p>Improved draft text</p>", { emitUpdate: true });
    });
  });

  it("shows a spinner state while the AI request is pending", () => {
    processPending = true;
    renderEditor([{ id: "opencode-zen", label: "Opencode Zen" }]);

    const button = screen.getByRole("button", { name: /AI/i });
    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });

  it("can generate an art piece draft in p5 mode", async () => {
    const user = userEvent.setup();
    hoistedApiMocks.generatePieceRequest.mockResolvedValue({
      draftToken: "draft-1",
      title: "Orbit Bloom",
      engine: "p5",
      structuredSpec: { version: 1, canvas: { width: 640, height: 420, frameRate: 30 }, background: "#fff", elements: [] },
      generatedCode: "(p) => { p.setup = () => { p.createCanvas(320, 240); }; }",
      notes: "Soft looping motion",
      vendor: "opencode-zen",
      vendorLabel: "Opencode Zen",
      model: "big-pickle",
      validationStatus: "validated",
      attemptCount: 1,
      maxAttempts: 3,
      timedOut: false,
      cancelled: false,
      wasRepaired: false,
    });
    renderEditor([{ id: "opencode-zen", label: "Opencode Zen" }]);

    await user.selectOptions(screen.getByLabelText("AI Mode"), "piece");
    await user.click(screen.getByRole("button", { name: /Make Piece/i }));

    expect(await screen.findByText("Orbit Bloom")).toBeInTheDocument();
  });

  it("preserves content and shows an error toast when AI fails", async () => {
    const user = userEvent.setup();
    processMutateAsync.mockRejectedValue(
      new ApiError(
        new Response(JSON.stringify({ error: "Upstream failed" }), {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "content-type": "application/json" },
        }),
        { error: "Upstream failed" },
        { method: "POST", url: "/api/ai/process" },
      ),
    );
    renderEditor([{ id: "opencode-zen", label: "Opencode Zen" }]);

    await user.click(screen.getByRole("button", { name: /AI/i }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "AI request failed",
          variant: "destructive",
        }),
      );
    });
    expect(setContent).not.toHaveBeenCalled();
  });

  it("shows a user-friendly timeout toast when the provider times out", async () => {
    const user = userEvent.setup();
    processMutateAsync.mockRejectedValue(
      new ApiError(
        new Response(JSON.stringify({ error: "The AI provider timed out. Try again." }), {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "content-type": "application/json" },
        }),
        { error: "The AI provider timed out. Try again." },
        { method: "POST", url: "/api/ai/process" },
      ),
    );
    renderEditor([{ id: "opencode-zen", label: "Opencode Zen" }]);

    await user.click(screen.getByRole("button", { name: /AI/i }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "AI request failed",
          description: "The AI provider timed out. Try again.",
          variant: "destructive",
        }),
      );
    });
    expect(setContent).not.toHaveBeenCalled();
  });

  it("lets the owner choose the vendor before sending the request", async () => {
    const user = userEvent.setup();
    processMutateAsync.mockResolvedValue({ text: "Improved draft text" });
    renderEditor([
      { id: "opencode-zen", label: "Opencode Zen" },
      { id: "google", label: "Google" },
    ]);

    await user.selectOptions(screen.getByLabelText("AI Vendor"), "google");
    await user.click(screen.getByRole("button", { name: /AI/i }));

    expect(processMutateAsync).toHaveBeenCalledWith({
      data: { content: "<p>Hello world</p>", vendor: "google" },
    });
  });

  it("renders compact square toolbar controls plus the More menu", () => {
    renderEditor([]);

    expect(screen.getByLabelText("Bold")).toHaveClass("h-8", "rounded-sm");
    expect(screen.getByLabelText("More formatting options")).toBeInTheDocument();
  });

  it("exposes H1 through H6 in the text-style menu", async () => {
    const user = userEvent.setup();
    renderEditor([]);

    await user.click(screen.getByLabelText("Text style"));

    expect(screen.getByRole("menuitem", { name: "H1" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "H6" })).toBeInTheDocument();
  });

  it("dispatches the bold command from the toolbar", async () => {
    const user = userEvent.setup();
    renderEditor([]);

    await user.click(screen.getByLabelText("Bold"));

    expect(toggleBoldRun).toHaveBeenCalled();
  });

  it("inserts a YouTube iframe from a normal video URL", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    renderEditor([]);

    await user.click(screen.getByLabelText("Insert YouTube video"));

    expect(insertIframeRun).toHaveBeenCalled();
    expect(promptSpy).toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("normalizes pasted piece embeds to the live piece URL", async () => {
    const user = userEvent.setup();
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValue('<iframe src="http://localhost:4000/embed/pieces/5?version=64" width="100%"></iframe>');
    renderEditor([]);

    await user.click(screen.getByLabelText("Insert iframe embed"));

    expect(insertIframe).toHaveBeenCalledWith(
      expect.objectContaining({
        src: "http://localhost:4000/embed/pieces/5",
      }),
    );
    promptSpy.mockRestore();
  });

  it("shows the newsletter toggle only when Substack is selected and clears it when Substack is deselected", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEditorWithPlatforms();

    expect(screen.queryByRole("checkbox", { name: /Send as newsletter/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "substack" }));

    const checkbox = screen.getByRole("checkbox", { name: /Send as newsletter/i });
    expect(checkbox).toBeInTheDocument();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(screen.getByRole("button", { name: "substack" }));
    expect(screen.queryByRole("checkbox", { name: /Send as newsletter/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: "substack" }));
    const visibleAgain = screen.getByRole("checkbox", { name: /Send as newsletter/i });
    expect(visibleAgain).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: /Post/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      substackSendNewsletter: false,
    }));
  });

  it("auto-selects the first uploaded content image as the featured image", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn(async () => "/media/first-content.png");
    const { container, onSubmit } = renderEditorForFeaturedImages({ onUpload });

    const fileInput = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    await user.upload(fileInput, new File(["image"], "first-content.png", { type: "image/png" }));

    expect(await screen.findByText("Featured image selected from first content upload.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Post/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      featuredImageUrl: "/media/first-content.png",
    }));
  });

  it("uses a manually uploaded featured image ahead of later content images", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn()
      .mockResolvedValueOnce("/media/manual-featured.png")
      .mockResolvedValueOnce("/media/content-image.png");
    const { container, onSubmit } = renderEditorForFeaturedImages({ onUpload });
    const inputs = container.querySelectorAll('input[type="file"]');

    await user.upload(inputs[1] as HTMLInputElement, new File(["image"], "manual-featured.png", { type: "image/png" }));
    expect(await screen.findByText("Featured image manually selected.")).toBeInTheDocument();

    await user.upload(inputs[0] as HTMLInputElement, new File(["image"], "content-image.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: /Post/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      featuredImageUrl: "/media/manual-featured.png",
    }));
  });

  it("falls back to the first image already in the content on submit", async () => {
    const user = userEvent.setup();
    editorState.html = '<p>Hello</p><img src="/media/pasted.png" alt="">';
    editorState.text = "Hello";
    const { onSubmit } = renderEditorForFeaturedImages();

    await user.click(screen.getByRole("button", { name: /Post/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      featuredImageUrl: "/media/pasted.png",
    }));
  });

  it("lets a cleared manual featured image return to automatic selection", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn(async () => "/media/content-after-clear.png");
    const { container, onSubmit } = renderEditorForFeaturedImages({
      onUpload,
      initialFeaturedImageUrl: "/media/manual-existing.png",
    });

    await user.click(screen.getByRole("button", { name: "Clear" }));
    const fileInput = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    await user.upload(fileInput, new File(["image"], "content-after-clear.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: /Post/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      featuredImageUrl: "/media/content-after-clear.png",
    }));
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

const {
  ImmersiveMetadataCard,
  ImmersiveRouteShell,
} = await import("@/components/immersive/ImmersiveRouteShell");

function setDocumentFlow(matches: boolean) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: matches ? 390 : 1440,
  });
}

function StatefulImmersiveRouteShell({
  requestFullscreen,
  exitFullscreen,
  isEmbedMode = false,
  canonicalHref,
  enableIPhoneEmbedLauncher = false,
}: {
  requestFullscreen?: (this: HTMLElement) => Promise<void>;
  exitFullscreen?: () => Promise<void>;
  isEmbedMode?: boolean;
  canonicalHref?: string;
  enableIPhoneEmbedLauncher?: boolean;
} = {}) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  if (requestFullscreen) {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
  }
  if (exitFullscreen) {
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
  }

  return (
    <ImmersiveRouteShell
      title="Tornado"
      onBack={() => undefined}
      isFullscreen={isFullscreen}
      isEmbedMode={isEmbedMode}
      canonicalHref={canonicalHref}
      enableIPhoneEmbedLauncher={enableIPhoneEmbedLauncher}
      onToggleFullscreen={() => setIsFullscreen((current) => !current)}
      renderScene={({ fullscreen }) => (
        <div data-testid={fullscreen ? "fullscreen-scene" : "scene"}>Scene</div>
      )}
      metadataCard={
        <ImmersiveMetadataCard
          title="Tornado"
          description="Description"
          fields={[{ label: "Engine", value: "P5.js" }]}
        />
      }
    />
  );
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  document.body.style.overscrollBehavior = "";
  document.documentElement.style.overscrollBehavior = "";
  document.body.style.touchAction = "";
  document.documentElement.style.touchAction = "";
  vi.restoreAllMocks();
});

function mockNavigatorUserAgent(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: maxTouchPoints,
  });
}

describe("ImmersiveRouteShell", () => {
  it("hides the lower-right embed control on iPhone piece embeds", async () => {
    mockNavigatorUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    );

    render(
      <StatefulImmersiveRouteShell
        isEmbedMode
        canonicalHref="https://example.com/immersive/pieces/7?version=9"
      />,
    );

    const button = screen.queryByLabelText("Expand immersive view");
    expect(button).toBeNull();
  });

  it("keeps the fullscreen control for iPad embeds", () => {
    mockNavigatorUserAgent(
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      5,
    );

    render(
      <StatefulImmersiveRouteShell
        isEmbedMode
        canonicalHref="https://example.com/immersive/pieces/7?version=9"
        enableIPhoneEmbedLauncher
      />,
    );

    expect(screen.getByLabelText("Expand immersive view")).toBeTruthy();
  });

  it("renders a stacked shell with metadata and an expand control", () => {
    mockNavigatorUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    setDocumentFlow(true);
    const renderScene = vi.fn(() => <div data-testid="scene">Scene</div>);

    render(
      <ImmersiveRouteShell
        title="Tornado"
        onBack={() => undefined}
        isFullscreen={false}
        onToggleFullscreen={() => undefined}
        renderScene={renderScene}
        metadataCard={
          <ImmersiveMetadataCard
            title="Tornado"
            description="Description"
            fields={[{ label: "Engine", value: "P5.js" }]}
          />
        }
      />,
    );

    expect(screen.getAllByText("Tornado")).toHaveLength(2);
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByLabelText("Expand immersive view")).toBeTruthy();
    expect(renderScene).toHaveBeenCalledWith({ fullscreen: false, isMobile: true });
    expect(screen.getByTestId("scene").parentElement?.className).toContain("h-[40svh]");
  });

  it("keeps the stacked shell even on wide desktop viewports", () => {
    mockNavigatorUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    setDocumentFlow(false);
    const renderScene = vi.fn(() => <div data-testid="scene">Scene</div>);

    render(
      <ImmersiveRouteShell
        title="Searching for Meaning"
        onBack={() => undefined}
        isFullscreen={false}
        onToggleFullscreen={() => undefined}
        renderScene={renderScene}
        metadataCard={
          <ImmersiveMetadataCard
            title="Searching for Meaning"
            description="Description"
            fields={[{ label: "Engine", value: "C2.js" }]}
          />
        }
      />,
    );

    expect(screen.getAllByText("Searching for Meaning")).toHaveLength(2);
    expect(screen.getByLabelText("Expand immersive view")).toBeTruthy();
    expect(screen.getByText("Description")).toBeTruthy();
    expect(renderScene).toHaveBeenCalledWith({ fullscreen: false, isMobile: true });
  });

  it("shows only the contract control inside fullscreen focus mode", () => {
    mockNavigatorUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    setDocumentFlow(true);
    const renderScene = vi.fn(() => <div data-testid="scene">Scene</div>);

    render(
      <ImmersiveRouteShell
        title="Enlightenment"
        onBack={() => undefined}
        isFullscreen
        onToggleFullscreen={() => undefined}
        renderScene={renderScene}
        metadataCard={
          <ImmersiveMetadataCard
            title="Enlightenment"
            description="Description"
            fields={[{ label: "Engine", value: "Three.js" }]}
          />
        }
      />,
    );

    expect(screen.getByLabelText("Return to gallery view")).toBeTruthy();
    expect(renderScene).toHaveBeenCalledWith({ fullscreen: true, isMobile: true });
  });

  it("requests native fullscreen when expanding first-party immersive mode", async () => {
    mockNavigatorUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    const user = userEvent.setup();
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    const requestFullscreen = vi.fn(function request(this: HTMLElement) {
      fullscreenElement = this;
      return Promise.resolve();
    });

    render(<StatefulImmersiveRouteShell requestFullscreen={requestFullscreen} />);

    await user.click(screen.getByLabelText("Expand immersive view"));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("fullscreen-scene")).toBeTruthy();
    expect(screen.getByTestId("immersive-fullscreen-root").className).toContain("100dvh");
  });

  it("keeps CSS fullscreen focus mode when native fullscreen is rejected", async () => {
    mockNavigatorUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    const user = userEvent.setup();
    const requestFullscreen = vi.fn(() => Promise.reject(new Error("Rejected")));

    render(<StatefulImmersiveRouteShell requestFullscreen={requestFullscreen} />);

    await user.click(screen.getByLabelText("Expand immersive view"));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("fullscreen-scene")).toBeTruthy();
    expect(screen.getByLabelText("Return to gallery view")).toBeTruthy();
  });

  it("syncs browser-driven native fullscreen exits back to the route state", async () => {
    mockNavigatorUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    const user = userEvent.setup();
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    const requestFullscreen = vi.fn(function request(this: HTMLElement) {
      fullscreenElement = this;
      return Promise.resolve();
    });

    render(<StatefulImmersiveRouteShell requestFullscreen={requestFullscreen} />);
    await user.click(screen.getByLabelText("Expand immersive view"));

    fullscreenElement = null;
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(screen.getByLabelText("Expand immersive view")).toBeTruthy();
    expect(screen.queryByTestId("fullscreen-scene")).toBeNull();
  });

  it("restores document scroll and touch styles after fullscreen mode exits", async () => {
    mockNavigatorUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    const user = userEvent.setup();
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "auto";
    document.body.style.overscrollBehavior = "contain";
    document.documentElement.style.overscrollBehavior = "contain";
    document.body.style.touchAction = "pan-x";
    document.documentElement.style.touchAction = "pan-y";

    render(<StatefulImmersiveRouteShell />);

    await user.click(screen.getByLabelText("Expand immersive view"));
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overscrollBehavior).toBe("none");
    expect(document.body.style.touchAction).toBe("none");

    await user.click(screen.getByLabelText("Return to gallery view"));
    expect(document.body.style.overflow).toBe("auto");
    expect(document.documentElement.style.overflow).toBe("auto");
    expect(document.body.style.overscrollBehavior).toBe("contain");
    expect(document.documentElement.style.touchAction).toBe("pan-y");
  });

  it("hides the fullscreen control in static embed mode", () => {
    mockNavigatorUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    setDocumentFlow(true);
    const renderScene = vi.fn(() => <div data-testid="scene">Scene</div>);

    render(
      <ImmersiveRouteShell
        title="Static Embed"
        onBack={() => undefined}
        isFullscreen={false}
        isEmbedMode
        showEmbedFullscreenControl={false}
        onToggleFullscreen={() => undefined}
        renderScene={renderScene}
        metadataCard={
          <ImmersiveMetadataCard
            title="Static Embed"
            description="Description"
            fields={[{ label: "Engine", value: "Three.js" }]}
          />
        }
      />,
    );

    expect(screen.queryByLabelText("Expand immersive view")).toBeNull();
    expect(renderScene).toHaveBeenCalledWith({ fullscreen: false, isMobile: false });
  });

  it("requests native fullscreen when expanding an embed", async () => {
    mockNavigatorUserAgent(
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
    );
    const user = userEvent.setup();
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    const requestFullscreen = vi.fn(function request(this: HTMLElement) {
      fullscreenElement = this;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });

    render(
      <StatefulImmersiveRouteShell
        isEmbedMode
        requestFullscreen={requestFullscreen}
      />,
    );

    await user.click(screen.getByLabelText("Expand immersive view"));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("fullscreen-scene")).toBeTruthy();
    expect(screen.getByTestId("immersive-embed-expanded-root").className).toContain("fixed");
  });

  it("falls back to in-frame focus mode when embed fullscreen is rejected", async () => {
    mockNavigatorUserAgent(
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
    );
    const user = userEvent.setup();
    const requestFullscreen = vi.fn(() => Promise.reject(new Error("Rejected")));

    render(
      <StatefulImmersiveRouteShell
        isEmbedMode
        requestFullscreen={requestFullscreen}
      />,
    );

    await user.click(screen.getByLabelText("Expand immersive view"));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("fullscreen-scene")).toBeTruthy();
    expect(screen.getByLabelText("Return to gallery view")).toBeTruthy();
    expect(screen.getByTestId("immersive-embed-expanded-root").className).toContain("fixed");
  });

  it("lets embed focus mode exit cleanly after fullscreen fallback", async () => {
    mockNavigatorUserAgent(
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
    );
    const user = userEvent.setup();
    const requestFullscreen = vi.fn(() => Promise.reject(new Error("Rejected")));

    render(
      <StatefulImmersiveRouteShell
        isEmbedMode
        requestFullscreen={requestFullscreen}
      />,
    );

    await user.click(screen.getByLabelText("Expand immersive view"));
    expect(screen.getByTestId("immersive-embed-expanded-root")).toBeTruthy();

    await user.click(screen.getByLabelText("Return to gallery view"));

    expect(screen.getByLabelText("Expand immersive view")).toBeTruthy();
    expect(screen.queryByTestId("immersive-embed-expanded-root")).toBeNull();
    expect(screen.getByTestId("immersive-embed-root")).toBeTruthy();
    expect(screen.queryByTestId("fullscreen-scene")).toBeNull();
  });

  it("hides the control on iPhone embeds even if canonicalHref is missing", () => {
    mockNavigatorUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    );

    render(<StatefulImmersiveRouteShell isEmbedMode />);

    const button = screen.queryByLabelText("Expand immersive view");
    expect(button).toBeNull();
  });

  it("renders the fullscreen control on iPhone in embed mode when wrapped", async () => {
    mockNavigatorUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    );

    render(
      <StatefulImmersiveRouteShell
        isEmbedMode
        canonicalHref="https://example.com/immersive/pieces/7?version=9"
      />,
    );

    // Initially hidden because hasWrapper is false
    expect(screen.queryByLabelText("Expand immersive view")).toBeNull();

    // Simulate parent connecting handshake (postMessage)
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "creatr-wrapper-connected" },
        })
      );
    });

    // Should now be visible
    expect(screen.getByLabelText("Expand immersive view")).toBeTruthy();
  });

  it("sends postMessage to parent window when wrapped on iPhone and clicked", async () => {
    mockNavigatorUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    );
    const user = userEvent.setup();

    // Mock window.parent as a separate object to trigger window.parent !== window
    const parentMock = {
      postMessage: vi.fn(),
    };
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parentMock,
    });

    render(
      <StatefulImmersiveRouteShell
        isEmbedMode
        canonicalHref="https://example.com/immersive/pieces/7?version=9"
      />,
    );

    // Connect handshake
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "creatr-wrapper-connected" },
        })
      );
    });

    const button = screen.getByLabelText("Expand immersive view");
    await user.click(button);

    // Should send postMessage to parent to toggle fullscreen
    expect(parentMock.postMessage).toHaveBeenCalledWith(
      { type: "creatr-toggle-fullscreen", value: true },
      "*"
    );
  });
});

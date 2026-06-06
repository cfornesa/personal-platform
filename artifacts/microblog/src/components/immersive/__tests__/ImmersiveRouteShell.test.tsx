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
}: {
  requestFullscreen?: (this: HTMLElement) => Promise<void>;
  exitFullscreen?: () => Promise<void>;
  isEmbedMode?: boolean;
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

describe("ImmersiveRouteShell", () => {
  it("renders a stacked shell with metadata and an expand control", () => {
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
    const user = userEvent.setup();
    const requestFullscreen = vi.fn(() => Promise.reject(new Error("Rejected")));

    render(<StatefulImmersiveRouteShell requestFullscreen={requestFullscreen} />);

    await user.click(screen.getByLabelText("Expand immersive view"));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("fullscreen-scene")).toBeTruthy();
    expect(screen.getByLabelText("Return to gallery view")).toBeTruthy();
  });

  it("syncs browser-driven native fullscreen exits back to the route state", async () => {
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
});

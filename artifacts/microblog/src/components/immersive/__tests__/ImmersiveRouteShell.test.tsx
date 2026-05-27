import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
    expect(screen.getByTestId("scene").parentElement?.className).toContain("aspect-video");
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
});

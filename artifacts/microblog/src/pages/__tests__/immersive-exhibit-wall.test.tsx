import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ExhibitWallContent,
  ItemDetailCard,
  getProgressiveExhibitLiveBudget,
  selectProgressiveExhibitSlots,
  type WallItem,
} from "@/pages/immersive-exhibit-wall";

function piece(id: number, title = `Piece ${id}`): WallItem {
  return {
    kind: "piece",
    id,
    title,
    engine: "p5",
    thumbnailUrl: `/thumbs/${id}.png`,
    generatedCode: "window.sketch = () => {};",
    htmlCode: null,
    cssCode: null,
    description: null,
  };
}

function image(id: number): WallItem {
  return {
    kind: "image",
    id,
    url: `/media/${id}.png`,
    filename: `${id}.png`,
    title: `Image ${id}`,
    altText: null,
  };
}

describe("ItemDetailCard", () => {
  it("renders piece descriptions in exhibit detail cards", () => {
    render(
      <ItemDetailCard
        item={{
          kind: "piece",
          id: 1,
          title: "Orbit Bloom",
          engine: "three",
          thumbnailUrl: null,
          generatedCode: "window.sketch = () => {};",
          htmlCode: null,
          cssCode: null,
          description: "A rotating study in layered light.",
        }}
      />,
    );

    expect(screen.getByText("Orbit Bloom")).toBeInTheDocument();
    expect(screen.getByText("Three.js")).toBeInTheDocument();
    expect(screen.getByText("A rotating study in layered light.")).toBeInTheDocument();
  });

  it("renders image alt text in exhibit detail cards", () => {
    render(
      <ItemDetailCard
        item={{
          kind: "image",
          id: 2,
          url: "/api/media/still-life.png",
          filename: "still-life.png",
          title: "Still Life",
          altText: "A monochrome still life with angular shadows.",
        }}
      />,
    );

    expect(screen.getByText("Still Life")).toBeInTheDocument();
    expect(screen.getByText("Image")).toBeInTheDocument();
    expect(screen.getByText("A monochrome still life with angular shadows.")).toBeInTheDocument();
  });
});

describe("ExhibitWallContent", () => {
  it("renders piece descriptions, image alt text, and the immersive expand control", () => {
    const renderStage = vi.fn(() => <div data-testid="exhibit-stage" />);

    render(
      <ExhibitWallContent
        exhibitName="Abstract Studies"
        exhibitDescription="Description."
        artistStatement="Artist statement."
        biography="Biography."
        rows={1}
        cols={2}
        labels={[
          { title: "Three.js Flight", subtitle: "Three.js" },
          { title: "Momentum", subtitle: "Image" },
        ]}
        items={[
          {
            kind: "piece",
            id: 1,
            title: "Three.js Flight",
            engine: "three",
            thumbnailUrl: null,
            generatedCode: "window.sketch = () => {};",
            htmlCode: null,
            cssCode: null,
            description: "A suspended dark form rotating through open space.",
          },
          {
            kind: "image",
            id: 2,
            url: "/api/media/momentum.png",
            filename: "momentum.png",
            title: "Momentum",
            altText: "Concentric circles over a black-and-white grid.",
          },
        ]}
        onBack={() => undefined}
        renderStage={renderStage}
      />,
    );

    expect(screen.getAllByText("Abstract Studies")).toHaveLength(2);
    expect(screen.getByText("A suspended dark form rotating through open space.")).toBeInTheDocument();
    expect(screen.getByText("Concentric circles over a black-and-white grid.")).toBeInTheDocument();
    expect(screen.getByLabelText("Expand immersive view")).toBeInTheDocument();
    expect(screen.getByText("Immersive View")).toBeInTheDocument();
    expect(renderStage).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({ kind: "piece", title: "Three.js Flight" }),
        expect.objectContaining({ kind: "image", title: "Momentum" }),
      ],
      rows: 1,
      cols: 2,
      labels: [
        { title: "Three.js Flight", subtitle: "Three.js" },
        { title: "Momentum", subtitle: "Image" },
      ],
      fullscreen: false,
      staticMode: false,
    });
  });

  it("switches the exhibit wall into fullscreen-only immersive mode and back", async () => {
    const user = userEvent.setup();
    const renderStage = vi.fn(() => <div data-testid="exhibit-stage" />);

    render(
      <ExhibitWallContent
        exhibitName="Fullscreen Exhibit"
        exhibitDescription="Description."
        artistStatement={null}
        biography={null}
        rows={1}
        cols={1}
        labels={[{ title: "Piece", subtitle: "P5.js" }]}
        items={[
          {
            kind: "piece",
            id: 1,
            title: "Piece",
            engine: "p5",
            thumbnailUrl: null,
            generatedCode: "window.sketch = () => {};",
            htmlCode: null,
            cssCode: null,
            description: "Detailed prompt text.",
          },
        ]}
        onBack={() => undefined}
        renderStage={renderStage}
      />,
    );

    await user.click(screen.getByLabelText("Expand immersive view"));
    expect(screen.getByLabelText("Return to gallery view")).toBeInTheDocument();
    expect(renderStage.mock.calls).toContainEqual([{
      items: [expect.objectContaining({ kind: "piece", title: "Piece" })],
      rows: 1,
      cols: 1,
      labels: [{ title: "Piece", subtitle: "P5.js" }],
      fullscreen: true,
      staticMode: false,
    }]);

    await user.click(screen.getByLabelText("Return to gallery view"));
    expect(screen.getByLabelText("Expand immersive view")).toBeInTheDocument();
    expect(renderStage.mock.calls.at(-1)).toEqual([{
      items: [expect.objectContaining({ kind: "piece", title: "Piece" })],
      rows: 1,
      cols: 1,
      labels: [{ title: "Piece", subtitle: "P5.js" }],
      fullscreen: false,
      staticMode: false,
    }]);
  });
});

describe("progressive exhibit loading helpers", () => {
  it("uses conservative live budgets by viewport size", () => {
    expect(getProgressiveExhibitLiveBudget(390)).toBe(1);
    expect(getProgressiveExhibitLiveBudget(900)).toBe(2);
    expect(getProgressiveExhibitLiveBudget(1440)).toBe(3);
    expect(getProgressiveExhibitLiveBudget(1440, true)).toBe(1);
  });

  it("selects only nearby piece slots and ignores images", () => {
    const selected = selectProgressiveExhibitSlots(
      [piece(1), image(2), piece(3), piece(4)],
      [
        { x: -3.2, y: 1.3, z: -1 },
        { x: 0, y: 1.3, z: -1 },
        { x: 3.2, y: 1.3, z: -1 },
        { x: 6.4, y: 1.3, z: -1 },
      ],
      { x: 3, y: 1.3, z: -1 },
      2,
    );

    expect(Array.from(selected).sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it("does not select any animated slots when the live budget is exhausted", () => {
    const selected = selectProgressiveExhibitSlots(
      [piece(1), piece(2)],
      [
        { x: 0, y: 1, z: -1 },
        { x: 2, y: 1, z: -1 },
      ],
      { x: 0, y: 1, z: -1 },
      0,
    );

    expect(selected.size).toBe(0);
  });

  it("prefers persisted thumbnail URLs over public preview generation", () => {
    const items = [piece(1), piece(2)];
    expect(items.every((item) => item.kind !== "piece" || Boolean(item.thumbnailUrl))).toBe(true);
  });
});

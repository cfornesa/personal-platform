import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostContent } from "../PostContent";

describe("PostContent", () => {
  it("renders plain content as text without executing tags", () => {
    const malicious = "Hello <script>window.__pwned = true;</script> world";
    const { container } = render(
      <PostContent content={malicious} contentFormat="plain" />,
    );
    expect(screen.getByText(/Hello/)).toBeInTheDocument();
    expect(container.textContent).toContain("<script>");
    expect(container.querySelector("script")).toBeNull();
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it("renders html content through HTML injection", () => {
    const safeHtml = "<p>Hello <strong>world</strong></p>";
    const { container } = render(
      <PostContent content={safeHtml} contentFormat="html" />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("world");
  });

  it("adds an immersive trigger to rendered images", () => {
    const { container } = render(
      <PostContent
        content='<p><img src="/media/example.jpg" alt="Studio lights" /></p>'
        contentFormat="html"
      />,
    );
    const trigger = container.querySelector('a[href^="/immersive/images/"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-label")).toContain("immersive");
  });

  it("adds an immersive trigger to embedded art pieces", () => {
    const { container } = render(
      <PostContent
        content='<iframe src="/embed/pieces/7?version=9" title="Orbit Bloom"></iframe>'
        contentFormat="html"
      />,
    );
    const trigger = container.querySelector('a[href="/immersive/pieces/7?version=9"]');
    expect(trigger).not.toBeNull();
    const frame = container.querySelector('iframe[src="/embed/pieces/7?version=9"]');
    expect(frame?.getAttribute("width")).toBe("100%");
    expect(frame?.getAttribute("height")).toBeNull();
    expect(frame?.getAttribute("style")).toContain("aspect-ratio:16 / 9");
  });

  it("preserves whitespace in plain content", () => {
    const { container } = render(
      <PostContent content={"line one\n\nline two"} contentFormat="plain" />,
    );
    expect(container.querySelector("p")?.className).toContain("whitespace-pre-wrap");
    expect(container.textContent).toContain("line one");
    expect(container.textContent).toContain("line two");
  });

  it("highlights matched tokens in plain content (case-insensitive)", () => {
    const { container } = render(
      <PostContent
        content="Hello world, hello there"
        contentFormat="plain"
        highlightQuery="HELLO"
      />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe("Hello");
    expect(marks[1].textContent).toBe("hello");
    // Whole text is still readable.
    expect(container.textContent).toBe("Hello world, hello there");
  });

  it("highlights matched tokens inside HTML without breaking tags", () => {
    const { container } = render(
      <PostContent
        content='<p>Hello <strong>world</strong></p>'
        contentFormat="html"
        highlightQuery="world"
      />,
    );
    const strong = container.querySelector("strong");
    // The bold tag must survive — highlighting wraps the inner text only.
    expect(strong).not.toBeNull();
    const mark = strong?.querySelector("mark");
    expect(mark?.textContent).toBe("world");
  });

  it("does not match across HTML tag boundaries", () => {
    // "world" appears inside <strong>, but with a query of "lloworld"
    // (which would only match if we naively scanned the raw HTML
    // string) we must not produce any marks.
    const { container } = render(
      <PostContent
        content='<p>Hello <strong>world</strong></p>'
        contentFormat="html"
        highlightQuery="lloworld"
      />,
    );
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });

  it("renders normally when highlightQuery is empty", () => {
    const { container } = render(
      <PostContent
        content="Hello world"
        contentFormat="plain"
        highlightQuery="   "
      />,
    );
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toBe("Hello world");
  });

  it("highlights multiple distinct query tokens", () => {
    const { container } = render(
      <PostContent
        content="The quick brown fox jumps over the lazy dog"
        contentFormat="plain"
        highlightQuery="quick lazy"
      />,
    );
    const marks = Array.from(container.querySelectorAll("mark")).map(
      (m) => m.textContent,
    );
    expect(marks).toEqual(["quick", "lazy"]);
  });
});

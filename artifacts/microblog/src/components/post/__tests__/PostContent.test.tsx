import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostContent } from "../PostContent";

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }

  emit(target: Element, isIntersecting: boolean) {
    this.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

describe("PostContent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    MockIntersectionObserver.instances = [];
    (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

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

  it("lazy mounts and unloads embedded art piece iframes by viewport visibility", () => {
    const { container } = render(
      <PostContent
        content='<iframe src="/embed/pieces/7?version=9" title="Orbit Bloom"></iframe>'
        contentFormat="html"
      />,
    );
    const trigger = container.querySelector('a[href$="/immersive/pieces/7?version=9"]');
    expect(trigger).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();

    const wrapper = container.querySelector<HTMLElement>("[data-lazy-iframe-wrapper='true']");
    expect(wrapper).not.toBeNull();
    MockIntersectionObserver.instances[0].emit(wrapper!, true);
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain("/embed/pieces/7?version=9");

    MockIntersectionObserver.instances[0].emit(wrapper!, false);
    expect(container.querySelector("iframe")).toBeNull();
    expect(wrapper?.textContent).toContain("Loading");
  });

  it("lazy mounts every visible art piece iframe without a manual preview click", () => {
    const { container } = render(
      <PostContent
        content={[
          '<iframe src="/embed/pieces/7?version=9" title="Orbit Bloom"></iframe>',
          '<iframe src="/embed/pieces/8?version=10" title="Wave Study"></iframe>',
        ].join("")}
        contentFormat="html"
      />,
    );

    const wrappers = container.querySelectorAll<HTMLElement>("[data-lazy-iframe-wrapper='true']");
    expect(wrappers).toHaveLength(2);
    expect(container.querySelectorAll("iframe")).toHaveLength(0);

    MockIntersectionObserver.instances[0].emit(wrappers[0], true);
    MockIntersectionObserver.instances[0].emit(wrappers[1], true);
    const frames = container.querySelectorAll("iframe");
    expect(frames).toHaveLength(2);
    expect(frames[0].getAttribute("src")).toContain("/embed/pieces/7?version=9");
    expect(frames[1].getAttribute("src")).toContain("/embed/pieces/8?version=10");
  });

  it("normalizes exhibit embeds to full interactive lazy iframes in post content", () => {
    const { container } = render(
      <PostContent
        content='<iframe src="/immersive/exhibits/orbit-room?embed=1&static=1" title="Orbit Room"></iframe>'
        contentFormat="html"
      />,
    );
    const trigger = container.querySelector('a[href$="/immersive/exhibits/orbit-room"]');
    expect(trigger).not.toBeNull();
    const wrapper = container.querySelector<HTMLElement>("[data-lazy-iframe-wrapper='true']");
    expect(wrapper).not.toBeNull();

    MockIntersectionObserver.instances[0].emit(wrapper!, true);
    const frameSrc = container.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(frameSrc).toContain("/immersive/exhibits/orbit-room?embed=1");
    expect(frameSrc).not.toContain("static=1");
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

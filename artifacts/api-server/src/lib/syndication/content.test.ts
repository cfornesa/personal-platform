import { describe, expect, it } from "vitest";
import { buildSocialPostText, buildSourceFooter, buildSyndicatedContent, ensureCanonicalUrl, shouldAppendSourceFooter } from "./content";

describe("syndication content helpers", () => {
  it("builds escaped footer markup with the configured site title", () => {
    const footer = buildSourceFooter('My <Site> & Co.', "https://example.com/posts/42?x=1&y=2");

    expect(footer.html).toBe('<p><em>Original source at My &lt;Site&gt; &amp; Co.: <a href="https://example.com/posts/42?x=1&amp;y=2" class="u-url" rel="noopener noreferrer nofollow" target="_blank">https://example.com/posts/42?x=1&amp;y=2</a></em></p>');
    expect(footer.text).toBe("Original source at My <Site> & Co.: https://example.com/posts/42?x=1&y=2");
  });

  it("falls back to the canonical host when the site title is blank", () => {
    const footer = buildSourceFooter("   ", "https://creatr.example/posts/7");

    expect(footer.text).toBe("Original source at creatr.example: https://creatr.example/posts/7");
  });

  it("appends an html footer for rich posts", () => {
    const footer = buildSourceFooter("My Site", "https://example.com/posts/42");

    expect(buildSyndicatedContent({
      contentHtml: "<p>Hello</p>",
      contentFormat: "html",
      sourceFooterHtml: footer.html,
      sourceFooterText: footer.text,
    })).toBe(`<p>Hello</p>\n${footer.html}`);
  });

  it("replaces embedded interactive piece iframes with a plain source link before appending the footer", () => {
    const footer = buildSourceFooter("My Site", "https://example.com/posts/42");

    expect(buildSyndicatedContent({
      contentHtml: '<p>Intro</p><iframe src="https://creatr.example/embed/pieces/7?version=9" title="Orbit Bloom"></iframe>',
      contentFormat: "html",
      sourceFooterHtml: footer.html,
      sourceFooterText: footer.text,
    })).toBe(
      '<p>Intro</p><p><em>Orbit Bloom: <a href="https://creatr.example/embed/pieces/7?version=9" class="u-url" rel="noopener noreferrer nofollow" target="_blank">https://creatr.example/embed/pieces/7?version=9</a></em></p>\n' +
      footer.html,
    );
  });

  it("appends a text footer for plain posts", () => {
    const footer = buildSourceFooter("My Site", "https://example.com/posts/42");

    expect(buildSyndicatedContent({
      contentHtml: "Hello world",
      contentFormat: "plain",
      sourceFooterHtml: footer.html,
      sourceFooterText: footer.text,
    })).toBe(`Hello world\n\n${footer.text}`);
  });

  it("only appends footers for native posts", () => {
    expect(shouldAppendSourceFooter({ sourceFeedId: null })).toBe(true);
    expect(shouldAppendSourceFooter({ sourceFeedId: 12 })).toBe(false);
  });

  it("keeps custom social captions tied back to the canonical URL", () => {
    expect(ensureCanonicalUrl("Custom caption", "https://example.com/posts/42", "linkedin"))
      .toBe("Custom caption\n\nhttps://example.com/posts/42");
    expect(ensureCanonicalUrl("Already https://example.com/posts/42", "https://example.com/posts/42", "bluesky"))
      .toBe("Already https://example.com/posts/42");
  });

  it("includes the canonical URL in generated Instagram captions", () => {
    const text = buildSocialPostText(
      "instagram",
      { title: "Hello", content: "<p>World</p>", contentFormat: "html" },
      [],
      "https://example.com/posts/42",
    );

    expect(text).toContain("https://example.com/posts/42");
  });
});

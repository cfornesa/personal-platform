const EMBEDDED_TAGS = new Set(["IMG", "IFRAME", "FIGURE", "VIDEO", "AUDIO"]);

function isEmbeddedNode(node: Element): boolean {
  return EMBEDDED_TAGS.has(node.tagName) || node.hasAttribute("data-type");
}

/**
 * Splits editor HTML into two buckets:
 * - preservedHtml: non-text nodes (images, iframes, figures, art pieces)
 * - textOnlyContent: text content extracted from text container nodes
 *
 * Used by the AI improvement handler to keep embeds intact while replacing text.
 */
export function partitionEditorContent(html: string): {
  preservedHtml: string;
  textOnlyContent: string;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const children = Array.from(doc.body.childNodes);

  const preservedParts: string[] = [];
  const textParts: string[] = [];

  for (const node of children) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (isEmbeddedNode(el)) {
        preservedParts.push(el.outerHTML);
      } else {
        // Check if element contains any embedded descendants
        const embeds = el.querySelectorAll(
          "img, iframe, figure, video, audio, [data-type]",
        );
        if (embeds.length > 0) {
          preservedParts.push(el.outerHTML);
        } else {
          const text = el.textContent?.trim() ?? "";
          if (text) textParts.push(text);
        }
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim() ?? "";
      if (text) textParts.push(text);
    }
  }

  return {
    preservedHtml: preservedParts.join(""),
    textOnlyContent: textParts.join("\n\n"),
  };
}

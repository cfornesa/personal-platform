import { mergeAttributes, Node } from "@tiptap/core";

type IframeAttrs = {
  src: string;
  width?: string;
  height?: string;
  title?: string;
  ariaLabel?: string;
  allow?: string;
  loading?: string;
  referrerpolicy?: string;
  sandbox?: string;
  frameborder?: string;
  allowfullscreen?: string;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    iframeEmbed: {
      insertIframe: (attrs: IframeAttrs) => ReturnType;
    };
  }
}

export const IframeEmbed = Node.create({
  name: "iframeEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null, parseHTML: (el) => el.getAttribute("src") },
      width: { default: "100%", parseHTML: (el) => el.getAttribute("width") },
      height: { default: "420", parseHTML: (el) => el.getAttribute("height") },
      title: { default: "Embedded content", parseHTML: (el) => el.getAttribute("title") },
      ariaLabel: { default: null, parseHTML: (el) => el.getAttribute("aria-label") },
      allow: { default: null, parseHTML: (el) => el.getAttribute("allow") },
      loading: { default: "lazy", parseHTML: (el) => el.getAttribute("loading") },
      referrerpolicy: { default: null, parseHTML: (el) => el.getAttribute("referrerpolicy") },
      sandbox: { default: null, parseHTML: (el) => el.getAttribute("sandbox") },
      frameborder: { default: "0", parseHTML: (el) => el.getAttribute("frameborder") },
      allowfullscreen: { default: "true", parseHTML: (el) => el.getAttribute("allowfullscreen") },
    };
  },

  parseHTML() {
    return [{ tag: "iframe" }];
  },

  renderHTML({ HTMLAttributes }) {
    const { ariaLabel, ...rest } = HTMLAttributes as Record<string, unknown>;
    return ["iframe", mergeAttributes(rest, ariaLabel ? { "aria-label": ariaLabel } : {})];
  },

  addCommands() {
    return {
      insertIframe:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});

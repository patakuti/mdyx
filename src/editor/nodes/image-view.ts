import { imageSchema } from "@milkdown/preset-commonmark";
import { $view } from "@milkdown/utils";
import type { Node as PMNode } from "@milkdown/prose/model";
import type { NodeView } from "@milkdown/prose/view";

import { resolveImageDisplaySrc } from "../../clipboard/image-paste";
import type { ActiveFilePathGetter } from "../../clipboard/image-paste";

/// Crepe's own inline-image NodeView (`@milkdown/components`'s
/// `inlineImageView`) only ships bundled with the `ImageBlock` feature — and
/// that feature also silently promotes any image that's alone in its own
/// paragraph into a *different* node type, `image-block`
/// (`remark-image-block` plugin), which this app's whole image round-trip
/// design (01_requirements.md 5.2節, clipboard/image-paste.ts) was never
/// built to recognize. Confirmed by hand: opening a saved file with a
/// standalone `![]()` line (e.g. README.md) showed Crepe's own broken-image
/// placeholder — `image-block`'s default `toDOM` uses the raw, unresolved
/// `src` — and copying it produced `![1.00](path)` instead of the absolute
/// path: `image-block`'s own `toMarkdown` serializes its resize `ratio`
/// attribute (default `1`) into the alt slot.
///
/// `Crepe.Feature.ImageBlock` is disabled entirely (editor/setup.ts) to
/// remove that promotion — every image now stays the plain `image` node
/// this app's clipboard code already expects, whether it's inline with text
/// or alone in its own paragraph — but that also removes the only NodeView
/// that resolved a relative `src` into something the WebView can load. This
/// NodeView replaces it with the minimum needed for that: resolve `src` via
/// the same `resolveImageDisplaySrc` the rest of the app already uses, and
/// nothing else (no captions, resize handles, or upload UI —
/// 01_requirements.md 5.2節 already didn't want those). Click-to-select
/// needs no special handling here, unlike plantuml-view.ts/mermaid-view.ts:
/// those work around embedded SVG content confusing `view.posAtCoords()`,
/// which doesn't apply to a plain `<img>`.
export function createImageView(getActiveFilePath: ActiveFilePathGetter) {
  return $view(imageSchema.node, () => {
    return (initialNode: PMNode): NodeView => {
      const dom = document.createElement("img");
      dom.alt = initialNode.attrs.alt as string;
      dom.title = (initialNode.attrs.title as string) || "";
      // A failed load of the resolved `asset://`/`http://` URL below (wrong
      // path, missing file, ...) doesn't reject the `resolveSrc` promise —
      // resolution itself already succeeded by the time `dom.src` is set,
      // the *browser's own fetch of that URL* is what can still fail, later
      // and asynchronously. WebKitGTK was observed to render nothing at all
      // for that case (not even the classic broken-image icon a plain
      // `http://`/relative 404 shows) — so without this listener, a bad
      // path silently disappears instead of surfacing as a visible error
      // the way plantuml-view.ts/mermaid-view.ts already do for their own
      // render failures.
      dom.addEventListener("error", () => {
        dom.classList.add("image-node-error");
      });
      dom.addEventListener("load", () => {
        dom.classList.remove("image-node-error");
      });

      let renderToken = 0;
      let lastResolvedSrc = "";

      async function resolveSrc(src: string): Promise<void> {
        lastResolvedSrc = src;
        const token = ++renderToken;
        try {
          const resolved = await resolveImageDisplaySrc(src, getActiveFilePath);
          if (token !== renderToken) return;
          dom.src = resolved;
        } catch (error) {
          if (token !== renderToken) return;
          dom.classList.add("image-node-error");
          dom.alt = `Image failed to resolve: ${String(error)}`;
        }
      }

      void resolveSrc(initialNode.attrs.src as string);

      return {
        dom,
        update: (node) => {
          if (node.type !== initialNode.type) return false;
          dom.alt = node.attrs.alt as string;
          dom.title = (node.attrs.title as string) || "";
          if (node.attrs.src !== lastResolvedSrc) void resolveSrc(node.attrs.src as string);
          return true;
        },
      };
    };
  });
}

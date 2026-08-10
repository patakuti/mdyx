import mermaid from "mermaid";
import { $view } from "@milkdown/utils";
import { NodeSelection } from "@milkdown/prose/state";
import type { Node as PMNode } from "@milkdown/prose/model";
import type { EditorView, NodeView } from "@milkdown/prose/view";

import { mermaidSchema } from "./mermaid";

// `startOnLoad: false` stops mermaid's own default behavior (scanning the
// DOM for `.mermaid`-classed elements and rendering them automatically),
// which would otherwise race with this NodeView's own explicit `render()`
// calls below. Runs once at module load time (02_design.md 19章).
mermaid.initialize({ startOnLoad: false });

let nextRenderId = 0;

/// Like PlantUML (plantuml-view.ts), `mermaid` has no in-app source editor
/// at all — the document only ever shows the rendered SVG
/// (01_requirements.md 5.6節: edit externally, e.g. Mermaid Live Editor, and
/// round-trip the source via copy/paste; see mermaid-clipboard-plugin.ts).
function createMermaidNodeView(
  initialNode: PMNode,
  view: EditorView,
  getPos: () => number | undefined
): NodeView {
  const dom = document.createElement("div");
  dom.className = "mermaid-node";

  let renderToken = 0;
  let lastRenderedSvg = "";
  let lastRenderedSource = "";

  function showSvg(svg: string): void {
    lastRenderedSvg = svg;
    dom.classList.remove("mermaid-node-error");
    dom.innerHTML = svg;
  }

  async function render(source: string): Promise<void> {
    lastRenderedSource = source;
    const token = ++renderToken;
    dom.classList.remove("mermaid-node-error");
    dom.textContent = "Rendering...";
    try {
      const { svg } = await mermaid.render(`mermaid-${nextRenderId++}`, source);
      if (token !== renderToken) return;
      showSvg(svg);
      const pos = getPos();
      if (pos != null) {
        // Caching the rendered SVG onto the node is a background side
        // effect, not a user edit — it happens on every load/tab-switch for
        // any Mermaid node whose `svg` isn't cached yet (mirrors
        // plantuml-view.ts; 02_design.md 19章: svg is a session-only cache,
        // never saved to the markdown file). `addToHistory: false` keeps it
        // out of the undo stack, and TabManager (tabs/tab-manager.ts) reads
        // the same meta flag to keep it from marking the tab as having
        // unsaved changes.
        const tr = view.state.tr.setNodeAttribute(pos, "svg", svg);
        tr.setMeta("addToHistory", false);
        view.dispatch(tr);
      }
    } catch (error) {
      if (token !== renderToken) return;
      dom.classList.add("mermaid-node-error");
      dom.textContent = `Mermaid render failed: ${String(error)}`;
    }
  }

  if (initialNode.attrs.svg) {
    showSvg(initialNode.attrs.svg as string);
    lastRenderedSource = initialNode.attrs.source as string;
  } else {
    // Lazy render at NodeView construction time if there's no cached svg yet
    // (fresh insert, or a freshly opened file) — same policy as PlantUML
    // (plantuml-view.ts, 02_design.md 6章).
    void render(initialNode.attrs.source as string);
  }

  // The rendered SVG's own DOM confuses ProseMirror's coordinate→position
  // lookup that its default click-to-select relies on, exactly as measured
  // for PlantUML (plantuml-view.ts, 02_design.md 6章「動作確認で見つかった不具合と修正1」).
  // Applying that fix from the start here (rather than discovering the same
  // bug again) — dispatch NodeSelection explicitly on `mousedown`, and only
  // stop that one event type so `copy` still reaches
  // mermaid-clipboard-plugin.ts's `handleDOMEvents.copy`.
  dom.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const pos = getPos();
    if (pos == null) return;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
  });

  return {
    dom,
    stopEvent: (event) => event.type === "mousedown",
    ignoreMutation: () => true,
    update: (node) => {
      if (node.type !== initialNode.type) return false;
      if (node.attrs.svg && node.attrs.svg !== lastRenderedSvg) {
        showSvg(node.attrs.svg as string);
      } else if (node.attrs.source !== lastRenderedSource) {
        void render(node.attrs.source as string);
      }
      return true;
    },
  };
}

export const mermaidView = $view(mermaidSchema.node, () => createMermaidNodeView);

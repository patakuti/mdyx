import { invoke } from "@tauri-apps/api/core";
import { $view } from "@milkdown/utils";
import { NodeSelection } from "@milkdown/prose/state";
import type { Node as PMNode } from "@milkdown/prose/model";
import type { EditorView, NodeView } from "@milkdown/prose/view";

import { plantumlSchema } from "./plantuml";
import { getConfig } from "../../settings/config";

/// Like image nodes, `plantuml` has no in-app source editor at all — the
/// document only ever shows the rendered SVG (01_requirements.md 5.5節: edit
/// externally, e.g. blockly-plantuml-editor, and round-trip the source via
/// copy/paste; see plantuml-clipboard-plugin.ts). This mirrors the fact that
/// nothing else in the WYSIWYG surface exposes raw source either (no raw
/// LaTeX view for math, no raw pipe-syntax view for tables).
function createPlantumlNodeView(
  initialNode: PMNode,
  view: EditorView,
  getPos: () => number | undefined
): NodeView {
  const dom = document.createElement("div");
  dom.className = "plantuml-node";

  let renderToken = 0;
  let lastRenderedSvg = "";
  let lastRenderedSource = "";

  function showSvg(svg: string): void {
    lastRenderedSvg = svg;
    dom.classList.remove("plantuml-node-error");
    dom.innerHTML = svg;
  }

  async function render(source: string): Promise<void> {
    lastRenderedSource = source;
    const token = ++renderToken;
    dom.classList.remove("plantuml-node-error");
    dom.textContent = "Rendering...";
    try {
      const { plantumlServerUrl } = await getConfig();
      const svg = await invoke<string>("render_plantuml", {
        source,
        serverUrl: plantumlServerUrl,
      });
      if (token !== renderToken) return;
      showSvg(svg);
      const pos = getPos();
      if (pos != null) {
        view.dispatch(view.state.tr.setNodeAttribute(pos, "svg", svg));
      }
    } catch (error) {
      if (token !== renderToken) return;
      dom.classList.add("plantuml-node-error");
      dom.textContent = `PlantUML render failed: ${String(error)}`;
    }
  }

  if (initialNode.attrs.svg) {
    showSvg(initialNode.attrs.svg as string);
    lastRenderedSource = initialNode.attrs.source as string;
  } else {
    // 02_design.md 6章: "読込時はSVGは未取得状態(プレースホルダ)とし、表示時に
    // 遅延レンダリング" — render once at NodeView construction time if
    // there's no cached svg yet (fresh insert, or a freshly opened file).
    void render(initialNode.attrs.source as string);
  }

  // The rendered SVG's own DOM (e.g. its `<text>` elements) confuses
  // ProseMirror's coordinate→position lookup that its default
  // click-to-select relies on — measured: `view.posAtCoords()` over it
  // reliably resolved to a bogus position near the very start of the
  // document instead of this node. NodeSelection is dispatched explicitly
  // here instead (needed for the copy-source behavior in
  // plantuml-clipboard-plugin.ts, mirroring how image nodes are selected
  // for their own copy override). `stopEvent` only opts *this* event type
  // out of ProseMirror's own handling — otherwise ProseMirror's own (buggy)
  // resolution would run right after and clobber the selection just set
  // here. Other event types (notably "copy") are left alone so the
  // clipboard plugin's `handleDOMEvents.copy` still sees them.
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

export const plantumlView = $view(plantumlSchema.node, () => createPlantumlNodeView);

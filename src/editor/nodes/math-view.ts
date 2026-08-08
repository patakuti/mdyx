import "mathlive";
import type { MathfieldElement } from "mathlive";
import { $view } from "@milkdown/utils";
import { TextSelection } from "@milkdown/prose/state";
import type { Node as PMNode } from "@milkdown/prose/model";
import type { EditorView, NodeView } from "@milkdown/prose/view";

import { mathInlineSchema, mathBlockSchema, insertMathNode } from "./math";

/// LyX-like math editing (01_requirements.md 4章): the node's `latex` attr
/// is rendered live by a MathLive `<math-field>` at all times (it typesets
/// the formula itself, unlike a plain textarea), and editing it in place
/// moves the cursor through the formula structure with arrow keys plus
/// MathLive's own on-screen symbol palette — no separate "read" vs "edit"
/// rendering mode is needed.
function createMathNodeView(isBlock: boolean) {
  return (initialNode: PMNode, view: EditorView, getPos: () => number | undefined): NodeView => {
    const dom = document.createElement(isBlock ? "div" : "span");
    dom.className = isBlock ? "math-block-node" : "math-inline-node";

    const mathField = document.createElement("math-field") as MathfieldElement;
    mathField.value = initialNode.attrs.latex as string;
    dom.appendChild(mathField);

    // Convert this node to the other (inline/block) math type in place,
    // keeping the LaTeX (LyX-style mode switch, requested in place of
    // separate "Insert Inline Math"/"Insert Block Math" toolbar buttons).
    // Shown only while editing — see the `:focus-within` rules in
    // styles.css, same treatment as MathLive's own virtual-keyboard-toggle.
    const modeToggle = document.createElement("button");
    modeToggle.type = "button";
    modeToggle.className = "math-mode-toggle";
    modeToggle.title = isBlock ? "Convert to inline math" : "Convert to block math";
    modeToggle.textContent = isBlock ? "→ Inline" : "→ Block";
    modeToggle.addEventListener("mousedown", (event) => event.preventDefault());
    modeToggle.addEventListener("click", () => {
      const pos = getPos();
      if (pos == null) return;
      const { nodes } = view.state.schema;
      const otherType = isBlock ? nodes.math_inline : nodes.math_block;
      if (!otherType) return;
      const latex = mathField.value;
      // `stopEvent` (below) makes ProseMirror ignore clicks into the
      // mathfield, so `view.state.selection` never actually moves to this
      // node while it's being edited — it's whatever it was before the
      // field was focused. Deleting via `pos` (from `getPos()`, correct)
      // and then letting `insertMathNode` read `view.state.selection.from`
      // would silently insert the converted node at that stale position
      // instead of here (reproduced: with real text before *and* after the
      // node, this both misplaced the block node and, depending on the
      // stale position, ate into the surrounding text). Explicitly move the
      // selection to the deletion point first so `insertMathNode` picks up
      // the right spot.
      const tr = view.state.tr.delete(pos, pos + initialNode.nodeSize);
      tr.setSelection(TextSelection.create(tr.doc, pos));
      view.dispatch(tr);
      insertMathNode(view, otherType, latex);
    });
    dom.appendChild(modeToggle);

    mathField.addEventListener("input", () => {
      const pos = getPos();
      if (pos == null) return;
      const tr = view.state.tr.setNodeAttribute(pos, "latex", mathField.value);
      view.dispatch(tr);
    });

    mathField.addEventListener("move-out", (event) => {
      const pos = getPos();
      if (pos == null) return;
      const direction = (event as CustomEvent<{ direction: string }>).detail.direction;
      const targetPos = direction === "backward" || direction === "upward" ? pos : pos + initialNode.nodeSize;
      const selection = TextSelection.near(view.state.doc.resolve(targetPos), direction === "backward" ? -1 : 1);
      view.dispatch(view.state.tr.setSelection(selection));
      view.focus();
    });

    return {
      dom,
      selectNode: () => mathField.focus(),
      deselectNode: () => mathField.blur(),
      stopEvent: () => true,
      ignoreMutation: () => true,
      update: (node) => {
        if (node.type !== initialNode.type) return false;
        if (node.attrs.latex !== mathField.value) mathField.value = node.attrs.latex as string;
        return true;
      },
    };
  };
}

export const mathInlineView = $view(mathInlineSchema.node, () => createMathNodeView(false));
export const mathBlockView = $view(mathBlockSchema.node, () => createMathNodeView(true));

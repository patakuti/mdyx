import { $nodeSchema, $remark } from "@milkdown/utils";
import remarkMath from "remark-math";
import { NodeSelection } from "@milkdown/prose/state";
import type { NodeType } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";

/// remark-math parses `$...$` into an mdast `inlineMath` node and `$$...$$`
/// (its own line/block) into an mdast `math` node, both carrying the LaTeX
/// source as `.value` (01_requirements.md 4章). This is the standard remark
/// math plugin (also used internally by Crepe's own, disabled, Latex
/// feature — see setup.ts).
export const remarkMathPlugin = $remark("remarkMath", () => remarkMath);

export const mathInlineSchema = $nodeSchema("math_inline", () => ({
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  attrs: {
    latex: { default: "" },
  },
  parseDOM: [
    {
      tag: 'span[data-type="math_inline"]',
      getAttrs: (dom) => ({ latex: (dom as HTMLElement).dataset.latex ?? "" }),
    },
  ],
  toDOM: (node) => {
    const dom = document.createElement("span");
    dom.dataset.type = "math_inline";
    dom.dataset.latex = node.attrs.latex as string;
    return dom;
  },
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    runner: (state, node, type) => {
      state.addNode(type, { latex: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_inline",
    runner: (state, node) => {
      state.addNode("inlineMath", undefined, node.attrs.latex);
    },
  },
}));

export const mathBlockSchema = $nodeSchema("math_block", () => ({
  group: "block",
  atom: true,
  isolating: true,
  attrs: {
    latex: { default: "" },
  },
  parseDOM: [
    {
      tag: 'div[data-type="math_block"]',
      getAttrs: (dom) => ({ latex: (dom as HTMLElement).dataset.latex ?? "" }),
    },
  ],
  toDOM: (node) => {
    const dom = document.createElement("div");
    dom.dataset.type = "math_block";
    dom.dataset.latex = node.attrs.latex as string;
    return dom;
  },
  parseMarkdown: {
    match: (node) => node.type === "math",
    runner: (state, node, type) => {
      state.addNode(type, { latex: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_block",
    runner: (state, node) => {
      state.addNode("math", undefined, node.attrs.latex);
    },
  },
}));

/// Inserts a math node of `type` (carrying `latex`, empty by default) at the
/// current selection and selects it as a NodeSelection, so its NodeView's
/// `selectNode()` (math-view.ts) focuses the MathLive field right away —
/// matching LyX's "insert then type" flow. Also used by math-view.ts's
/// inline/block toggle button (delete the old node, then insert the other
/// type at the same spot, keeping the LaTeX).
///
/// `math_block` is a block-level node, so it can't just replace an
/// inline-context selection in the middle of a paragraph: mirroring
/// `insertHrCommand` (preset-commonmark/node/hr.ts), `replaceSelectionWith`
/// splits the paragraph around it, and inserting an extra empty paragraph
/// at the original position keeps a well-formed doc either side of it.
/// Exactly where the new node lands after that split depends on context
/// (e.g. whether it's at the very end of the document), so instead of
/// computing its position by hand, it's located by scanning the doc after
/// dispatch.
export function insertMathNode(view: EditorView, type: NodeType, latex = ""): void {
  const node = type.create({ latex });
  const pos = view.state.selection.from;
  let tr = view.state.tr.replaceSelectionWith(node);
  if (type.isBlock) {
    const paragraphType = view.state.schema.nodes.paragraph;
    if (paragraphType) tr = tr.insert(pos, paragraphType.create());
  }
  view.dispatch(tr.scrollIntoView());

  let mathPos: number | null = null;
  view.state.doc.nodesBetween(pos, view.state.doc.content.size, (n, p) => {
    if (mathPos != null) return false;
    if (n.type === type) {
      mathPos = p;
      return false;
    }
    return true;
  });
  if (mathPos != null) {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, mathPos)));
  }
}

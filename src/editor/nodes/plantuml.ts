import { invoke } from "@tauri-apps/api/core";
import { $nodeSchema } from "@milkdown/utils";
import { codeBlockSchema } from "@milkdown/preset-commonmark";
import { NodeSelection } from "@milkdown/prose/state";
import { insertPoint } from "@milkdown/prose/transform";
import type { EditorView } from "@milkdown/prose/view";

const PLANTUML_LANGUAGE = "plantuml";

export const DEFAULT_PLANTUML_SOURCE = "@startuml\n\n@enduml";

/// A pasted/clipboard text counts as a PlantUML source only if it's *fully*
/// an `@startuml`〜`@enduml` block (01_requirements.md 5.5節) — shared by
/// the paste auto-detection (plantuml-clipboard-plugin.ts) and Insert >
/// PlantUML Diagram's own clipboard check below.
export const PLANTUML_SOURCE_PATTERN = /^@startuml[\s\S]*@enduml$/;

/// Crepe's default `code_block` node otherwise claims every mdast `code`
/// node unconditionally (parseMarkdown.match only checks `type === "code"`,
/// see @milkdown/preset-commonmark/src/node/code-block.ts), so without this
/// override it would always win the parser match over `plantumlSchema`
/// below and no ` ```plantuml ` fence would ever reach it. Narrowing the
/// match to exclude the `plantuml` language leaves every other fenced code
/// block (JS, Python, ...) going through Crepe's own code block exactly as
/// before.
export const nonPlantumlCodeBlockSchema = codeBlockSchema.extendSchema(
  (factory) => (ctx) => {
    const base = factory(ctx);
    return {
      ...base,
      parseMarkdown: {
        ...base.parseMarkdown,
        match: (node) => node.type === "code" && node.lang !== PLANTUML_LANGUAGE,
      },
    };
  }
);

/// `svg` caches the last successful render so it survives NodeView
/// recreation (e.g. undo/redo), but is intentionally left out of
/// `toMarkdown` below — it's a session-only cache, not part of the saved
/// document (01_requirements.md 5.5節: caching/offline support isn't
/// required).
export const plantumlSchema = $nodeSchema("plantuml", () => ({
  group: "block",
  atom: true,
  isolating: true,
  attrs: {
    source: { default: DEFAULT_PLANTUML_SOURCE },
    svg: { default: "" },
  },
  parseDOM: [
    {
      tag: 'div[data-type="plantuml"]',
      getAttrs: (dom) => ({ source: (dom as HTMLElement).dataset.source ?? "" }),
    },
  ],
  toDOM: (node) => {
    const dom = document.createElement("div");
    dom.dataset.type = "plantuml";
    dom.dataset.source = node.attrs.source as string;
    return dom;
  },
  parseMarkdown: {
    match: (node) => node.type === "code" && node.lang === PLANTUML_LANGUAGE,
    runner: (state, node, type) => {
      state.addNode(type, { source: (node.value as string | null) ?? "" });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "plantuml",
    runner: (state, node) => {
      state.addNode("code", undefined, node.attrs.source as string, {
        lang: PLANTUML_LANGUAGE,
      });
    },
  },
}));

/// Inserts a fresh `plantuml` node at the current selection and selects it
/// (`NodeSelection`), so a following Copy immediately gets its source
/// (plantuml-clipboard-plugin.ts) — mirroring LyX's "insert then it's
/// selected/ready" flow.
///
/// `plantuml` is a block node, so a selection inside inline content (e.g.
/// mid-heading) can't just be replaced with it directly. Deleting any
/// active selection first, then using `insertPoint` (prosemirror-transform)
/// to find where a block node can actually go from the resulting cursor
/// position, mirrors exactly what `Transaction.replaceSelectionWith` does
/// internally for a block node — but doing it explicitly, then using a
/// plain `tr.insert(point, node)`, gives a `point` that's known safe to use
/// directly for both the trailing empty paragraph (kept for a well-formed
/// doc on both sides, mirroring math.ts's `insertMathNode`) and the final
/// `NodeSelection`.
///
/// This replaced an earlier version that computed the insertion point by
/// mapping the pre-insertion selection through `tr.mapping` after calling
/// `replaceSelectionWith` — which silently broke (selecting a nearby text
/// node instead) whenever the cursor sat at the very start of a block's
/// content, e.g. right before a heading's first character: `insertPoint`
/// (called internally by `replaceSelectionWith` in that case) redirects the
/// actual splice point to just before the heading, so the original,
/// pre-redirect cursor position no longer corresponds to where the node
/// was actually spliced in, and mapping it through gave a wrong answer.
/// Confirmed via direct inspection of the resulting doc/selection in the
/// browser, both before and after this fix.
export function insertPlantumlNode(view: EditorView, source = DEFAULT_PLANTUML_SOURCE): void {
  const type = view.state.schema.nodes.plantuml;
  if (!type) return;

  const node = type.create({ source });
  const paragraphType = view.state.schema.nodes.paragraph;
  const tr = view.state.tr;
  if (!tr.selection.empty) tr.deleteSelection();

  const point = insertPoint(tr.doc, tr.selection.from, type) ?? tr.selection.from;
  tr.insert(point, node);
  if (paragraphType) tr.insert(point + node.nodeSize, paragraphType.create());

  tr.setSelection(NodeSelection.create(tr.doc, point));
  view.dispatch(tr.scrollIntoView());
}

/// Insert > PlantUML Diagram / the toolbar's "PU" button: checks the
/// clipboard for a PlantUML source first and uses it if present, otherwise
/// falls back to an empty diagram — mirroring Insert > Image, which reads
/// the clipboard (`read_clipboard_for_image`) rather than always inserting
/// a blank placeholder.
export async function insertPlantumlNodeFromClipboard(view: EditorView): Promise<void> {
  const text = await invoke<string | null>("read_clipboard_text");
  const trimmed = text?.trim();
  const source = trimmed && PLANTUML_SOURCE_PATTERN.test(trimmed) ? trimmed : undefined;
  insertPlantumlNode(view, source);
}

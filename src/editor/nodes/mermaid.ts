import { invoke } from "@tauri-apps/api/core";
import { $nodeSchema } from "@milkdown/utils";
import { NodeSelection } from "@milkdown/prose/state";
import { insertPoint } from "@milkdown/prose/transform";
import type { EditorView } from "@milkdown/prose/view";

const MERMAID_LANGUAGE = "mermaid";

export const DEFAULT_MERMAID_SOURCE = "graph TD\n";

/// Unlike PlantUML's self-contained `@startuml`〜`@enduml` delimiters
/// (plantuml.ts), Mermaid's own syntax has no single marker common to every
/// diagram type (`graph`, `flowchart`, `sequenceDiagram`, ... all differ) —
/// so a bare, unfenced snippet can't be told apart from unrelated text with
/// confidence. A ` ```mermaid ` fence is required instead (01_requirements.md
/// 5.6節). Multiline `s` flag lets `.` also match newlines inside the fence.
const MERMAID_FENCE_PATTERN = /^```mermaid\s*\r?\n([\s\S]*?)\r?\n```\s*$/i;

/// Extracts a Mermaid source from pasted/clipboard text — only recognizes a
/// ` ```mermaid ` fenced code block, never bare text (see
/// `MERMAID_FENCE_PATTERN` above for why). Used by both the paste
/// auto-detection (mermaid-clipboard-plugin.ts) and Insert > Mermaid
/// Diagram's own clipboard check below. Returns `null` if the text isn't
/// fenced Mermaid source.
export function extractMermaidSource(text: string): string | null {
  const fenceMatch = MERMAID_FENCE_PATTERN.exec(text.trim());
  const unfenced = fenceMatch?.[1].trim();
  return unfenced || null;
}

/// `svg` caches the last successful render so it survives NodeView
/// recreation (e.g. undo/redo), but is intentionally left out of
/// `toMarkdown` below — it's a session-only cache, not part of the saved
/// document (01_requirements.md 5.6節: caching/offline support isn't
/// required).
export const mermaidSchema = $nodeSchema("mermaid", () => ({
  group: "block",
  atom: true,
  isolating: true,
  attrs: {
    source: { default: DEFAULT_MERMAID_SOURCE },
    svg: { default: "" },
  },
  parseDOM: [
    {
      tag: 'div[data-type="mermaid"]',
      getAttrs: (dom) => ({ source: (dom as HTMLElement).dataset.source ?? "" }),
    },
  ],
  toDOM: (node) => {
    const dom = document.createElement("div");
    dom.dataset.type = "mermaid";
    dom.dataset.source = node.attrs.source as string;
    return dom;
  },
  parseMarkdown: {
    match: (node) => node.type === "code" && node.lang === MERMAID_LANGUAGE,
    runner: (state, node, type) => {
      state.addNode(type, { source: (node.value as string | null) ?? "" });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "mermaid",
    runner: (state, node) => {
      state.addNode("code", undefined, node.attrs.source as string, {
        lang: MERMAID_LANGUAGE,
      });
    },
  },
}));

/// Inserts a fresh `mermaid` node at the current selection and selects it
/// (`NodeSelection`), so a following Copy immediately gets its source
/// (mermaid-clipboard-plugin.ts) — same pattern as `insertPlantumlNode`
/// (plantuml.ts), including the `insertPoint`-based placement (see that
/// function's own doc comment for why a plain `replaceSelectionWith` isn't
/// used).
export function insertMermaidNode(view: EditorView, source = DEFAULT_MERMAID_SOURCE): void {
  const type = view.state.schema.nodes.mermaid;
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

/// Insert > Mermaid Diagram / the toolbar's "ME" button: checks the
/// clipboard for a fenced Mermaid source first and uses it if present,
/// otherwise falls back to an empty diagram — mirroring
/// `insertPlantumlNodeFromClipboard` (plantuml.ts).
export async function insertMermaidNodeFromClipboard(view: EditorView): Promise<void> {
  const text = await invoke<string | null>("read_clipboard_text");
  const source = text ? (extractMermaidSource(text) ?? undefined) : undefined;
  insertMermaidNode(view, source);
}

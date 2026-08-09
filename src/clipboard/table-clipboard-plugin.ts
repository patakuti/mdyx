import { invoke } from "@tauri-apps/api/core";
import type { Ctx } from "@milkdown/ctx";
import { NodeSelection, Plugin } from "@milkdown/prose/state";
import type { EditorState } from "@milkdown/prose/state";
import type { Node as PMNode } from "@milkdown/prose/model";
import { tableSchema } from "@milkdown/preset-gfm";
import { CellSelection, findTable, selectedRect } from "@milkdown/prose/tables";

import {
  htmlToTableNode,
  textToTableNode,
  needsHtmlBlock,
  tableNodeToHtml,
  tableNodeToMarkdown,
} from "../editor/markdown-io/html-table";
import { insertTableNode } from "./table-insert";
import { prosePrepend } from "./prose-prepend";

/// The document range `[from, to)` of the enclosing `table` node, if the
/// current selection represents "the whole table" — either a
/// `NodeSelection` directly on it, or a `CellSelection` spanning every cell.
/// The latter is what this app's own "select table" affordance actually
/// produces (`selectTableCommand`/`selectTable`, `@milkdown/preset-gfm`,
/// confirmed by reading its source: it builds a `CellSelection` from the
/// table's first cell to its last) — `table` isn't an atom node, so a plain
/// click never gives it a `NodeSelection` the way image/PlantUML nodes get.
/// A `CellSelection` over only *some* cells is a normal "paste into this
/// cell range" gesture and must be left alone — ProseMirror-tables' own
/// built-in `handlePaste` (registered by `tableEditing()`, part of
/// `@milkdown/preset-gfm`'s table plugin) already does the right thing
/// there, fitting the paste into the selected rectangle. Returns `null` for
/// any selection that isn't "the whole table" so this plugin never
/// intercepts that case (02_design.md 14.1節).
function wholeTableRange(state: EditorState, ctx: Ctx): { from: number; to: number } | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    return selection.node.type === tableSchema.type(ctx) ? { from: selection.from, to: selection.to } : null;
  }
  if (!(selection instanceof CellSelection)) return null;

  const rect = selectedRect(state);
  const isWholeTable = rect.left === 0 && rect.top === 0 && rect.right === rect.map.width && rect.bottom === rect.map.height;
  if (!isWholeTable) return null;

  const table = findTable(selection.$from);
  return table ? { from: table.pos, to: table.pos + table.node.nodeSize } : null;
}

/// Overrides copy when the whole table is selected: writes `text/html`
/// (always the table's HTML) and `text/plain` (pipe syntax, or the same
/// HTML as text if the table has a merged cell pipe syntax can't represent
/// — the same `needsHtmlBlock` decision the file-save path already makes,
/// 01_requirements.md 5.3節/5.4節) via the Rust-routed `write_clipboard_table`
/// — not the WebView's `clipboardData.setData`, which mangles non-ASCII
/// text on WebKitGTK (02_design.md 10章), the same reason image/PlantUML
/// copy already goes through Rust.
async function copyWholeTable(ctx: Ctx, table: PMNode): Promise<void> {
  const html = tableNodeToHtml(ctx, table);
  const plainText = needsHtmlBlock(table) ? html : tableNodeToMarkdown(ctx, table);
  await invoke("write_clipboard_table", { html, plainText });
}

/// Replaces the whole selected table with the pasted table
/// (01_requirements.md 5.1節/5.3節, Phase 11) — the same "node selected →
/// interpret paste as that node type" treatment images
/// (image-clipboard-plugin.ts) and PlantUML (plantuml-clipboard-plugin.ts)
/// already have.
///
/// **Bug found and fixed via real-machine testing** (confidence: high,
/// directly reproduced): the first version of this plugin only checked for
/// a `NodeSelection`, which a `table` node — not an atom node — never
/// actually gets from normal use of this app's "select table" UI. That
/// selection is really a `CellSelection` (see `wholeTableRange` above), so
/// the paste fell through to ProseMirror-tables' own built-in `handlePaste`
/// (`insertCells`), which pastes cell-by-cell *into the previously selected
/// rectangle's existing grid boundaries* rather than replacing the table
/// outright — exactly the LibreOffice Calc merged-cell report (colspan/
/// rowspan silently lost on tables whose shape differs from what was
/// selected before). Replacing the whole `table` node's range directly
/// (`wholeTableRange`) bypasses that per-cell insertion path entirely.
///
/// Reads `event.clipboardData` synchronously via ProseMirror's own
/// `handlePaste` prop — the path 02_design.md 8章/4.4節 already confirmed
/// reliable on WebKitGTK (unlike reading it from an ancestor capture-phase
/// listener). This makes it a genuinely different, working path from
/// Insert > Table's HTML-table detection, which instead depends on
/// `navigator.clipboard.read()` and is confirmed failing on Linux
/// (02_design.md 4.6節/8章) — a real paste event's `clipboardData` isn't
/// gated by that same permission prompt.
export const tableClipboardPlugin = prosePrepend((ctx) => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        copy: (view, event) => {
          const range = wholeTableRange(view.state, ctx);
          if (!range) return false;
          const table = view.state.doc.nodeAt(range.from);
          if (!table) return false;

          event.preventDefault();
          void copyWholeTable(ctx, table);
          return true;
        },
      },
      handlePaste: (view, event) => {
        const range = wholeTableRange(view.state, ctx);
        if (range) {
          const html = event.clipboardData?.getData("text/html");
          let table = html && /<table\b/i.test(html) ? htmlToTableNode(ctx, html) : null;
          if (!table) {
            const text = event.clipboardData?.getData("text/plain");
            table = text ? textToTableNode(ctx, text) : null;
          }
          if (!table) return false;

          view.dispatch(view.state.tr.replaceWith(range.from, range.to, table));
          return true;
        }

        // Nothing (or only some cells) selected. A real `text/html` table
        // is already handled correctly by Milkdown's own default paste
        // pipeline (01_requirements.md 5.1節, confirmed working — don't
        // duplicate/interfere with it here). This only steps in for the
        // gap that leaves open: `text/plain` containing literal HTML-as-
        // text with no real `text/html` alongside it — exactly what this
        // app's own copy of a merged-cell table produces (14.1節), so it's
        // still recognized as a table after round-tripping through a
        // plain-text-only intermediary. A partial `CellSelection` (a normal
        // "paste into these cells" gesture) is left to ProseMirror-tables'
        // own handling either way.
        if (view.state.selection instanceof CellSelection) return false;
        const html = event.clipboardData?.getData("text/html");
        if (html && /<table\b/i.test(html)) return false;

        const text = event.clipboardData?.getData("text/plain");
        if (!text || !/<table\b/i.test(text)) return false;
        const table = htmlToTableNode(ctx, text);
        if (!table) return false;

        insertTableNode(view, table);
        return true;
      },
    },
  });
});

import { invoke } from "@tauri-apps/api/core";
import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/core";
import { insertTableCommand } from "@milkdown/preset-gfm";
import { callCommand } from "@milkdown/utils";
import { NodeSelection } from "@milkdown/prose/state";
import { insertPoint } from "@milkdown/prose/transform";
import type { Node as PMNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";

import { htmlToTableNode, textToTableNode } from "../editor/markdown-io/html-table";

const EMPTY_TABLE_ROWS = 2;
const EMPTY_TABLE_COLS = 2;

/// Rust's `tauri-plugin-clipboard-manager` (`ClipboardExt`) has `read_text`/
/// `read_image`/`write_html` but no HTML read (confirmed by reading its
/// source, 02_design.md 4.6節), so an HTML clipboard table can only be read
/// from the frontend, via the standard Clipboard API. Whether this actually
/// works (permission prompts, WebKitGTK support) is unverified until tested
/// against the real app; any failure/rejection here just falls through to
/// the text/plain path below, so the feature degrades to "pipe-table text
/// only" rather than breaking.
async function readHtmlTable(ctx: Ctx): Promise<PMNode | null> {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types.includes("text/html")) continue;
      const html = await (await item.getType("text/html")).text();
      if (!/<table\b/i.test(html)) continue;
      const table = htmlToTableNode(ctx, html);
      if (table) return table;
    }
  } catch {
    // Clipboard API unavailable/denied for this format.
  }
  return null;
}

/// Prefers the frontend Clipboard API (available in the same document as
/// the editor, no IPC round-trip) and falls back to the Rust command already
/// used by Insert > PlantUML Diagram if it's unavailable/denied.
async function readPlainText(): Promise<string | null> {
  if (navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) return text;
    } catch {
      // Fall through to the Rust-side read below.
    }
  }
  return invoke<string | null>("read_clipboard_text");
}

export function insertTableNode(view: EditorView, node: PMNode): void {
  const tr = view.state.tr;
  if (!tr.selection.empty) tr.deleteSelection();

  const point = insertPoint(tr.doc, tr.selection.from, node.type) ?? tr.selection.from;
  tr.insert(point, node);
  tr.setSelection(NodeSelection.create(tr.doc, point));
  view.dispatch(tr.scrollIntoView());
}

/// Insert > Table diagram / the toolbar's "⊞" button: checks the clipboard
/// for a table first and uses it if present, otherwise falls back to an
/// empty 2x2 table — mirroring Insert > Image / Insert > PlantUML Diagram
/// (01_requirements.md 5.3節, 02_design.md 4.6節). Tries, in order: a
/// `text/html` `<table>`, then whatever `textToTableNode` can make of
/// `text/plain` (literal HTML-as-text, e.g. round-tripped through a
/// plain-text-only intermediary — or GFM pipe syntax), then the empty-table
/// fallback.
export async function insertTableFromClipboard(ctx: Ctx): Promise<void> {
  const htmlTable = await readHtmlTable(ctx);
  if (htmlTable) {
    insertTableNode(ctx.get(editorViewCtx), htmlTable);
    return;
  }

  const text = await readPlainText();
  const table = text ? textToTableNode(ctx, text) : null;
  if (table) {
    insertTableNode(ctx.get(editorViewCtx), table);
    return;
  }

  callCommand(insertTableCommand.key, { row: EMPTY_TABLE_ROWS, col: EMPTY_TABLE_COLS })(ctx);
}

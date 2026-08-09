import type { Ctx } from "@milkdown/ctx";
import { parserCtx, schemaCtx, serializerCtx } from "@milkdown/core";
import { DOMParser as ProseDOMParser, DOMSerializer, Fragment } from "@milkdown/prose/model";
import type { Node as PMNode } from "@milkdown/prose/model";
import { tableSchema } from "@milkdown/preset-gfm";
import { paragraphSchema } from "@milkdown/preset-commonmark";

/// GFM pipe-table syntax has no concept of merged cells (01_requirements.md
/// 5.4). Instead of a dedicated node type for such tables (see 02_design.md
/// 3章 for why that was reconsidered after Phase 3), a single `table` node is
/// used throughout, and only tables that actually contain a merged cell are
/// diverted to a raw HTML block on save. The conversion goes through the DOM
/// (ProseMirror's own DOMSerializer/DOMParser) rather than through remark's
/// mdast pipeline, since prosemirror-tables' `toDOM`/`parseDOM` rules already
/// round-trip colspan/rowspan/alignment correctly (this is the same
/// mechanism that already makes pasting an external HTML table work).

const PLACEHOLDER_PREFIX = "mdyx-html-table-placeholder-";

interface Placeholder {
  token: string;
  html: string;
}

const CELL_NODE_NAMES = new Set(["table_cell", "table_header"]);

/// A table can't be represented as GFM pipe syntax (and needs a raw HTML
/// block instead) if any cell spans multiple rows/columns, or holds more
/// than one paragraph (possible after merging two cells that both had text;
/// see setup.ts for why cells can hold more than one paragraph at all).
export function needsHtmlBlock(table: PMNode): boolean {
  let needsHtml = false;
  table.descendants((node) => {
    if (needsHtml) return false;
    const { colspan, rowspan } = node.attrs as { colspan?: number; rowspan?: number };
    if ((colspan ?? 1) > 1 || (rowspan ?? 1) > 1) {
      needsHtml = true;
      return false;
    }
    if (CELL_NODE_NAMES.has(node.type.name) && node.childCount > 1) {
      needsHtml = true;
      return false;
    }
    return true;
  });
  return needsHtml;
}

export function tableNodeToHtml(ctx: Ctx, table: PMNode): string {
  const schema = ctx.get(schemaCtx);
  const dom = DOMSerializer.fromSchema(schema).serializeNode(table);
  const container = document.createElement("div");
  container.appendChild(dom);
  return container.innerHTML;
}

/// Serializes a single `table` node to GFM pipe syntax, reusing the same
/// markdown serializer File > Save uses (wrapped in a throwaway `doc` node,
/// since the serializer expects one). Used for copying a table whose cells
/// have no merges (01_requirements.md 5.3節, table-clipboard-plugin.ts) —
/// tables that *do* have merges go through `tableNodeToHtml` above instead,
/// mirroring the exact same `needsHtmlBlock` decision the file-save path
/// already makes for the same reason (4.3節).
export function tableNodeToMarkdown(ctx: Ctx, table: PMNode): string {
  const schema = ctx.get(schemaCtx);
  const serializer = ctx.get(serializerCtx);
  const doc = schema.topNodeType.create(null, Fragment.from(table));
  return serializer(doc).trim();
}

function firstTableNode(ctx: Ctx, root: PMNode | Fragment): PMNode | null {
  let table: PMNode | null = null;
  root.descendants((node) => {
    if (table) return false;
    if (node.type === tableSchema.type(ctx)) {
      table = node;
      return false;
    }
    return true;
  });
  return table;
}

/// Uses `parseSlice`, not `parse`. `parse` requires the parsed result to be
/// a fully valid standalone document, and `table`'s content expression is
/// `table_header_row table_row+` — pasted HTML without an actual `<th>`
/// (e.g. a LibreOffice Calc cell-range copy, which uses plain `<td>`
/// throughout) doesn't satisfy that on its own, so `parse` invokes its
/// content-repair path to coerce the first row into a header row, and that
/// repair silently drops `colspan`/`rowspan` off the coerced cells — losing
/// merged-cell information on exactly the cases 01_requirements.md 5.4節
/// most needs to preserve (measured/reproduced directly against this
/// function: colspan 2 came back as 1). `parseSlice` doesn't need the
/// result to be immediately valid on its own (a `Slice` may have open
/// ends), so it never triggers that repair and preserves the attrs
/// faithfully — confirmed against both this same header-less input and an
/// already-well-formed `<th>`-containing table (no regression).
export function htmlToTableNode(ctx: Ctx, html: string): PMNode | null {
  const schema = ctx.get(schemaCtx);
  const container = document.createElement("div");
  container.innerHTML = html;
  const slice = ProseDOMParser.fromSchema(schema).parseSlice(container);
  return firstTableNode(ctx, slice.content);
}

/// Parses `markdown` (e.g. clipboard `text/plain`) with Milkdown's own
/// markdown parser and returns its first `table` node, or `null` if it
/// doesn't contain a GFM pipe-table. Used by Insert > Table's clipboard
/// detection (01_requirements.md 5.3節, 02_design.md 4.6節) so it accepts
/// exactly the same pipe-table syntax File > Open does.
export function markdownToTableNode(ctx: Ctx, markdown: string): PMNode | null {
  const parser = ctx.get(parserCtx);
  const doc = parser(markdown);
  if (!doc) return null;
  return firstTableNode(ctx, doc);
}

/// Interprets an arbitrary `text/plain` payload as a table, trying, in
/// order: literal HTML source (`<table>...</table>` as plain text — exactly
/// what this app's own copy of a merged-cell table writes to `text/plain`,
/// since pipe syntax can't represent merges, 5.3節/5.4節), then GFM pipe
/// syntax. Used wherever a table has to be recovered from `text/plain`
/// alone — no real `text/html` available — so a table round-tripped through
/// a plain-text-only intermediary (a text editor, a clipboard manager that
/// drops rich formats, ...) is still recognized as a table rather than
/// pasted as literal escaped-looking text (01_requirements.md 5.1節/5.3節,
/// Phase 11: `table-insert.ts`'s Insert > Table and
/// `table-clipboard-plugin.ts`'s paste auto-detection both call this).
export function textToTableNode(ctx: Ctx, text: string): PMNode | null {
  if (/<table\b/i.test(text)) {
    const table = htmlToTableNode(ctx, text);
    if (table) return table;
  }
  return markdownToTableNode(ctx, text);
}

function mapDescendants(node: PMNode, replace: (node: PMNode) => PMNode | null): PMNode {
  const replaced = replace(node);
  if (replaced) return replaced;
  if (node.childCount === 0) return node;

  let changed = false;
  const children: PMNode[] = [];
  node.forEach((child) => {
    const next = mapDescendants(child, replace);
    if (next !== child) changed = true;
    children.push(next);
  });
  if (!changed) return node;
  return node.copy(Fragment.fromArray(children));
}

/// Replace every `table` node that contains a merged cell with a single
/// placeholder paragraph, returning the substituted doc plus the HTML each
/// placeholder stands for. The caller serializes the substituted doc through
/// the normal markdown serializer, then splices the recorded HTML back into
/// the resulting markdown string in place of each placeholder token.
export function extractHtmlTablesFromDoc(ctx: Ctx, doc: PMNode): { doc: PMNode; placeholders: Placeholder[] } {
  const tableType = tableSchema.type(ctx);
  const paragraphType = paragraphSchema.type(ctx);
  const schema = ctx.get(schemaCtx);
  const placeholders: Placeholder[] = [];
  let counter = 0;

  const nextDoc = mapDescendants(doc, (node) => {
    if (node.type !== tableType || !needsHtmlBlock(node)) return null;
    const token = `${PLACEHOLDER_PREFIX}${counter++}`;
    placeholders.push({ token, html: tableNodeToHtml(ctx, node) });
    return paragraphType.create(null, schema.text(token));
  });

  return { doc: nextDoc, placeholders };
}

const TABLE_BLOCK_PATTERN = /^[ \t]{0,3}<table\b[^>]*>[\s\S]*?<\/table>[ \t]*$/gim;

/// Replace every raw HTML `<table>...</table>` block in the markdown source
/// with a placeholder token (on its own line, so it parses as a plain
/// paragraph), returning the substituted text plus the HTML each placeholder
/// stands for. The caller parses the substituted text through the normal
/// markdown parser, then walks the resulting doc replacing each placeholder
/// paragraph with the real `table` node parsed from the recorded HTML.
export function extractHtmlTablesFromMarkdown(markdown: string): { text: string; placeholders: Placeholder[] } {
  const placeholders: Placeholder[] = [];
  let counter = 0;
  const text = markdown.replace(TABLE_BLOCK_PATTERN, (match) => {
    const token = `${PLACEHOLDER_PREFIX}${counter++}`;
    placeholders.push({ token, html: match.trim() });
    return token;
  });
  return { text, placeholders };
}

/// Reverse of `extractHtmlTablesFromDoc`/`extractHtmlTablesFromMarkdown`:
/// walk `doc` and replace each placeholder paragraph with the `table` node
/// parsed from its recorded HTML.
export function restoreHtmlTablesInDoc(ctx: Ctx, doc: PMNode, placeholders: Placeholder[]): PMNode {
  if (placeholders.length === 0) return doc;
  const byToken = new Map(placeholders.map((p) => [p.token, p.html]));

  return mapDescendants(doc, (node) => {
    if (!node.isTextblock || node.childCount !== 1) return null;
    const text = node.firstChild?.text?.trim();
    if (!text) return null;
    const html = byToken.get(text);
    if (!html) return null;
    return htmlToTableNode(ctx, html) ?? null;
  });
}

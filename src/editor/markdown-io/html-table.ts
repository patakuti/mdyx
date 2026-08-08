import type { Ctx } from "@milkdown/ctx";
import { parserCtx, schemaCtx } from "@milkdown/core";
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
function needsHtmlBlock(table: PMNode): boolean {
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

function tableNodeToHtml(ctx: Ctx, table: PMNode): string {
  const schema = ctx.get(schemaCtx);
  const dom = DOMSerializer.fromSchema(schema).serializeNode(table);
  const container = document.createElement("div");
  container.appendChild(dom);
  return container.innerHTML;
}

function firstTableNode(ctx: Ctx, root: PMNode): PMNode | null {
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

export function htmlToTableNode(ctx: Ctx, html: string): PMNode | null {
  const schema = ctx.get(schemaCtx);
  const container = document.createElement("div");
  container.innerHTML = html;
  const doc = ProseDOMParser.fromSchema(schema).parse(container);
  return firstTableNode(ctx, doc);
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

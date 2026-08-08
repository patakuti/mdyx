import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx, serializerCtx } from "@milkdown/core";
import type { Node as PMNode } from "@milkdown/prose/model";

import { extractHtmlTablesFromDoc } from "./html-table";

/// Serializes an arbitrary doc (not necessarily the live view's current
/// `state.doc` — see `getMarkdownWithHtmlTables` below) with the same
/// merged-cell-as-raw-HTML handling. Used by `TabManager` (tabs/tab-
/// manager.ts, Phase 9) to save a background (non-active) tab, whose doc
/// lives only in its own stored `EditorState`, never having been the live
/// view's state.
export function serializeDocWithHtmlTables(ctx: Ctx, doc: PMNode): string {
  const serializer = ctx.get(serializerCtx);
  const { doc: substituted, placeholders } = extractHtmlTablesFromDoc(ctx, doc);
  let markdown = serializer(substituted);
  for (const { token, html } of placeholders) {
    markdown = markdown.split(token).join(`\n\n${html}\n\n`);
  }
  return markdown;
}

/// Drop-in replacement for `@milkdown/utils`'s `getMarkdown()` action that
/// additionally serializes tables with merged cells as raw HTML blocks
/// instead of (lossy) pipe syntax. See html-table.ts and 02_design.md 4.3節.
export function getMarkdownWithHtmlTables(ctx: Ctx): string {
  const view = ctx.get(editorViewCtx);
  return serializeDocWithHtmlTables(ctx, view.state.doc);
}

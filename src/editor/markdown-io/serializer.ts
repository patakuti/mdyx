import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx, serializerCtx } from "@milkdown/core";

import { extractHtmlTablesFromDoc } from "./html-table";

/// Drop-in replacement for `@milkdown/utils`'s `getMarkdown()` action that
/// additionally serializes tables with merged cells as raw HTML blocks
/// instead of (lossy) pipe syntax. See html-table.ts and 02_design.md 4.3節.
export function getMarkdownWithHtmlTables(ctx: Ctx): string {
  const view = ctx.get(editorViewCtx);
  const serializer = ctx.get(serializerCtx);

  const { doc, placeholders } = extractHtmlTablesFromDoc(ctx, view.state.doc);
  let markdown = serializer(doc);
  for (const { token, html } of placeholders) {
    markdown = markdown.split(token).join(`\n\n${html}\n\n`);
  }
  return markdown;
}

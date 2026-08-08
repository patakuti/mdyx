import type { Ctx } from "@milkdown/ctx";
import {
  editorStateOptionsCtx,
  editorViewCtx,
  parserCtx,
  prosePluginsCtx,
  schemaCtx,
} from "@milkdown/core";
import { Slice } from "@milkdown/prose/model";
import { EditorState } from "@milkdown/prose/state";

import { extractHtmlTablesFromMarkdown, restoreHtmlTablesInDoc } from "./html-table";

/// Drop-in replacement for `@milkdown/utils`'s `replaceAll()` action that
/// additionally restores raw HTML `<table>` blocks (written by
/// `getMarkdownWithHtmlTables`, or handwritten by another tool) as real,
/// editable `table` nodes instead of Milkdown's default inert raw-HTML atom.
/// See html-table.ts and 02_design.md 4.3節.
export function replaceAllWithHtmlTables(markdown: string, flush = false) {
  return (ctx: Ctx): void => {
    const view = ctx.get(editorViewCtx);
    const parser = ctx.get(parserCtx);

    const { text, placeholders } = extractHtmlTablesFromMarkdown(markdown);
    const parsed = parser(text);
    if (!parsed) return;
    const doc = restoreHtmlTablesInDoc(ctx, parsed, placeholders);

    if (!flush) {
      const { state } = view;
      view.dispatch(
        state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0))
      );
      return;
    }

    const schema = ctx.get(schemaCtx);
    const overrideOptions = ctx.get(editorStateOptionsCtx);
    const plugins = ctx.get(prosePluginsCtx);
    const newOptions = overrideOptions({ schema, doc, plugins });

    view.updateState(EditorState.create(newOptions));
  };
}

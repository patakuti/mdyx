import type { Ctx } from "@milkdown/ctx";
import {
  editorStateOptionsCtx,
  editorViewCtx,
  parserCtx,
  prosePluginsCtx,
  schemaCtx,
} from "@milkdown/core";
import { Slice } from "@milkdown/prose/model";
import type { Node as PMNode } from "@milkdown/prose/model";
import { EditorState } from "@milkdown/prose/state";

import { extractHtmlTablesFromMarkdown, restoreHtmlTablesInDoc } from "./html-table";

function parseMarkdownDoc(ctx: Ctx, markdown: string): PMNode | null {
  const parser = ctx.get(parserCtx);
  const { text, placeholders } = extractHtmlTablesFromMarkdown(markdown);
  const parsed = parser(text);
  if (!parsed) return null;
  return restoreHtmlTablesInDoc(ctx, parsed, placeholders);
}

/// Builds a standalone `EditorState` from `markdown`, reusing the live
/// editor's current schema/plugins (via `editorStateOptionsCtx`). Used by
/// `replaceAllWithHtmlTables`'s `flush` path below, and by `TabManager`
/// (tabs/tab-manager.ts, Phase 9) to build a tab's initial state without
/// touching the shared `EditorView` (New Tab, Open into a fresh tab, session
/// restore all build a state first and only swap it into the view once it
/// becomes the active tab).
export function buildEditorStateFromMarkdown(ctx: Ctx, markdown: string): EditorState | null {
  const doc = parseMarkdownDoc(ctx, markdown);
  if (!doc) return null;
  const schema = ctx.get(schemaCtx);
  const overrideOptions = ctx.get(editorStateOptionsCtx);
  const plugins = ctx.get(prosePluginsCtx);
  return EditorState.create(overrideOptions({ schema, doc, plugins }));
}

/// Drop-in replacement for `@milkdown/utils`'s `replaceAll()` action that
/// additionally restores raw HTML `<table>` blocks (written by
/// `getMarkdownWithHtmlTables`, or handwritten by another tool) as real,
/// editable `table` nodes instead of Milkdown's default inert raw-HTML atom.
/// See html-table.ts and 02_design.md 4.3節.
export function replaceAllWithHtmlTables(markdown: string, flush = false) {
  return (ctx: Ctx): void => {
    const view = ctx.get(editorViewCtx);

    if (flush) {
      const state = buildEditorStateFromMarkdown(ctx, markdown);
      if (state) view.updateState(state);
      return;
    }

    const doc = parseMarkdownDoc(ctx, markdown);
    if (!doc) return;
    const { state } = view;
    view.dispatch(
      state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0))
    );
  };
}

import { invoke } from "@tauri-apps/api/core";
import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/core";
import { NodeSelection, Plugin } from "@milkdown/prose/state";

import { plantumlSchema, insertPlantumlNode, PLANTUML_SOURCE_PATTERN } from "../editor/nodes/plantuml";
import { prosePrepend } from "./prose-prepend";

function isPlantumlNodeSelected(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx);
  const { selection } = view.state;
  return selection instanceof NodeSelection && selection.node.type === plantumlSchema.type(ctx);
}

/// Overrides copy when a `plantuml` node is selected: writes its source text
/// (01_requirements.md 5.5節, for round-tripping with an external PlantUML
/// editor such as blockly-plantuml-editor), mirroring
/// image-clipboard-plugin.ts's copy override for images.
///
/// Paste auto-detects a PlantUML source regardless of what's selected (any
/// pasted text that's fully an `@startuml`〜`@enduml` block is treated as
/// PlantUML) via ProseMirror's `handlePaste` prop — this was the original
/// model for Phase 11's table/image auto-detect paste too
/// (`table-clipboard-plugin.ts`/`image-clipboard-plugin.ts`, 02_design.md
/// 14.1節/14.2節).
///
/// This is NOT the same as reading `event.clipboardData` from a plain DOM
/// `paste` listener — 02_design.md 4.2節 already found that unreliable in
/// WebKitGTK when read from an ancestor's capture-phase listener.
/// `handlePaste` is invoked synchronously by ProseMirror's own internal
/// paste handling, directly from its `view.dom` paste listener (not a
/// separately-registered ancestor listener) — the same mechanism
/// `@milkdown/plugin-clipboard`'s own `handlePaste` already relies on
/// successfully for every other paste.
export const plantumlClipboardPlugin = prosePrepend((ctx) => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        copy: (_view, event) => {
          if (!isPlantumlNodeSelected(ctx)) return false;
          event.preventDefault();
          const view = ctx.get(editorViewCtx);
          const { selection } = view.state;
          if (selection instanceof NodeSelection) {
            void invoke("write_clipboard_text", { text: selection.node.attrs.source as string });
          }
          return true;
        },
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        const trimmed = text?.trim();
        if (!trimmed || !PLANTUML_SOURCE_PATTERN.test(trimmed)) return false;

        const { selection } = view.state;
        if (selection instanceof NodeSelection && selection.node.type === plantumlSchema.type(ctx)) {
          view.dispatch(view.state.tr.setNodeAttribute(selection.from, "source", trimmed));
        } else {
          insertPlantumlNode(view, trimmed);
        }
        return true;
      },
    },
  });
});

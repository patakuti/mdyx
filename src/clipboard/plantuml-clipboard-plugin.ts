import { invoke } from "@tauri-apps/api/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/ctx";
import { editorViewCtx, prosePluginsCtx, SchemaReady } from "@milkdown/core";
import { NodeSelection, Plugin } from "@milkdown/prose/state";
import type { Plugin as ProseMirrorPlugin } from "@milkdown/prose/state";

import { plantumlSchema, insertPlantumlNode, PLANTUML_SOURCE_PATTERN } from "../editor/nodes/plantuml";

function isPlantumlNodeSelected(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx);
  const { selection } = view.state;
  return selection instanceof NodeSelection && selection.node.type === plantumlSchema.type(ctx);
}

/// Like `@milkdown/utils`'s `$prose`, but prepends the plugin instead of
/// appending it. `view.someProp("handlePaste", ...)` (prosemirror-view's
/// paste handling) stops at the first plugin whose `handlePaste` returns
/// `true`, in `state.plugins` order — and Crepe's built-in
/// `@milkdown/plugin-clipboard` (which unconditionally turns any plain-text
/// paste into inserted text) is already registered by the time `.use()`
/// plugins in setup.ts run, so appending via `$prose` here would leave our
/// `handlePaste` unreachable. Confirmed empirically in a browser test:
/// dumping `view.state.plugins` showed Milkdown's clipboard plugin at index
/// 8 of 29 with a `$prose`-appended version of this plugin trailing at index
/// 24, and its `handlePaste` was never invoked. Prepending instead puts ours
/// first.
function $prosePrepend(prose: (ctx: Ctx) => ProseMirrorPlugin): MilkdownPlugin {
  return (ctx) => async () => {
    await ctx.wait(SchemaReady);
    const prosePlugin = prose(ctx);
    ctx.update(prosePluginsCtx, (ps) => [prosePlugin, ...ps]);
    return () => {
      ctx.update(prosePluginsCtx, (ps) => ps.filter((x) => x !== prosePlugin));
    };
  };
}

/// Overrides copy when a `plantuml` node is selected: writes its source text
/// (01_requirements.md 5.5節, for round-tripping with an external PlantUML
/// editor such as blockly-plantuml-editor), mirroring
/// image-clipboard-plugin.ts's copy override for images.
///
/// Paste auto-detects a PlantUML source (01_requirements.md 5.1節: unlike
/// images/tables, this doesn't require a specific node to be selected first
/// — any pasted text that's fully an `@startuml`〜`@enduml` block is treated
/// as PlantUML) via ProseMirror's `handlePaste` prop.
///
/// This is NOT the same as reading `event.clipboardData` from a plain DOM
/// `paste` listener — 02_design.md 4.2節 already found that unreliable in
/// WebKitGTK when read from an ancestor's capture-phase listener.
/// `handlePaste` is invoked synchronously by ProseMirror's own internal
/// paste handling, directly from its `view.dom` paste listener (not a
/// separately-registered ancestor listener) — the same mechanism
/// `@milkdown/plugin-clipboard`'s own `handlePaste` already relies on
/// successfully for every other paste.
export const plantumlClipboardPlugin = $prosePrepend((ctx) => {
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

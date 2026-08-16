import { invoke } from "@tauri-apps/api/core";
import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/core";
import { NodeSelection, Plugin } from "@milkdown/prose/state";

import { mermaidSchema, insertMermaidNode, extractMermaidSource } from "../editor/nodes/mermaid";
import { prosePrepend } from "./prose-prepend";
import { showCopiedToast } from "../ui/toast";

function isMermaidNodeSelected(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx);
  const { selection } = view.state;
  return selection instanceof NodeSelection && selection.node.type === mermaidSchema.type(ctx);
}

/// Overrides copy when a `mermaid` node is selected: writes its source text
/// wrapped in a ` ```mermaid ` fence (01_requirements.md 5.6節, for
/// round-tripping with external tools such as Mermaid Live Editor, and so a
/// copy can be pasted straight back into this app). **Unlike
/// plantuml-clipboard-plugin.ts's bare-source copy**, this always fences the
/// output — required for the paste side below, which (unlike PlantUML's
/// self-delimiting `@startuml`/`@enduml`) only recognizes fenced text as
/// Mermaid source (02_design.md 19章・4.7節).
///
/// Paste auto-detects a fenced Mermaid source regardless of what's selected,
/// via ProseMirror's `handlePaste` prop registered through `prosePrepend` —
/// same mechanism established for PlantUML (plantuml-clipboard-plugin.ts,
/// 02_design.md 6章) to win against Milkdown's own built-in clipboard
/// plugin, which otherwise claims `handlePaste` first.
export const mermaidClipboardPlugin = prosePrepend((ctx) => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        copy: (_view, event) => {
          if (!isMermaidNodeSelected(ctx)) return false;
          event.preventDefault();
          const view = ctx.get(editorViewCtx);
          const { selection } = view.state;
          if (selection instanceof NodeSelection) {
            const source = selection.node.attrs.source as string;
            void invoke("write_clipboard_text", { text: "```mermaid\n" + source + "\n```" });
            showCopiedToast("Mermaid source", source);
          }
          return true;
        },
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        const source = text ? extractMermaidSource(text) : null;
        if (!source) return false;

        const { selection } = view.state;
        if (selection instanceof NodeSelection && selection.node.type === mermaidSchema.type(ctx)) {
          view.dispatch(view.state.tr.setNodeAttribute(selection.from, "source", source));
        } else {
          insertMermaidNode(view, source);
        }
        return true;
      },
    },
  });
});

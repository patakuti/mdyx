import type { Crepe } from "@milkdown/crepe";
import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/core";
import { callCommand } from "@milkdown/utils";
import { lift, setBlockType } from "@milkdown/prose/commands";
import type { EditorState } from "@milkdown/prose/state";
import type { NodeType } from "@milkdown/prose/model";
import { undoCommand, redoCommand } from "@milkdown/plugin-history";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  liftListItemCommand,
  insertHrCommand,
  headingSchema,
  bulletListSchema,
  orderedListSchema,
  blockquoteSchema,
  codeBlockSchema,
  paragraphSchema,
} from "@milkdown/preset-commonmark";
import {
  toggleStrikethroughCommand,
  insertTableCommand,
} from "@milkdown/preset-gfm";

// wrapInHeadingCommand/wrapInXxxListCommand/wrapInBlockquoteCommand only ever
// apply the given block type; they don't undo it when it's already applied
// (unlike the mark toggle commands below, which do toggle on/off). The
// helpers here add that missing "click again to revert" behavior.

function isInNodeType(state: EditorState, nodeType: NodeType): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === nodeType) return true;
  }
  return false;
}

function toggleHeading(ctx: Ctx, level: number): void {
  const view = ctx.get(editorViewCtx);
  const node = view.state.selection.$from.parent;
  const isSameLevel =
    node.type === headingSchema.type(ctx) && node.attrs.level === level;
  callCommand(wrapInHeadingCommand.key, isSameLevel ? 0 : level)(ctx);
}

function toggleList(ctx: Ctx, listType: NodeType, wrapKey: typeof wrapInBulletListCommand.key): void {
  const view = ctx.get(editorViewCtx);
  if (isInNodeType(view.state, listType)) {
    callCommand(liftListItemCommand.key)(ctx);
    return;
  }
  callCommand(wrapKey)(ctx);
}

function toggleBlockquote(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  if (isInNodeType(view.state, blockquoteSchema.type(ctx))) {
    const { state, dispatch } = view;
    lift(state, dispatch);
    return;
  }
  callCommand(wrapInBlockquoteCommand.key)(ctx);
}

function toggleCodeBlock(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const { state, dispatch } = view;
  const node = state.selection.$from.parent;
  if (node.type === codeBlockSchema.type(ctx)) {
    setBlockType(paragraphSchema.type(ctx))(state, dispatch);
    return;
  }
  setBlockType(codeBlockSchema.type(ctx), { language: "" })(state, dispatch);
}

interface ToolbarButton {
  label: string;
  title: string;
  className?: string;
  action: (crepe: Crepe) => void;
}

const BUTTON_GROUPS: ToolbarButton[][] = [
  [
    { label: "↶", title: "Undo", action: (c) => c.editor.action(callCommand(undoCommand.key)) },
    { label: "↷", title: "Redo", action: (c) => c.editor.action(callCommand(redoCommand.key)) },
  ],
  [
    { label: "B", title: "Bold", className: "tb-bold", action: (c) => c.editor.action(callCommand(toggleStrongCommand.key)) },
    { label: "I", title: "Italic", className: "tb-italic", action: (c) => c.editor.action(callCommand(toggleEmphasisCommand.key)) },
    { label: "S", title: "Strikethrough", className: "tb-strike", action: (c) => c.editor.action(callCommand(toggleStrikethroughCommand.key)) },
    { label: "</>", title: "Inline Code", className: "tb-mono", action: (c) => c.editor.action(callCommand(toggleInlineCodeCommand.key)) },
  ],
  [
    { label: "H1", title: "Heading 1", action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 1)) },
    { label: "H2", title: "Heading 2", action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 2)) },
    { label: "H3", title: "Heading 3", action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 3)) },
  ],
  [
    { label: "•", title: "Bullet List", action: (c) => c.editor.action((ctx) => toggleList(ctx, bulletListSchema.type(ctx), wrapInBulletListCommand.key)) },
    { label: "1.", title: "Ordered List", action: (c) => c.editor.action((ctx) => toggleList(ctx, orderedListSchema.type(ctx), wrapInOrderedListCommand.key)) },
    { label: "”", title: "Blockquote", action: (c) => c.editor.action(toggleBlockquote) },
    { label: "{}", title: "Code Block", className: "tb-mono", action: (c) => c.editor.action(toggleCodeBlock) },
  ],
  [
    { label: "―", title: "Horizontal Rule", action: (c) => c.editor.action(callCommand(insertHrCommand.key)) },
    { label: "⊞", title: "Insert Table", action: (c) => c.editor.action(callCommand(insertTableCommand.key, { row: 2, col: 2 })) },
  ],
];

export function setupToolbar(container: HTMLElement, crepe: Crepe): void {
  BUTTON_GROUPS.forEach((group, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "toolbar-separator";
      container.appendChild(separator);
    }
    for (const button of group) {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = button.label;
      el.title = button.title;
      el.className = ["toolbar-button", button.className].filter(Boolean).join(" ");
      // Prevent the editor from losing focus/selection before the click fires.
      el.addEventListener("mousedown", (event) => event.preventDefault());
      el.addEventListener("click", () => button.action(crepe));
      container.appendChild(el);
    }
  });
}

export function runInsertTable(crepe: Crepe): void {
  crepe.editor.action(callCommand(insertTableCommand.key, { row: 2, col: 2 }));
}

export function runUndo(crepe: Crepe): void {
  crepe.editor.action(callCommand(undoCommand.key));
}

export function runRedo(crepe: Crepe): void {
  crepe.editor.action(callCommand(redoCommand.key));
}

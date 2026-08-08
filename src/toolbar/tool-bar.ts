import type { Crepe } from "@milkdown/crepe";
import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/core";
import { callCommand } from "@milkdown/utils";
import { lift, setBlockType } from "@milkdown/prose/commands";
import type { EditorState } from "@milkdown/prose/state";
import type { NodeType } from "@milkdown/prose/model";
import { mathInlineSchema, insertMathNode } from "../editor/nodes/math";
import { insertPlantumlNodeFromClipboard } from "../editor/nodes/plantuml";
import { insertTableFromClipboard } from "../clipboard/table-insert";
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
import { toggleStrikethroughCommand } from "@milkdown/preset-gfm";
import { mergeCells, splitCellWithType, findTable } from "@milkdown/prose/tables";

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

function mergeSelectedCells(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  mergeCells(view.state, view.dispatch);
}

// `splitCell` (prosemirror-tables' plain export) always gives new cells the
// same node type as the cell being split. Milkdown's GFM table schema has
// two distinct row types (`table_header_row` only accepts `table_header`,
// `table_row` only accepts `table_cell`), so splitting a header cell with
// rowspan > 1 makes it try to insert a `table_header` into a `table_row` —
// which doesn't fit that row's content expression, so the insert escapes
// the table entirely and drags along whatever followed it (measured/
// reproduced from a user bug report: splitting a 2-row header cell dropped
// the sibling row's other cell into a second, malformed table). Using
// `splitCellWithType` with a type picker based on each target row's actual
// type avoids the mismatch.
function splitSelectedCell(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const { state, dispatch } = view;
  const table = findTable(state.selection.$from);
  if (!table) return;

  splitCellWithType(({ row }) => {
    const rowNode = table.node.child(row);
    return rowNode.type.name === "table_header_row"
      ? state.schema.nodes.table_header!
      : state.schema.nodes.table_cell!;
  })(state, dispatch);
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

// Shortcut keys use `event.code` (the physical key), not `event.key`, so
// e.g. Ctrl+Shift+8 (Bullet List) matches regardless of what character
// Shift+8 produces on the active keyboard layout (on a US layout
// `event.key` would be "*", not "8", once Shift is held).
interface ToolbarShortcut {
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

interface ToolbarButton {
  label: string;
  title: string;
  className?: string;
  action: (crepe: Crepe) => void;
  shortcut?: ToolbarShortcut;
}

// 01_requirements.md 3.2節: shortcuts that exist in real LyX use LyX's own
// binding; everything else (LyX has no direct equivalent — headings/lists/
// quote/code block/table/etc. are all done via LyX's Environment/layout
// system instead of per-element toggles) uses a common Markdown/word
// processor convention. Insert Table/Image/PlantUML aren't listed here even
// though they're in that table: they're native menu items, so their
// accelerators are set directly in `lib.rs` instead (02_design.md 8章).
const BUTTON_GROUPS: ToolbarButton[][] = [
  [
    { label: "↶", title: "Undo", action: (c) => c.editor.action(callCommand(undoCommand.key)) },
    { label: "↷", title: "Redo", action: (c) => c.editor.action(callCommand(redoCommand.key)) },
  ],
  [
    {
      label: "B",
      title: "Bold (Ctrl+B)",
      className: "tb-bold",
      action: (c) => c.editor.action(callCommand(toggleStrongCommand.key)),
      shortcut: { code: "KeyB", ctrl: true },
    },
    {
      label: "I",
      title: "Italic (Ctrl+E)",
      className: "tb-italic",
      action: (c) => c.editor.action(callCommand(toggleEmphasisCommand.key)),
      shortcut: { code: "KeyE", ctrl: true },
    },
    {
      label: "S",
      title: "Strikethrough (Ctrl+Shift+X)",
      className: "tb-strike",
      action: (c) => c.editor.action(callCommand(toggleStrikethroughCommand.key)),
      shortcut: { code: "KeyX", ctrl: true, shift: true },
    },
    {
      label: "</>",
      title: "Inline Code (Ctrl+Alt+M)",
      className: "tb-mono",
      action: (c) => c.editor.action(callCommand(toggleInlineCodeCommand.key)),
      shortcut: { code: "KeyM", ctrl: true, alt: true },
    },
  ],
  [
    {
      label: "H1",
      title: "Heading 1 (Ctrl+Alt+1)",
      action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 1)),
      shortcut: { code: "Digit1", ctrl: true, alt: true },
    },
    {
      label: "H2",
      title: "Heading 2 (Ctrl+Alt+2)",
      action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 2)),
      shortcut: { code: "Digit2", ctrl: true, alt: true },
    },
    {
      label: "H3",
      title: "Heading 3 (Ctrl+Alt+3)",
      action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 3)),
      shortcut: { code: "Digit3", ctrl: true, alt: true },
    },
  ],
  [
    {
      label: "•",
      title: "Bullet List (Ctrl+Shift+8)",
      action: (c) => c.editor.action((ctx) => toggleList(ctx, bulletListSchema.type(ctx), wrapInBulletListCommand.key)),
      shortcut: { code: "Digit8", ctrl: true, shift: true },
    },
    {
      label: "1.",
      title: "Ordered List (Ctrl+Shift+7)",
      action: (c) => c.editor.action((ctx) => toggleList(ctx, orderedListSchema.type(ctx), wrapInOrderedListCommand.key)),
      shortcut: { code: "Digit7", ctrl: true, shift: true },
    },
    {
      label: "”",
      title: "Blockquote (Ctrl+Shift+9)",
      action: (c) => c.editor.action(toggleBlockquote),
      shortcut: { code: "Digit9", ctrl: true, shift: true },
    },
    {
      label: "{}",
      title: "Code Block (Ctrl+Alt+C)",
      className: "tb-mono",
      action: (c) => c.editor.action(toggleCodeBlock),
      shortcut: { code: "KeyC", ctrl: true, alt: true },
    },
  ],
  [
    {
      label: "―",
      title: "Horizontal Rule (Ctrl+Alt+H)",
      action: (c) => c.editor.action(callCommand(insertHrCommand.key)),
      shortcut: { code: "KeyH", ctrl: true, alt: true },
    },
    { label: "⊞", title: "Insert Table (Ctrl+Alt+T)", action: (c) => runInsertTable(c) },
    { label: "⊔", title: "Merge Cells", action: (c) => c.editor.action(mergeSelectedCells) },
    { label: "⊓", title: "Split Cell", action: (c) => c.editor.action(splitSelectedCell) },
  ],
  [
    {
      label: "∑",
      title: "Insert Math (Ctrl+M)",
      action: (c) => c.editor.action((ctx) => insertMathNode(ctx.get(editorViewCtx), mathInlineSchema.type(ctx))),
      shortcut: { code: "KeyM", ctrl: true },
    },
    {
      label: "PU",
      title: "Insert PlantUML (Ctrl+Alt+U)",
      className: "tb-mono",
      action: (c) => c.editor.action((ctx) => void insertPlantumlNodeFromClipboard(ctx.get(editorViewCtx))),
    },
  ],
];

function matchesShortcut(event: KeyboardEvent, shortcut: ToolbarShortcut): boolean {
  return (
    event.code === shortcut.code &&
    (event.ctrlKey || event.metaKey) === Boolean(shortcut.ctrl) &&
    event.shiftKey === Boolean(shortcut.shift) &&
    event.altKey === Boolean(shortcut.alt)
  );
}

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

  window.addEventListener("keydown", (event) => {
    for (const group of BUTTON_GROUPS) {
      for (const button of group) {
        if (!button.shortcut || !matchesShortcut(event, button.shortcut)) continue;
        event.preventDefault();
        button.action(crepe);
        return;
      }
    }
  });
}

export function runInsertTable(crepe: Crepe): void {
  crepe.editor.action((ctx) => void insertTableFromClipboard(ctx));
}

export function runUndo(crepe: Crepe): void {
  crepe.editor.action(callCommand(undoCommand.key));
}

export function runRedo(crepe: Crepe): void {
  crepe.editor.action(callCommand(redoCommand.key));
}

import type { Crepe } from "@milkdown/crepe";
import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/core";
import { callCommand } from "@milkdown/utils";
import { lift, setBlockType } from "@milkdown/prose/commands";
import { AllSelection, type EditorState } from "@milkdown/prose/state";
import type { MarkType, NodeType } from "@milkdown/prose/model";
import { mathInlineSchema, insertMathNode } from "../editor/nodes/math";
import { insertPlantumlNodeFromClipboard } from "../editor/nodes/plantuml";
import { insertMermaidNodeFromClipboard } from "../editor/nodes/mermaid";
import { insertTableFromClipboard } from "../clipboard/table-insert";
import { showInsertLinkDialog } from "../editor/insert-link-dialog";
import type { ActiveFilePathGetter } from "../clipboard/image-paste";
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
  strongSchema,
  emphasisSchema,
  inlineCodeSchema,
} from "@milkdown/preset-commonmark";
import { toggleStrikethroughCommand, strikethroughSchema } from "@milkdown/preset-gfm";
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

// Same definition prosemirror-commands' `toggleMark` itself uses to decide
// whether clicking would add or remove the mark (`rangeHasMark`, confirmed
// by reading its source: default `removeWhenPresent` means "present
// anywhere in the selection" removes for the whole selection) — so "active"
// here always means the same thing as "clicking now will turn this off"
// (01_requirements.md 3.6節, 02_design.md 13.1節).
function markActive(state: EditorState, markType: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!markType.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, markType);
}

function isHeadingLevel(ctx: Ctx, level: number): boolean {
  const node = ctx.get(editorViewCtx).state.selection.$from.parent;
  return node.type === headingSchema.type(ctx) && node.attrs.level === level;
}

function toggleHeading(ctx: Ctx, level: number): void {
  callCommand(wrapInHeadingCommand.key, isHeadingLevel(ctx, level) ? 0 : level)(ctx);
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

function isCodeBlockActive(ctx: Ctx): boolean {
  return ctx.get(editorViewCtx).state.selection.$from.parent.type === codeBlockSchema.type(ctx);
}

function toggleCodeBlock(ctx: Ctx): void {
  const { state, dispatch } = ctx.get(editorViewCtx);
  if (isCodeBlockActive(ctx)) {
    setBlockType(paragraphSchema.type(ctx))(state, dispatch);
    return;
  }
  setBlockType(codeBlockSchema.type(ctx), { language: "" })(state, dispatch);
}

// Shortcut keys use `event.code` (the physical key), not `event.key`, so
// e.g. Ctrl+Shift+8 (Bullet List) matches regardless of what character
// Shift+8 produces on the active keyboard layout (on a US layout
// `event.key` would be "*", not "8", once Shift is held).
export interface ToolbarShortcut {
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

interface ToolbarButton {
  label: string;
  title: string;
  className?: string;
  action: (crepe: Crepe, getActiveFilePath: ActiveFilePathGetter) => void;
  shortcut?: ToolbarShortcut;
  /// Whether the current cursor/selection is "inside" this button's format
  /// (01_requirements.md 3.6節). Omitted for one-shot actions (Undo, Insert
  /// Table, ...) that have no such state.
  isActive?: (ctx: Ctx) => boolean;
}

// 01_requirements.md 3.2節: shortcuts that exist in real LyX use LyX's own
// binding; everything else (LyX has no direct equivalent — headings/lists/
// quote/code block/table/etc. are all done via LyX's Environment/layout
// system instead of per-element toggles) uses a common Markdown/word
// processor convention. Insert Table/PlantUML/Mermaid have their `shortcut`
// set here (not just a native menu accelerator in `lib.rs`) because the
// native accelerator alone doesn't work on Windows/WebView2
// (01_requirements.md 3.17節, 02_design.md 27章).
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
      isActive: (ctx) => markActive(ctx.get(editorViewCtx).state, strongSchema.type(ctx)),
    },
    {
      label: "I",
      title: "Italic (Ctrl+E)",
      className: "tb-italic",
      action: (c) => c.editor.action(callCommand(toggleEmphasisCommand.key)),
      shortcut: { code: "KeyE", ctrl: true },
      isActive: (ctx) => markActive(ctx.get(editorViewCtx).state, emphasisSchema.type(ctx)),
    },
    {
      label: "S",
      title: "Strikethrough (Ctrl+Shift+X)",
      className: "tb-strike",
      action: (c) => c.editor.action(callCommand(toggleStrikethroughCommand.key)),
      shortcut: { code: "KeyX", ctrl: true, shift: true },
      isActive: (ctx) => markActive(ctx.get(editorViewCtx).state, strikethroughSchema.type(ctx)),
    },
    {
      label: "</>",
      title: "Inline Code (Ctrl+Alt+M)",
      className: "tb-mono",
      action: (c) => c.editor.action(callCommand(toggleInlineCodeCommand.key)),
      shortcut: { code: "KeyM", ctrl: true, alt: true },
      isActive: (ctx) => markActive(ctx.get(editorViewCtx).state, inlineCodeSchema.type(ctx)),
    },
  ],
  [
    {
      label: "H1",
      title: "Heading 1 (Ctrl+Alt+1)",
      action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 1)),
      shortcut: { code: "Digit1", ctrl: true, alt: true },
      isActive: (ctx) => isHeadingLevel(ctx, 1),
    },
    {
      label: "H2",
      title: "Heading 2 (Ctrl+Alt+2)",
      action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 2)),
      shortcut: { code: "Digit2", ctrl: true, alt: true },
      isActive: (ctx) => isHeadingLevel(ctx, 2),
    },
    {
      label: "H3",
      title: "Heading 3 (Ctrl+Alt+3)",
      action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 3)),
      shortcut: { code: "Digit3", ctrl: true, alt: true },
      isActive: (ctx) => isHeadingLevel(ctx, 3),
    },
    {
      label: "H4",
      title: "Heading 4 (Ctrl+Alt+4)",
      action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 4)),
      shortcut: { code: "Digit4", ctrl: true, alt: true },
      isActive: (ctx) => isHeadingLevel(ctx, 4),
    },
    {
      label: "H5",
      title: "Heading 5 (Ctrl+Alt+5)",
      action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 5)),
      shortcut: { code: "Digit5", ctrl: true, alt: true },
      isActive: (ctx) => isHeadingLevel(ctx, 5),
    },
    {
      label: "H6",
      title: "Heading 6 (Ctrl+Alt+6)",
      action: (c) => c.editor.action((ctx) => toggleHeading(ctx, 6)),
      shortcut: { code: "Digit6", ctrl: true, alt: true },
      isActive: (ctx) => isHeadingLevel(ctx, 6),
    },
  ],
  [
    {
      label: "•",
      title: "Bullet List (Ctrl+Shift+8)",
      action: (c) => c.editor.action((ctx) => toggleList(ctx, bulletListSchema.type(ctx), wrapInBulletListCommand.key)),
      shortcut: { code: "Digit8", ctrl: true, shift: true },
      isActive: (ctx) => isInNodeType(ctx.get(editorViewCtx).state, bulletListSchema.type(ctx)),
    },
    {
      label: "1.",
      title: "Ordered List (Ctrl+Shift+7)",
      action: (c) => c.editor.action((ctx) => toggleList(ctx, orderedListSchema.type(ctx), wrapInOrderedListCommand.key)),
      shortcut: { code: "Digit7", ctrl: true, shift: true },
      isActive: (ctx) => isInNodeType(ctx.get(editorViewCtx).state, orderedListSchema.type(ctx)),
    },
    {
      label: "”",
      title: "Blockquote (Ctrl+Shift+9)",
      action: (c) => c.editor.action(toggleBlockquote),
      shortcut: { code: "Digit9", ctrl: true, shift: true },
      isActive: (ctx) => isInNodeType(ctx.get(editorViewCtx).state, blockquoteSchema.type(ctx)),
    },
    {
      label: "{}",
      title: "Code Block (Ctrl+Alt+C)",
      className: "tb-mono",
      action: (c) => c.editor.action(toggleCodeBlock),
      shortcut: { code: "KeyC", ctrl: true, alt: true },
      isActive: isCodeBlockActive,
    },
  ],
  [
    {
      label: "―",
      title: "Horizontal Rule (Ctrl+Alt+H)",
      action: (c) => c.editor.action(callCommand(insertHrCommand.key)),
      shortcut: { code: "KeyH", ctrl: true, alt: true },
    },
    {
      label: "⊞",
      title: "Insert Table (Ctrl+Alt+T)",
      action: (c) => runInsertTable(c),
      shortcut: { code: "KeyT", ctrl: true, alt: true },
    },
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
      shortcut: { code: "KeyU", ctrl: true, alt: true },
    },
    {
      label: "ME",
      title: "Insert Mermaid (Ctrl+Alt+E)",
      className: "tb-mono",
      action: (c) => c.editor.action((ctx) => void insertMermaidNodeFromClipboard(ctx.get(editorViewCtx))),
      shortcut: { code: "KeyE", ctrl: true, alt: true },
    },
    {
      label: "Link",
      title: "Insert Link (Ctrl+K)",
      action: (c, getActiveFilePath) => c.editor.action((ctx) => showInsertLinkDialog(ctx, getActiveFilePath)),
      shortcut: { code: "KeyK", ctrl: true },
    },
  ],
];

export function matchesShortcut(event: KeyboardEvent, shortcut: ToolbarShortcut): boolean {
  return (
    event.code === shortcut.code &&
    (event.ctrlKey || event.metaKey) === Boolean(shortcut.ctrl) &&
    event.shiftKey === Boolean(shortcut.shift) &&
    event.altKey === Boolean(shortcut.alt)
  );
}

/// Called after every editor update (a real edit, a selection change, or a
/// tab switch — see `editor/setup.ts`'s `toolbarSyncPlugin`,
/// 02_design.md 13.2節) to refresh which toggle buttons look "pressed".
export type ToolbarActiveStateUpdater = () => void;

export function setupToolbar(
  container: HTMLElement,
  crepe: Crepe,
  getActiveFilePath: ActiveFilePathGetter
): ToolbarActiveStateUpdater {
  const toggleButtons: { el: HTMLButtonElement; isActive: (ctx: Ctx) => boolean }[] = [];

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
      el.addEventListener("click", () => button.action(crepe, getActiveFilePath));
      container.appendChild(el);
      if (button.isActive) toggleButtons.push({ el, isActive: button.isActive });
    }
  });

  window.addEventListener("keydown", (event) => {
    for (const group of BUTTON_GROUPS) {
      for (const button of group) {
        if (!button.shortcut || !matchesShortcut(event, button.shortcut)) continue;
        event.preventDefault();
        button.action(crepe, getActiveFilePath);
        return;
      }
    }
  });

  return () => {
    const ctx = crepe.editor.ctx;
    for (const { el, isActive } of toggleButtons) {
      el.classList.toggle("active", isActive(ctx));
    }
  };
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

/// Shared by the Edit menu's "Select All" item and the editor context
/// menu's (01_requirements.md 3.13節) — `Ctrl/Cmd+A` itself is left as the
/// browser's native contenteditable behavior rather than a native menu
/// accelerator, so this only needs to cover the click path.
export function runSelectAll(crepe: Crepe): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
    view.focus();
  });
}

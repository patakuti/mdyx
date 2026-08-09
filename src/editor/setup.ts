import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/core";
import { linkSchema } from "@milkdown/preset-commonmark";
import { tableCellSchema, tableHeaderSchema } from "@milkdown/preset-gfm";
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

import {
  createImageClipboardPlugin,
  createGeneralImagePastePlugin,
  setupImagePasteInterceptor,
} from "../clipboard/image-clipboard-plugin";
import { resolveImageDisplaySrc } from "../clipboard/image-paste";
import type { ActiveFilePathGetter } from "../clipboard/image-paste";
import { remarkMathPlugin, mathInlineSchema, mathBlockSchema } from "./nodes/math";
import { mathInlineView, mathBlockView } from "./nodes/math-view";
import { nonPlantumlCodeBlockSchema, plantumlSchema } from "./nodes/plantuml";
import { plantumlView } from "./nodes/plantuml-view";
import { plantumlClipboardPlugin } from "../clipboard/plantuml-clipboard-plugin";
import { tableClipboardPlugin } from "../clipboard/table-clipboard-plugin";

// Milkdown's built-in table cell schema allows exactly one paragraph per
// cell. `mergeCells` (prosemirror-tables, wired to the toolbar's Merge
// Cells button) concatenates the content of every merged cell into the
// surviving one, which produces two+ paragraphs when more than one merged
// cell had text — that no longer fits "exactly one paragraph", so
// ProseMirror's replace step closes the cell early and re-opens the extra
// paragraph(s) as siblings of the table itself, visibly splitting the table
// in two (measured/reproduced from a user bug report merging a 2-cell
// header row that both had text). Relaxing to "one or more" paragraphs via
// the documented `extendSchema` override keeps every merged cell's content
// instead of corrupting the document; see html-table.ts for the
// corresponding relaxation of what counts as a "needs HTML block" cell.
const relaxedTableCellSchema = tableCellSchema.extendSchema((factory) => (ctx) => ({
  ...factory(ctx),
  content: "paragraph+",
}));
const relaxedTableHeaderSchema = tableHeaderSchema.extendSchema((factory) => (ctx) => ({
  ...factory(ctx),
  content: "paragraph+",
}));

// The `link` mark is the one Milkdown mark schema where it's safe to
// override `inclusive: false` (the ProseMirror `MarkSpec` field controlling
// whether a cursor positioned right at the end of a marked run counts as
// "inside" it for purposes of what a freshly typed character inherits —
// `true` by default, and none of Milkdown's presets override it).
//
// Bold/Italic/Strikethrough/Inline Code deliberately keep the default
// (confirmed by testing the same override on them and reverting it, see
// 02_design.md 16.4節 for the full investigation): clicking one of those
// toolbar buttons with an empty selection, then typing several characters,
// relies on this exact `inclusive: true` default for every character after
// the first. `toggleMark` on an empty selection only sets
// `state.storedMarks` for the *next* transaction (`tr.addStoredMark`) —
// inserting that first character consumes it, since `Transaction.addStep`
// (called by any doc-changing step, confirmed by reading
// `prosemirror-state`'s `Transaction.addStep`) resets `storedMarks` to
// `null` afterward. Every character after the first is therefore governed
// by the *position-based* fallback in `Transaction.insertText`
// (`$from.marks()`), which only continues the mark if it's inclusive.
// Overriding `inclusive: false` for these marks reproduces exactly this
// symptom: only the first typed character came out marked (e.g. `**B**old
// text` instead of `**Bold text**`).
//
// Links don't have this "toggle then type multiple characters" flow at all
// in this app — a link is always applied to already-existing text (select
// it, use Crepe's floating-toolbar link icon) or built as a complete unit
// via Insert > Link's dialog (`insert-link-dialog.ts`, 02_design.md 16章),
// never composed character-by-character from an empty cursor. So
// `inclusive: false` has no such downside for `link`, while fixing the real
// bug it was added for: continuing to type right after a link (via a click,
// an arrow key, or — before this schema fix — right after Insert > Link's
// own cursor placement) no longer silently extends the link onto
// unconnected text (reported via real-machine testing: typing immediately
// after an inserted link picked up its `href`).
const nonInclusiveLinkSchema = linkSchema.extendSchema((factory) => (ctx) => ({
  ...factory(ctx),
  inclusive: false,
}));

// Notifies `onEditorUpdate` after every editor update — a real edit, a
// selection-only change (e.g. arrow keys), or a tab switch (`TabManager`
// calling `view.updateState(...)` directly, 02_design.md 12.1節) — so the
// toolbar can refresh which buttons look "pressed" (01_requirements.md
// 3.6節). A ProseMirror plugin `view` lifecycle is used rather than adding
// a bespoke notification hook to `TabManager`: `EditorView.updateState()`
// already calls every registered plugin's `view.update(...)` on both of the
// above paths (confirmed by reading prosemirror-view's source, 02_design.md
// 13.2節), so this needs no special-casing for tabs at all.
function createToolbarSyncPlugin(onEditorUpdate: (view: EditorView) => void) {
  return $prose(
    () =>
      new Plugin({
        view: (view) => {
          onEditorUpdate(view);
          return { update: (view) => onEditorUpdate(view) };
        },
      })
  );
}

// Tabs (Phase 9) mean image paths must resolve relative to whichever tab is
// currently active, not a single fixed document — see tabs/tab-manager.ts
// and image-paste.ts's `ActiveFilePathGetter`. `setupEditor` runs before the
// `TabManager` exists (it needs a `Crepe` instance to wrap), so the caller
// passes a getter closure instead of a plain value.
export async function setupEditor(
  root: HTMLElement,
  getActiveFilePath: ActiveFilePathGetter,
  onEditorUpdate: (view: EditorView) => void
): Promise<Crepe> {
  const crepe = new Crepe({
    root,
    // No placeholder document (Phase 9, 01_requirements.md 3.5節): the app
    // starts with 0 tabs, so this content is never actually shown — the
    // first tab created/opened/restored always replaces it immediately.
    defaultValue: "",
    features: {
      // Crepe's built-in Latex feature (KaTeX + CodeMirror source editing)
      // is on by default and would otherwise compete with our own
      // MathLive-based math_inline/math_block nodes for the same `$...$`/
      // `$$...$$` syntax (01_requirements.md 4章 chose MathLive for a
      // LyX-like visual editing experience instead).
      [Crepe.Feature.Latex]: false,
    },
    featureConfigs: {
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: (src: string) => resolveImageDisplaySrc(src, getActiveFilePath),
      },
    },
  });
  crepe.editor.use(createImageClipboardPlugin(getActiveFilePath));
  crepe.editor.use(createGeneralImagePastePlugin(getActiveFilePath));
  crepe.editor.use(tableClipboardPlugin);
  crepe.editor.use(relaxedTableCellSchema);
  crepe.editor.use(relaxedTableHeaderSchema);
  crepe.editor.use(nonInclusiveLinkSchema);
  crepe.editor.use(remarkMathPlugin);
  crepe.editor.use(mathInlineSchema);
  crepe.editor.use(mathBlockSchema);
  crepe.editor.use(mathInlineView);
  crepe.editor.use(mathBlockView);
  crepe.editor.use(nonPlantumlCodeBlockSchema);
  crepe.editor.use(plantumlSchema);
  crepe.editor.use(plantumlView);
  crepe.editor.use(plantumlClipboardPlugin);
  crepe.editor.use(createToolbarSyncPlugin(onEditorUpdate));

  await crepe.create();
  setupImagePasteInterceptor(root, crepe, getActiveFilePath);

  // `view.dom` is ProseMirror's own editable element (Milkdown/Crepe's
  // `.ProseMirror`), whose direct children are exactly the same top-level
  // doc nodes `DOMSerializer.serializeFragment` produces for Export
  // (html-export.ts) — tagging it with the class the theme CSS's selectors
  // are written against (theme/theme-style.ts, 01_requirements.md 10.3節)
  // is what makes the live editor and the exported HTML share one theme.
  //
  // Also tagged `markdown-body` (measured against a real markdown-proxy
  // theme file, ~/.config/markdown-proxy/themes/dark.css, during Phase 15
  // review: only its bare `body {...}` rule took effect, since every other
  // rule is written as `.markdown-body h1`/`.markdown-body pre`/etc. — that
  // project's own class name convention) so a markdown-proxy theme file can
  // be pointed at directly as a MDyX custom theme (Settings > Theme...)
  // with no edits, not just MDyX's own `.mdyx-content`-scoped built-ins.
  crepe.editor.action((ctx) => ctx.get(editorViewCtx).dom.classList.add("mdyx-content", "markdown-body"));

  return crepe;
}

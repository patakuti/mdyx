import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/core";
import { linkSchema } from "@milkdown/preset-commonmark";
import { tableCellSchema, tableHeaderSchema } from "@milkdown/preset-gfm";
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import type { DeriveContext } from "@milkdown/kit/plugin/block";
import { search } from "prosemirror-search";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

import {
  createImageClipboardPlugin,
  createGeneralImagePastePlugin,
  setupImagePasteInterceptor,
} from "../clipboard/image-clipboard-plugin";
import type { ActiveFilePathGetter } from "../clipboard/image-paste";
import { createImageView } from "./nodes/image-view";
import { remarkMathPlugin, mathInlineSchema, mathBlockSchema } from "./nodes/math";
import { mathInlineView, mathBlockView } from "./nodes/math-view";
import { nonCustomFenceCodeBlockSchema } from "./nodes/fenced-code-block";
import { plantumlSchema } from "./nodes/plantuml";
import { plantumlView } from "./nodes/plantuml-view";
import { plantumlClipboardPlugin } from "../clipboard/plantuml-clipboard-plugin";
import { mermaidSchema } from "./nodes/mermaid";
import { mermaidView } from "./nodes/mermaid-view";
import { mermaidClipboardPlugin } from "../clipboard/mermaid-clipboard-plugin";
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
// Minimum on-screen clearance (px) the block drag handle needs to its
// left, measured in a real browser (32px handle width + 16px `getOffset()`
// gap, `handle/index.ts`) — the same figure `styles.css`'s `#editor-root`
// gutter padding is sized from (01_requirements.md 3.16節, 02_design.md
// 25章/26章).
const BLOCK_HANDLE_GUTTER_WIDTH = 48;

/// Creates the block handle's floating-ui mount point (Phase 22,
/// 01_requirements.md 3.16節, 02_design.md 26章). By default the handle
/// mounts into `view.dom.parentElement` (`.milkdown`), which lives *inside*
/// `#editor-root`'s horizontally-scrolling viewport (styles.css) — so it
/// scrolls away with the document instead of staying in its fixed gutter,
/// reported by real usage after Phase 22's initial ship ("scrolling right
/// pushes the handle off-screen too"). `position: sticky; left: 0` here
/// pins this element to `#editor-root`'s own left edge regardless of its
/// `scrollLeft` — `width/height: 0` with `overflow: visible` keeps it out
/// of `.milkdown`'s layout box entirely (a common sticky-badge technique)
/// so it doesn't shift `.mdyx-content`'s centering. `position: sticky`
/// still establishes a containing block for its absolutely-positioned
/// children (same as `relative`), which is all `BlockProvider` needs from
/// a `root` element (`node_modules/@milkdown/plugin-block/src/block-
/// provider.ts`'s `#init()` just calls `root.appendChild`).
function createBlockHandleGutter(root: HTMLElement): HTMLElement {
  const gutter = document.createElement("div");
  // `milkdown`, not just our own class: `@milkdown/crepe/theme/common/*.css`
  // scopes every rule the handle needs (`position: absolute`, `display:
  // flex`, icon sizing, colors, ...) behind a `.milkdown <descendant>`
  // selector — found missing in testing: without this class, none of that
  // CSS matched once the handle moved outside the real `.milkdown` wrapper
  // (`position` computed as `static`, width collapsed to 0). `.milkdown`
  // itself is just a reset/base scoping class (`theme/common/reset.css`)
  // safe to duplicate onto another element.
  gutter.className = "milkdown mdyx-block-handle-gutter";
  root.insertBefore(gutter, root.firstChild);
  return gutter;
}

export async function setupEditor(
  root: HTMLElement,
  getActiveFilePath: ActiveFilePathGetter,
  onEditorUpdate: (view: EditorView) => void
): Promise<Crepe> {
  const blockHandleGutter = createBlockHandleGutter(root);
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
      // Disabled entirely, not just left at its defaults: its bundled
      // `remark-image-block` plugin silently promotes any image that's
      // alone in its own paragraph (the common case — e.g. every image in
      // this very README) into a different node type on every file open,
      // which this app's whole image round-trip design (5.2節) never
      // recognized — breaking both display (its own unresolved-`src`
      // placeholder) and Copy (its own `toMarkdown` writes the resize
      // ratio into the alt slot, e.g. `![1.00](path)`, confirmed via a real
      // repro). `createImageView` (nodes/image-view.ts) below replaces the
      // one thing this app actually wanted from the feature — proxyDomURL
      // display resolution — without the promotion.
      [Crepe.Feature.ImageBlock]: false,
    },
    featureConfigs: {
      // Crepe's default caret rendering is a custom "virtual cursor"
      // (`prosemirror-virtual-cursor`, a ProseMirror widget decoration —
      // i.e. a DOM node inserted directly into the zoomed `.mdyx-content`
      // subtree) positioned via inline `top`/`left`/`height` styles computed
      // in real screen pixels (`getBoundingClientRect()` differences). Since
      // that positioned element is itself a *descendant* of the zoomed
      // element, the browser applies `zoom` to those inline pixel values a
      // second time, roughly squaring the offset — reproduced on real
      // hardware as a caret rendered far to the right of and much taller
      // than the actual text (01_requirements.md 3.15節, 02_design.md
      // 24.1節). Disabling `virtual` falls back to the browser's own native
      // contenteditable caret, which isn't a positioned DOM node at all and
      // renders correctly under `zoom` (confirmed on the same hardware).
      [Crepe.Feature.Cursor]: { virtual: false },
      // Mounts the block drag handle into `blockHandleGutter` (fixed to
      // `#editor-root`'s left edge, see `createBlockHandleGutter` above)
      // instead of its default `view.dom.parentElement`, so it no longer
      // scrolls away with the document.
      [Crepe.Feature.BlockEdit]: {
        blockHandle: {
          root: blockHandleGutter,
          // floating-ui still places the handle `getOffset()`'s 16px to
          // the left of the *actual* (possibly scrolled far off-screen)
          // block position — moving its mount point above isn't enough by
          // itself, since a fully off-screen reference block would still
          // compute a wildly negative target position. Clamping the
          // reference position's left edge to never read further left
          // than `root`'s own (unscrolled) left edge keeps the handle
          // inside the visible gutter even while the document is scrolled
          // (only `getPosition`'s x/left/right/width need to make sense
          // together for floating-ui's `left` placement math — top/bottom
          // stay untouched so vertical tracking is unaffected).
          getPosition: ({ active }: DeriveContext) => {
            const blockRect = active.el.getBoundingClientRect();
            const rootRect = root.getBoundingClientRect();
            const left = Math.max(blockRect.left, rootRect.left + BLOCK_HANDLE_GUTTER_WIDTH);
            return {
              x: left,
              y: blockRect.y,
              width: blockRect.width,
              height: blockRect.height,
              top: blockRect.top,
              bottom: blockRect.bottom,
              left,
              right: left + blockRect.width,
            };
          },
        },
      },
    },
  });
  crepe.editor.use(createImageClipboardPlugin(getActiveFilePath));
  crepe.editor.use(createGeneralImagePastePlugin(getActiveFilePath));
  crepe.editor.use(createImageView(getActiveFilePath));
  crepe.editor.use(tableClipboardPlugin);
  crepe.editor.use(relaxedTableCellSchema);
  crepe.editor.use(relaxedTableHeaderSchema);
  crepe.editor.use(nonInclusiveLinkSchema);
  crepe.editor.use(remarkMathPlugin);
  crepe.editor.use(mathInlineSchema);
  crepe.editor.use(mathBlockSchema);
  crepe.editor.use(mathInlineView);
  crepe.editor.use(mathBlockView);
  crepe.editor.use(nonCustomFenceCodeBlockSchema);
  crepe.editor.use(plantumlSchema);
  crepe.editor.use(plantumlView);
  crepe.editor.use(plantumlClipboardPlugin);
  crepe.editor.use(mermaidSchema);
  crepe.editor.use(mermaidView);
  crepe.editor.use(mermaidClipboardPlugin);
  // Registered once here rather than per-tab: every tab's `EditorState` is
  // built from `prosePluginsCtx` (`markdown-io/parser.ts`, `tab-manager.ts`),
  // so this plugin's own state (current query + match decorations) ends up
  // independently owned by each tab automatically (02_design.md 22.2節).
  crepe.editor.use($prose(() => search()));
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

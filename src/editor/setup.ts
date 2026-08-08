import { Crepe } from "@milkdown/crepe";
import { tableCellSchema, tableHeaderSchema } from "@milkdown/preset-gfm";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

import { createImageClipboardPlugin, setupImagePasteInterceptor } from "../clipboard/image-clipboard-plugin";
import { resolveImageDisplaySrc } from "../clipboard/image-paste";
import type { ActiveFilePathGetter } from "../clipboard/image-paste";
import { remarkMathPlugin, mathInlineSchema, mathBlockSchema } from "./nodes/math";
import { mathInlineView, mathBlockView } from "./nodes/math-view";
import { nonPlantumlCodeBlockSchema, plantumlSchema } from "./nodes/plantuml";
import { plantumlView } from "./nodes/plantuml-view";
import { plantumlClipboardPlugin } from "../clipboard/plantuml-clipboard-plugin";

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

// Tabs (Phase 9) mean image paths must resolve relative to whichever tab is
// currently active, not a single fixed document — see tabs/tab-manager.ts
// and image-paste.ts's `ActiveFilePathGetter`. `setupEditor` runs before the
// `TabManager` exists (it needs a `Crepe` instance to wrap), so the caller
// passes a getter closure instead of a plain value.
export async function setupEditor(root: HTMLElement, getActiveFilePath: ActiveFilePathGetter): Promise<Crepe> {
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
  crepe.editor.use(relaxedTableCellSchema);
  crepe.editor.use(relaxedTableHeaderSchema);
  crepe.editor.use(remarkMathPlugin);
  crepe.editor.use(mathInlineSchema);
  crepe.editor.use(mathBlockSchema);
  crepe.editor.use(mathInlineView);
  crepe.editor.use(mathBlockView);
  crepe.editor.use(nonPlantumlCodeBlockSchema);
  crepe.editor.use(plantumlSchema);
  crepe.editor.use(plantumlView);
  crepe.editor.use(plantumlClipboardPlugin);

  await crepe.create();
  setupImagePasteInterceptor(root, crepe, getActiveFilePath);
  return crepe;
}

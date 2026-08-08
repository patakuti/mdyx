import { Crepe } from "@milkdown/crepe";
import { tableCellSchema, tableHeaderSchema } from "@milkdown/preset-gfm";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

import { imageClipboardPlugin, setupImagePasteInterceptor } from "../clipboard/image-clipboard-plugin";
import { resolveImageDisplaySrc } from "../clipboard/image-paste";
import { remarkMathPlugin, mathInlineSchema, mathBlockSchema } from "./nodes/math";
import { mathInlineView, mathBlockView } from "./nodes/math-view";

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

export async function setupEditor(root: HTMLElement): Promise<Crepe> {
  const crepe = new Crepe({
    root,
    defaultValue: "# MDyX\n\nWYSIWYG Markdown editor.\n",
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
        proxyDomURL: resolveImageDisplaySrc,
      },
    },
  });
  crepe.editor.use(imageClipboardPlugin);
  crepe.editor.use(relaxedTableCellSchema);
  crepe.editor.use(relaxedTableHeaderSchema);
  crepe.editor.use(remarkMathPlugin);
  crepe.editor.use(mathInlineSchema);
  crepe.editor.use(mathBlockSchema);
  crepe.editor.use(mathInlineView);
  crepe.editor.use(mathBlockView);

  await crepe.create();
  setupImagePasteInterceptor(root, crepe);
  return crepe;
}

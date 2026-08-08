import type { Crepe } from "@milkdown/crepe";
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import type { Transaction } from "@milkdown/prose/state";

import { isImageNodeSelected, pasteImageFromClipboard, copyImagePath } from "./image-paste";
import { showToast } from "../ui/toast";

const BINARY_IMAGE_REJECTED_MESSAGE =
  "Pasting raw image data isn't supported. Copy an image file's path instead.";

/// Overrides copy when an image node is selected: writes the image's
/// absolute path as text (01_requirements.md 5.2) instead of the browser's
/// default image-element copy.
///
/// Also rejects raw image binary on paste. This can't be done by inspecting
/// the paste DOM event's `clipboardData` (measured: WebKitGTK leaves
/// `clipboardData.items`/`.files` empty when read from an ancestor's
/// capture-phase listener, so any such check silently no-ops), so instead
/// this scans the document *after* the paste transaction lands and removes
/// any image node whose `src` is a `blob:` URL — the shape Milkdown's
/// built-in upload plugin produces when it accepts raw binary. This is
/// timing-independent regardless of which internal plugin handled the paste.
export const imageClipboardPlugin = $prose((ctx) => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        copy: (_view, event) => {
          if (!isImageNodeSelected(ctx)) return false;
          event.preventDefault();
          void copyImagePath(ctx);
          return true;
        },
      },
    },
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const blobImages: { pos: number; size: number }[] = [];
      newState.doc.descendants((node, pos) => {
        const src = node.attrs.src;
        if (typeof src === "string" && src.startsWith("blob:")) {
          blobImages.push({ pos, size: node.nodeSize });
        }
      });
      if (blobImages.length === 0) return null;

      let tr: Transaction = newState.tr;
      for (const { pos, size } of blobImages.sort((a, b) => b.pos - a.pos)) {
        tr = tr.delete(pos, pos + size);
      }
      showToast(BINARY_IMAGE_REJECTED_MESSAGE, "error");
      return tr;
    },
  });
});

/// Intercepts paste in the capture phase, before it reaches ProseMirror's
/// own paste handling, so that pasting while an image node is selected
/// resolves the clipboard path via Rust (reliable — it reads the system
/// clipboard directly via arboard, not the DOM event) instead of Milkdown's
/// default text/HTML paste replacing the selection.
export function setupImagePasteInterceptor(root: HTMLElement, crepe: Crepe): void {
  root.addEventListener(
    "paste",
    (event) => {
      const ctx = crepe.editor.ctx;
      if (!isImageNodeSelected(ctx)) return;

      event.preventDefault();
      event.stopPropagation();
      void pasteImageFromClipboard(ctx);
    },
    true
  );
}

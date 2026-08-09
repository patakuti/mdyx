import { invoke } from "@tauri-apps/api/core";
import type { Crepe } from "@milkdown/crepe";
import type { Ctx } from "@milkdown/ctx";
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import type { Transaction } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";

import {
  isImageNodeSelected,
  pasteImageFromClipboard,
  copyImagePath,
  insertResolvedImage,
  IMAGE_EXTENSION_PATTERN,
} from "./image-paste";
import type { ActiveFilePathGetter, ClipboardPasteContent } from "./image-paste";
import { prosePrepend } from "./prose-prepend";
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
export function createImageClipboardPlugin(getActiveFilePath: ActiveFilePathGetter) {
  return $prose((ctx) => {
    return new Plugin({
      props: {
        handleDOMEvents: {
          copy: (_view, event) => {
            if (!isImageNodeSelected(ctx)) return false;
            event.preventDefault();
            void copyImagePath(ctx, getActiveFilePath);
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
}

/// Intercepts paste in the capture phase, before it reaches ProseMirror's
/// own paste handling, so that pasting while an image node is selected
/// resolves the clipboard path via Rust (reliable — it reads the system
/// clipboard directly via arboard, not the DOM event) instead of Milkdown's
/// default text/HTML paste replacing the selection.
export function setupImagePasteInterceptor(
  root: HTMLElement,
  crepe: Crepe,
  getActiveFilePath: ActiveFilePathGetter
): void {
  root.addEventListener(
    "paste",
    (event) => {
      const ctx = crepe.editor.ctx;
      if (!isImageNodeSelected(ctx)) return;

      event.preventDefault();
      event.stopPropagation();
      void pasteImageFromClipboard(ctx, getActiveFilePath);
    },
    true
  );
}

async function resolveAndInsertOrFallback(
  ctx: Ctx,
  view: EditorView,
  candidate: string,
  getActiveFilePath: ActiveFilePathGetter
): Promise<void> {
  const result = await invoke<ClipboardPasteContent>("resolve_image_candidate", {
    candidate,
    currentFilePath: getActiveFilePath(),
  });

  if (result.kind === "path") {
    insertResolvedImage(ctx, result);
    return;
  }
  // Not actually a usable image path after all. `handlePaste` below already
  // returned `true` to suppress ProseMirror's default paste handling for
  // this text, so it has to be reinserted here as plain text — otherwise
  // the paste would just silently do nothing, losing what was pasted.
  view.dispatch(view.state.tr.insertText(candidate));
}

/// Auto-detects a pasted image path with nothing (or nothing relevant)
/// selected — mirroring PlantUML's/table's own content-shape-based paste
/// auto-detection (plantuml-clipboard-plugin.ts, table-clipboard-plugin.ts,
/// 02_design.md 14.2節). Deliberately kept separate from
/// `createImageClipboardPlugin`/`setupImagePasteInterceptor` above (the
/// "image node already selected" path): that mechanism is left untouched to
/// avoid risking a regression in it, and this new plugin explicitly defers
/// to it via `isImageNodeSelected`.
export function createGeneralImagePastePlugin(getActiveFilePath: ActiveFilePathGetter) {
  return prosePrepend((ctx) => {
    return new Plugin({
      props: {
        handlePaste: (view, event) => {
          if (isImageNodeSelected(ctx)) return false;

          const text = event.clipboardData?.getData("text/plain");
          const trimmed = text?.trim();
          if (!trimmed || trimmed.includes("\n") || !IMAGE_EXTENSION_PATTERN.test(trimmed)) return false;

          void resolveAndInsertOrFallback(ctx, view, trimmed, getActiveFilePath);
          return true;
        },
      },
    });
  });
}

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/core";
import { callCommand } from "@milkdown/utils";
import { insertImageCommand, imageSchema } from "@milkdown/preset-commonmark";
import { NodeSelection } from "@milkdown/prose/state";

import { showToast } from "../ui/toast";

/// Returns the file path of whichever tab's content is currently loaded
/// into the (single, shared) `EditorView` — see tabs/tab-manager.ts. Image
/// paths are resolved relative to this.
export type ActiveFilePathGetter = () => string | null;

export type ClipboardPasteContent =
  | { kind: "path"; path: string; isRelative: boolean; outOfScope: boolean }
  | { kind: "binary" }
  | { kind: "none" };

/// Also reused by export/html-export.ts, which needs the same "is this
/// already a URL, not a filesystem path" check for `<img>` src rewriting.
export const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/// Mirrors Rust's `path_resolver::IMAGE_EXTENSIONS`. Used as a cheap
/// synchronous pre-filter before paying for an async Rust round-trip
/// (`image-clipboard-plugin.ts`'s general-paste auto-detect,
/// 02_design.md 14.2節) — the two lists are duplicated across languages
/// deliberately rather than shared, since image extensions essentially
/// never change and a cross-language sharing mechanism isn't worth it here.
export const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/// Convert a stored image `src` (a filesystem path, per 01_requirements.md
/// 5.2) into a URL the WebView can actually load. `src` values that are
/// already a URL (http(s)/data/etc., e.g. a hand-written `![]()` link) pass
/// through unchanged.
export async function resolveImageDisplaySrc(
  src: string,
  getActiveFilePath: ActiveFilePathGetter
): Promise<string> {
  if (!src || URL_SCHEME_PATTERN.test(src)) return src;

  const absolutePath = await invoke<string>("resolve_image_display_path", {
    src,
    currentFilePath: getActiveFilePath(),
  });
  return convertFileSrc(absolutePath);
}

export function isImageNodeSelected(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx);
  const { selection } = view.state;
  return selection instanceof NodeSelection && selection.node.type === imageSchema.type(ctx);
}

/// Inserts an already-resolved image path (`kind: "path"` from either
/// `read_clipboard_for_image` or `resolve_image_candidate`), warning first
/// if it's outside the document's folder. Shared by `pasteImageFromClipboard`
/// below, the general-paste auto-detect plugin (image-clipboard-plugin.ts,
/// 02_design.md 14.2節), and the Insert > Image dialog
/// (insert-image-dialog.ts, 14.3節).
export function insertResolvedImage(ctx: Ctx, result: { path: string; outOfScope: boolean }): void {
  if (result.outOfScope) {
    showToast(
      "Image is outside the document's folder; embedding the absolute path instead of a relative one.",
      "warning"
    );
  }
  callCommand(insertImageCommand.key, { src: result.path })(ctx);
}

export async function pasteImageFromClipboard(ctx: Ctx, getActiveFilePath: ActiveFilePathGetter): Promise<void> {
  const result = await invoke<ClipboardPasteContent>("read_clipboard_for_image", {
    currentFilePath: getActiveFilePath(),
  });

  if (result.kind === "binary") {
    showToast("Pasting raw image data isn't supported. Copy an image file's path instead.", "error");
    return;
  }
  if (result.kind === "none") {
    showToast("No image file path found on the clipboard.", "error");
    return;
  }

  insertResolvedImage(ctx, result);
}

export async function copyImagePath(ctx: Ctx, getActiveFilePath: ActiveFilePathGetter): Promise<void> {
  const view = ctx.get(editorViewCtx);
  const { selection } = view.state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== imageSchema.type(ctx)) {
    return;
  }
  const src = selection.node.attrs.src as string;

  await invoke("copy_image_path", {
    src,
    currentFilePath: getActiveFilePath(),
  });
}

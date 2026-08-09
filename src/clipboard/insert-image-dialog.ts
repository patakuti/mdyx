import { invoke } from "@tauri-apps/api/core";
import type { Ctx } from "@milkdown/ctx";

import { insertResolvedImage } from "./image-paste";
import type { ActiveFilePathGetter, ClipboardPasteContent } from "./image-paste";

let overlay: HTMLElement | null = null;

function close(): void {
  overlay?.remove();
  overlay = null;
}

function dirnameOf(filePath: string): string | null {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx === -1 ? null : filePath.slice(0, idx);
}

/// Fallback shown by Insert > Image (menu/toolbar) when the clipboard has no
/// usable image path — Insert > Table/PlantUML Diagram always have *some*
/// fallback content (an empty table/diagram), but there's no meaningful
/// "empty image" (01_requirements.md 5.2節, 02_design.md 14.3節). Lets the
/// user type a local path or URL directly, or browse for a file.
///
/// Deliberately not Crepe's built-in ImageBlock "Upload file / paste link"
/// placeholder: this tool never embeds binary content, only ever references
/// external files/URLs, so an "upload" affordance doesn't fit
/// (01_requirements.md 5.2節).
export function showInsertImageDialog(ctx: Ctx, getActiveFilePath: ActiveFilePathGetter): void {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.className = "settings-overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  const panel = document.createElement("div");
  panel.className = "settings-panel";
  overlay.appendChild(panel);

  const title = document.createElement("h2");
  title.textContent = "Insert Image";
  panel.appendChild(title);

  const label = document.createElement("label");
  label.className = "settings-label";
  label.textContent = "File path or URL";
  panel.appendChild(label);

  const inputRow = document.createElement("div");
  inputRow.className = "insert-image-input-row";
  panel.appendChild(inputRow);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-input";
  inputRow.appendChild(input);

  const browseButton = document.createElement("button");
  browseButton.type = "button";
  browseButton.textContent = "Browse...";
  browseButton.addEventListener("click", () => {
    const activeFilePath = getActiveFilePath();
    const initialDir = activeFilePath ? dirnameOf(activeFilePath) : null;
    void invoke<string | null>("pick_image_file", { initialDir }).then((picked) => {
      if (picked) input.value = picked;
    });
  });
  inputRow.appendChild(browseButton);

  const error = document.createElement("p");
  error.className = "settings-label insert-image-error";
  error.hidden = true;
  panel.appendChild(error);

  const buttons = document.createElement("div");
  buttons.className = "settings-buttons";
  panel.appendChild(buttons);

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", close);
  buttons.appendChild(cancelButton);

  const insertButton = document.createElement("button");
  insertButton.type = "button";
  insertButton.textContent = "Insert";
  insertButton.addEventListener("click", () => {
    const candidate = input.value.trim();
    if (!candidate) {
      error.textContent = "Enter a file path or URL.";
      error.hidden = false;
      return;
    }
    void invoke<ClipboardPasteContent>("resolve_image_candidate", {
      candidate,
      currentFilePath: getActiveFilePath(),
    }).then((result) => {
      if (result.kind !== "path") {
        error.textContent = "Couldn't find an image at that path.";
        error.hidden = false;
        return;
      }
      insertResolvedImage(ctx, result);
      close();
    });
  });
  buttons.appendChild(insertButton);

  document.body.appendChild(overlay);
  input.focus();
}

/// Insert > Image (menu/toolbar): uses a valid image path already on the
/// clipboard immediately if there is one (same as before, no dialog needed
/// — mirrors Insert > Table/PlantUML Diagram's own clipboard-first
/// behavior), otherwise falls back to `showInsertImageDialog` above instead
/// of just erroring out (01_requirements.md 5.2節, 02_design.md 14.3節).
export async function insertImageFromClipboardOrDialog(ctx: Ctx, getActiveFilePath: ActiveFilePathGetter): Promise<void> {
  const result = await invoke<ClipboardPasteContent>("read_clipboard_for_image", {
    currentFilePath: getActiveFilePath(),
  });
  if (result.kind === "path") {
    insertResolvedImage(ctx, result);
    return;
  }
  showInsertImageDialog(ctx, getActiveFilePath);
}

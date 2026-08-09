import { invoke } from "@tauri-apps/api/core";
import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx, schemaCtx } from "@milkdown/core";
import { linkSchema } from "@milkdown/preset-commonmark";
import { TextSelection } from "@milkdown/prose/state";

import { showToast } from "../ui/toast";
import type { ActiveFilePathGetter, ClipboardPasteContent } from "../clipboard/image-paste";

let overlay: HTMLElement | null = null;

function close(): void {
  overlay?.remove();
  overlay = null;
}

function dirnameOf(filePath: string): string | null {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx === -1 ? null : filePath.slice(0, idx);
}

/// Replaces the current selection (if any) with a single link-marked text
/// run, or inserts it at the cursor otherwise — same "delete selection,
/// insert at that point, move the cursor past it" pattern as
/// `table-insert.ts`'s `insertTableNode`. Typing right after the inserted
/// link doesn't extend it onto the new text: `setup.ts` overrides
/// `linkSchema` with `inclusive: false` (02_design.md 16.4節).
function insertLink(ctx: Ctx, text: string, url: string): void {
  const view = ctx.get(editorViewCtx);
  const schema = ctx.get(schemaCtx);
  const mark = linkSchema.type(ctx).create({ href: url, title: null });
  const node = schema.text(text, [mark]);

  const tr = view.state.tr;
  if (!tr.selection.empty) tr.deleteSelection();
  const pos = tr.selection.from;
  tr.insert(pos, node);
  tr.setSelection(TextSelection.create(tr.doc, pos + node.nodeSize));
  view.dispatch(tr.scrollIntoView());
}

/// Insert > Link (menu/toolbar and `Ctrl/Cmd+K`, 01_requirements.md 3.12節):
/// a dedicated entry point alongside Insert > Table/Image/PlantUML Diagram,
/// since the existing way to add a link — select text, then use Crepe's
/// built-in floating-toolbar link icon (`LinkTooltip` feature,
/// `node_modules/@milkdown/crepe/src/feature/link-tooltip`) — requires a
/// pre-existing selection and isn't very discoverable. That floating
/// toolbar still works as before; this is a second, more visible way in,
/// not a replacement (02_design.md 16.1節).
///
/// Accepts both `https://...` URLs and local file paths (Browse button
/// included) in the same field, resolved via the new `resolve_link_candidate`
/// Rust command — the same URL-or-path branching and relative-path-if-
/// in-scope behavior Insert > Image already has (`resolve_image_candidate`),
/// just without the image-extension restriction, since a link can point to
/// any file (02_design.md 16.2節).
export function showInsertLinkDialog(ctx: Ctx, getActiveFilePath: ActiveFilePathGetter): void {
  if (overlay) return;

  const view = ctx.get(editorViewCtx);
  const { from, to, empty } = view.state.selection;
  const initialText = empty ? "" : view.state.doc.textBetween(from, to);

  overlay = document.createElement("div");
  overlay.className = "settings-overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  const panel = document.createElement("div");
  panel.className = "settings-panel";
  overlay.appendChild(panel);

  const title = document.createElement("h2");
  title.textContent = "Insert Link";
  panel.appendChild(title);

  const textLabel = document.createElement("label");
  textLabel.className = "settings-label";
  textLabel.textContent = "Text";
  panel.appendChild(textLabel);

  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.className = "settings-input";
  textInput.value = initialText;
  panel.appendChild(textInput);

  const urlLabel = document.createElement("label");
  urlLabel.className = "settings-label";
  urlLabel.textContent = "URL or file path";
  panel.appendChild(urlLabel);

  const inputRow = document.createElement("div");
  inputRow.className = "insert-image-input-row";
  panel.appendChild(inputRow);

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.className = "settings-input";
  inputRow.appendChild(urlInput);

  const browseButton = document.createElement("button");
  browseButton.type = "button";
  browseButton.textContent = "Browse...";
  browseButton.addEventListener("click", () => {
    const activeFilePath = getActiveFilePath();
    const initialDir = activeFilePath ? dirnameOf(activeFilePath) : null;
    void invoke<string | null>("pick_link_file", { initialDir }).then((picked) => {
      if (picked) urlInput.value = picked;
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
    const candidate = urlInput.value.trim();
    if (!candidate) {
      error.textContent = "Enter a URL or file path.";
      error.hidden = false;
      return;
    }
    void invoke<ClipboardPasteContent>("resolve_link_candidate", {
      candidate,
      currentFilePath: getActiveFilePath(),
    }).then((result) => {
      if (result.kind !== "path") {
        error.textContent = "Couldn't find a file at that path.";
        error.hidden = false;
        return;
      }
      if (result.outOfScope) {
        showToast(
          "Target is outside the document's folder; embedding the absolute path instead of a relative one.",
          "warning"
        );
      }
      const text = textInput.value.trim() || result.path;
      insertLink(ctx, text, result.path);
      close();
    });
  });
  buttons.appendChild(insertButton);

  document.body.appendChild(overlay);
  textInput.focus();
}

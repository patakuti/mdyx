import { invoke } from "@tauri-apps/api/core";
import { editorViewCtx } from "@milkdown/core";
import type { Crepe } from "@milkdown/crepe";
import type { EditorView } from "@milkdown/prose/view";

import { runUndo, runRedo } from "../toolbar/tool-bar";

interface MenuItem {
  label: string;
  run: () => void;
}

let menu: HTMLElement | null = null;

function close(): void {
  if (!menu) return;
  menu.remove();
  menu = null;
  document.removeEventListener("mousedown", handleOutsideMouseDown, true);
  document.removeEventListener("keydown", handleKeyDown, true);
}

function handleOutsideMouseDown(event: MouseEvent): void {
  if (menu && event.target instanceof Node && menu.contains(event.target)) return;
  close();
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}

/// **Real-machine finding (confidence: high, confirmed by the user directly
/// comparing the two paths with identical clipboard content via `cargo
/// tauri dev`)**: `document.execCommand("paste")` on this app's WebKitGTK
/// inserts plain text, but does not dispatch a genuine `paste` DOM event
/// with `clipboardData` populated — so none of the table/PlantUML/image
/// `handlePaste` plugins (which all read `event.clipboardData`) ever ran,
/// even though the identical content pastes correctly via Ctrl+V. Cut/Copy
/// were not reported as broken, so they stay on `document.execCommand`
/// (the WebView's native clipboard handling for the current
/// selection/focus — still the standard way to invoke "the same thing
/// Ctrl+C/X does" without the frontend Clipboard API, `navigator.clipboard`,
/// which 02_design.md 4.6節/11章 already found fails with `NotAllowedError`
/// on Linux/WebKitGTK for `read()`).
///
/// Paste instead reads `text/plain` via the Rust-side `read_clipboard_text`
/// command (`arboard`-backed, already proven reliable elsewhere —
/// `table-insert.ts`'s `readPlainText`/PlantUML paste fallback) and
/// dispatches a synthetic `ClipboardEvent("paste", ...)` directly on the
/// editor's DOM. This goes through the exact same `handlePaste` plugin
/// chain (table/image/PlantUML auto-detection) a real Ctrl+V does, reusing
/// that logic instead of duplicating it — the same dispatch technique used
/// to test those plugins directly against a live `EditorView` during Phase
/// 11's debugging. It only has `text/plain` (no Rust `read_html` command
/// exists), the same limitation Insert > Table already has on Linux
/// (02_design.md 11章: `navigator.clipboard.read()` fails with
/// `NotAllowedError`) — so a real `text/html` table copied from an external
/// app (e.g. LibreOffice Calc) still won't auto-detect via this menu item,
/// only via Ctrl+V. Not a new regression, just the same existing
/// constraint (02_design.md 15.5節).
async function pasteFromClipboard(view: EditorView): Promise<void> {
  const text = await invoke<string | null>("read_clipboard_text");
  if (!text) return;
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/plain", text);
  const event = new ClipboardEvent("paste", { clipboardData: dataTransfer, bubbles: true, cancelable: true });
  view.dom.dispatchEvent(event);
}

function buildItems(crepe: Crepe): MenuItem[] {
  return [
    { label: "Cut", run: () => document.execCommand("cut") },
    { label: "Copy", run: () => document.execCommand("copy") },
    {
      label: "Paste",
      run: () => {
        crepe.editor.action((ctx) => {
          void pasteFromClipboard(ctx.get(editorViewCtx));
        });
      },
    },
    { label: "Undo", run: () => runUndo(crepe) },
    { label: "Redo", run: () => runRedo(crepe) },
  ];
}

/// Replaces the WebView's (WebKitGTK) native context menu — which includes
/// items unrelated to this app's concept (Insert Emoji, Font, Insert
/// Unicode Control Character, Inspect Element) — with a minimal 5-item menu
/// (01_requirements.md 3.11節, Phase 12).
///
/// Each button prevents the default `mousedown` behavior before running its
/// command, so clicking it doesn't steal focus/collapse the editor's
/// selection first — the same technique Crepe's own block-handle "+"/drag
/// buttons use (`feature/block-edit/handle/component.tsx`,
/// `onPointerdown`+`preventDefault`). The command then runs against
/// whichever selection existed when the menu was opened.
///
/// All items are always shown as enabled/clickable, with no availability
/// checks (empty selection, empty undo stack, ...): the toolbar's own
/// Undo/Redo buttons are already unconditionally clickable the same way
/// (01_requirements.md 3.6節 explicitly excludes them from state tracking),
/// so this keeps the same convention rather than adding new disabled-state
/// logic (02_design.md 15.5節).
export function setupEditorContextMenu(root: HTMLElement, crepe: Crepe): void {
  root.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    close();

    const el = document.createElement("div");
    el.className = "editor-context-menu";
    for (const item of buildItems(crepe)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("mousedown", (mouseDownEvent) => {
        mouseDownEvent.preventDefault();
        item.run();
        close();
      });
      el.appendChild(button);
    }
    document.body.appendChild(el);
    menu = el;

    const rect = el.getBoundingClientRect();
    const left = Math.min(event.clientX, window.innerWidth - rect.width - 4);
    const top = Math.min(event.clientY, window.innerHeight - rect.height - 4);
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${Math.max(4, top)}px`;

    document.addEventListener("mousedown", handleOutsideMouseDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
  });
}

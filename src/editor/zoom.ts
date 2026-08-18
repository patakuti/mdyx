import type { EditorView } from "@milkdown/prose/view";

// Ctrl+Wheel zoom (01_requirements.md 3.15節, 02_design.md 24章). Module-level
// singleton, same pattern as `find-replace-bar.ts`'s `bar` — there is only
// ever one `.mdyx-content` DOM element (a single Crepe instance is reused
// across tabs, `tab-manager.ts`), so one zoom level for the whole app is all
// this needs to track.
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const STEP = 10;
const DEFAULT_ZOOM = 100;

let currentZoom = DEFAULT_ZOOM;
let scrollContainer: HTMLElement | null = null;
let getView: (() => EditorView | undefined) | null = null;

function clamp(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)));
}

/// Writes the zoom level to the CSS custom property `styles.css`'s
/// `.mdyx-content` rule reads (`zoom: var(--mdyx-zoom, 1)`) — set on
/// `documentElement` rather than the editor container itself so it also
/// covers the case (module init, before `setupZoom` runs) where the
/// container isn't known yet. Every zoom change (wheel or `&View` menu)
/// goes through here, so `scrollCaretIntoView` below only needs to be
/// called from this one place to cover every entry point.
function applyZoom(value: number): void {
  const changed = clamp(value) !== currentZoom;
  currentZoom = clamp(value);
  document.documentElement.style.setProperty("--mdyx-zoom", String(currentZoom / 100));
  if (changed) scrollCaretIntoView();
}

/// Keeps the text caret (the insertion-point cursor, not the mouse pointer
/// — clarified after a first attempt anchored to the mouse pointer instead,
/// which wasn't what was wanted) visible after a zoom change. Without this,
/// `scrollContainer.scrollTop`/`scrollLeft` stay numerically unchanged while
/// the content they're measured against grows/shrinks along with the zoom,
/// so wherever the caret happens to be can drift out of view on every wheel
/// tick or `&View` menu click. Reported by real usage, reproduced on real
/// hardware: zooming while a control near the bottom of the document was
/// focused scrolled it out of view.
function scrollCaretIntoView(): void {
  if (!scrollContainer || !getView) return;
  const view = getView();
  if (!view) return;
  const coords = view.coordsAtPos(view.state.selection.head);
  const rect = scrollContainer.getBoundingClientRect();
  if (coords.top < rect.top) {
    scrollContainer.scrollTop -= rect.top - coords.top;
  } else if (coords.bottom > rect.bottom) {
    scrollContainer.scrollTop += coords.bottom - rect.bottom;
  }
  if (coords.left < rect.left) {
    scrollContainer.scrollLeft -= rect.left - coords.left;
  } else if (coords.left > rect.right) {
    scrollContainer.scrollLeft += coords.left - rect.right;
  }
}

export function getZoomLevel(): number {
  return currentZoom;
}

export function zoomIn(): void {
  applyZoom(currentZoom + STEP);
}

export function zoomOut(): void {
  applyZoom(currentZoom - STEP);
}

export function resetZoom(): void {
  applyZoom(DEFAULT_ZOOM);
}

/// Applies `initialZoom` (the persisted level from `AppConfig.zoomLevel`,
/// `main.ts`) and wires up `Ctrl+Wheel` on `container` (`#editor-root`,
/// an ancestor of the single `.mdyx-content` element — the listener doesn't
/// need to live on `.mdyx-content` itself since wheel events bubble).
/// `{ passive: false }` is required to call `preventDefault()` (browsers
/// default wheel listeners to passive).
///
/// One wheel event is treated as one `STEP`, ignoring `event.deltaY`'s
/// magnitude — measured on real hardware (Linux/WebKitGTK, `cargo tauri
/// dev`, xdotool-simulated mouse wheel clicks) at a consistent
/// `deltaY≈±97, deltaMode=0` per physical notch, i.e. one discrete wheel
/// event per notch rather than a stream of small deltas — so scaling by
/// magnitude isn't needed for a physical mouse (01_requirements.md 8章).
/// Trackpad pinch/scroll behavior remains unverified (no trackpad hardware
/// available to test); if a trackpad turns out to fire many small-delta
/// events per gesture, magnitude-based scaling would need revisiting then.
export function setupZoom(container: HTMLElement, initialZoom: number, getEditorView: () => EditorView | undefined): void {
  scrollContainer = container;
  getView = getEditorView;
  applyZoom(initialZoom);
  container.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      applyZoom(currentZoom + (event.deltaY < 0 ? STEP : -STEP));
    },
    { passive: false }
  );

  // `Ctrl+=`/`Ctrl+-`/`Ctrl+0` themselves (the `&View` menu's accelerators,
  // lib.rs) are NOT wired up here — measured on real hardware (Linux/
  // WebKitGTK, `cargo tauri dev`) that they don't work at all on this
  // platform, by neither the native menu accelerator nor a JS `keydown`
  // listener on `window`: a control test confirmed `Ctrl+9` reaches a
  // `window` keydown listener normally, but `Ctrl+=`/`Ctrl+-`/`Ctrl+0`
  // never generate a DOM keydown event in the first place — WebKitGTK has
  // its own built-in page-zoom keybindings for exactly these three
  // combinations and consumes them before they reach either the window's
  // native accelerator group or the DOM. `&View`'s menu items remain fully
  // functional via mouse click (confirmed on the same real machine); only
  // the keyboard shortcut is affected. Windows/macOS are unverified — the
  // conflict is specific to WebKitGTK's own keybindings, not something
  // wry/Tauri registers, so it may well not reproduce there
  // (01_requirements.md 8章, 02_design.md 24章).
}

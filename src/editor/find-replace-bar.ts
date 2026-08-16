import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/core";
import type { EditorView } from "@milkdown/prose/view";
import {
  SearchQuery,
  setSearchState,
  getSearchState,
  getMatchHighlights,
  findNext,
  findPrev,
  replaceNext,
  replaceAll,
} from "prosemirror-search";

// Module-level singleton, same pattern as `insert-link-dialog.ts`'s
// `overlay` — but non-modal: `.find-replace-bar` floats over the editor
// without blocking clicks/scrolling in the document behind it
// (01_requirements.md 3.13節, 02_design.md 22.3節).
let bar: HTMLElement | null = null;
let findInput: HTMLInputElement | null = null;
let replaceInput: HTMLInputElement | null = null;
let replaceRow: HTMLElement | null = null;
let countLabel: HTMLElement | null = null;
let currentView: EditorView | null = null;

function buildQuery(): SearchQuery {
  return new SearchQuery({
    search: findInput?.value ?? "",
    replace: replaceInput?.value ?? "",
    caseSensitive: false,
  });
}

/// Reads the match count/position from the search plugin's own committed
/// state (`getSearchState`/`getMatchHighlights`) rather than recomputing a
/// query locally, so this can never disagree with what's actually
/// highlighted.
function updateCount(): void {
  if (!currentView || !countLabel) return;
  const view = currentView;
  const query = getSearchState(view.state)?.query;
  if (!query || !query.valid) {
    countLabel.textContent = "";
    return;
  }
  const matches = getMatchHighlights(view.state).find();
  if (matches.length === 0) {
    countLabel.textContent = "No results";
    return;
  }
  const { from, to } = view.state.selection;
  const index = matches.findIndex((match) => match.from === from && match.to === to);
  countLabel.textContent = index >= 0 ? `${index + 1}/${matches.length}` : `${matches.length}`;
}

/// Called on every keystroke in the find field. Rebuilds and commits the
/// query (refreshing the highlight decorations), then — for the find field
/// only, not the replace field — jumps to the nearest match at/after the
/// cursor, mirroring the incremental-search behavior of a browser's own
/// Ctrl+F (02_design.md 22.3節).
function applyQuery(jumpToMatch: boolean): void {
  if (!currentView) return;
  const view = currentView;
  const query = buildQuery();
  view.dispatch(setSearchState(view.state.tr, query));
  if (jumpToMatch && query.valid) {
    findNext(view.state, view.dispatch, view);
    scrollActiveMatchIntoView();
  }
  updateCount();
}

/// `findNext`/`findPrev`/`replaceNext` already call `tr.scrollIntoView()`
/// internally, but that only applies ProseMirror's own default scroll
/// margins — it has no idea `.find-replace-bar` (`position: fixed`, top
/// right) is floating over the document, so a match can end up scrolled to
/// right underneath it (02_design.md 22.3節, found by hand testing).
/// Re-scrolling the actual active-match element to the viewport's center
/// afterward sidesteps that: dead center is never under the bar regardless
/// of viewport size. `dispatch` updates the DOM synchronously, so the
/// decoration is already there to query.
function scrollActiveMatchIntoView(): void {
  if (!currentView) return;
  const active = currentView.dom.querySelector(".ProseMirror-active-search-match");
  active?.scrollIntoView({ block: "center", inline: "nearest" });
}

function runFindNext(): void {
  if (!currentView) return;
  findNext(currentView.state, currentView.dispatch, currentView);
  scrollActiveMatchIntoView();
  updateCount();
}

function runFindPrev(): void {
  if (!currentView) return;
  findPrev(currentView.state, currentView.dispatch, currentView);
  scrollActiveMatchIntoView();
  updateCount();
}

function runReplaceNext(): void {
  if (!currentView) return;
  replaceNext(currentView.state, currentView.dispatch);
  scrollActiveMatchIntoView();
  updateCount();
}

function runReplaceAll(): void {
  if (!currentView) return;
  replaceAll(currentView.state, currentView.dispatch);
  updateCount();
}

function teardownUI(): void {
  bar?.remove();
  bar = null;
  findInput = null;
  replaceInput = null;
  replaceRow = null;
  countLabel = null;
  currentView = null;
}

/// Escape / the bar's own × button: clears the *current* tab's search
/// query (removing its highlights) and returns focus to the editor, in
/// addition to tearing down the bar's DOM.
export function closeFindBar(): void {
  if (!bar) return;
  const view = currentView;
  teardownUI();
  if (view) {
    view.dispatch(setSearchState(view.state.tr, new SearchQuery({ search: "" })));
    view.focus();
  }
}

/// Called from `TabManager.onChange` (main.ts) when the active tab changes
/// while the bar is open. The bar has no per-tab state of its own — each
/// tab's own `EditorState` already carries its own search-plugin state
/// (02_design.md 22.2節) — so this only tears down the floating UI, without
/// dispatching anything: the tab being left keeps its highlights/query
/// exactly as they were (visible again on switching back), and the tab
/// being switched into is left alone rather than having its query
/// overwritten by a stale dispatch aimed at the tab just left.
export function dismissFindBarOnTabSwitch(): void {
  teardownUI();
}

function buildBar(withReplace: boolean): void {
  bar = document.createElement("div");
  bar.className = "find-replace-bar";
  bar.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeFindBar();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.target === replaceInput) {
        runReplaceNext();
        return;
      }
      if (event.shiftKey) runFindPrev();
      else runFindNext();
    }
  });

  const findRow = document.createElement("div");
  findRow.className = "find-replace-row";
  bar.appendChild(findRow);

  findInput = document.createElement("input");
  findInput.type = "text";
  findInput.className = "find-replace-input";
  findInput.placeholder = "Find";
  findInput.addEventListener("input", () => applyQuery(true));
  findRow.appendChild(findInput);

  countLabel = document.createElement("span");
  countLabel.className = "find-replace-count";
  findRow.appendChild(countLabel);

  const prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.title = "Previous match (Shift+Enter)";
  prevButton.textContent = "▲";
  prevButton.addEventListener("click", runFindPrev);
  findRow.appendChild(prevButton);

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.title = "Next match (Enter)";
  nextButton.textContent = "▼";
  nextButton.addEventListener("click", runFindNext);
  findRow.appendChild(nextButton);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.title = "Close (Esc)";
  closeButton.textContent = "×";
  closeButton.addEventListener("click", closeFindBar);
  findRow.appendChild(closeButton);

  replaceRow = document.createElement("div");
  replaceRow.className = "find-replace-row find-replace-replace-row";
  replaceRow.hidden = !withReplace;
  bar.appendChild(replaceRow);

  replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.className = "find-replace-input";
  replaceInput.placeholder = "Replace";
  replaceInput.addEventListener("input", () => applyQuery(false));
  replaceRow.appendChild(replaceInput);

  const replaceButton = document.createElement("button");
  replaceButton.type = "button";
  replaceButton.textContent = "Replace";
  replaceButton.addEventListener("click", runReplaceNext);
  replaceRow.appendChild(replaceButton);

  const replaceAllButton = document.createElement("button");
  replaceAllButton.type = "button";
  replaceAllButton.textContent = "Replace All";
  replaceAllButton.addEventListener("click", runReplaceAll);
  replaceRow.appendChild(replaceAllButton);

  document.body.appendChild(bar);
}

function show(ctx: Ctx, withReplace: boolean): void {
  currentView = ctx.get(editorViewCtx);

  if (bar) {
    if (withReplace && replaceRow) replaceRow.hidden = false;
    findInput?.focus();
    findInput?.select();
    return;
  }

  const { from, to, empty } = currentView.state.selection;
  const initialText = empty ? "" : currentView.state.doc.textBetween(from, to);

  buildBar(withReplace);
  findInput!.value = initialText;
  applyQuery(true);

  findInput!.focus();
  findInput!.select();
}

/// `Ctrl/Cmd+F` / Edit > Find... (01_requirements.md 3.13節).
export function showFindBar(ctx: Ctx): void {
  show(ctx, false);
}

/// `Ctrl/Cmd+H` / Edit > Replace... — same bar as `showFindBar`, with the
/// replace row revealed (01_requirements.md 3.13節).
export function showReplaceBar(ctx: Ctx): void {
  show(ctx, true);
}

import { invoke } from "@tauri-apps/api/core";
import type { Crepe } from "@milkdown/crepe";
import type { Ctx } from "@milkdown/ctx";
import { editorStateOptionsCtx, editorViewCtx, prosePluginsCtx, schemaCtx } from "@milkdown/core";
import { EditorState } from "@milkdown/prose/state";

import { buildEditorStateFromMarkdown } from "../editor/markdown-io/parser";
import { serializeDocWithHtmlTables } from "../editor/markdown-io/serializer";
import { showToast } from "../ui/toast";
import { showUnsavedChangesDialog } from "./unsaved-changes-dialog";
import type { TabSnapshot, TabState } from "./tab-state";
import { titleForTab } from "./tab-state";

interface OpenedFile {
  path: string;
  content: string;
}

type ChangeListener = (tabs: TabSnapshot[], activeId: string | null) => void;

/// Single source of truth for open tabs (02_design.md 12.2節). Owns the one
/// shared `Crepe`/`EditorView`: switching tabs swaps its `EditorState`
/// wholesale (12.1節) rather than creating a new editor instance per tab.
export class TabManager {
  private tabs: TabState[] = [];
  private activeId: string | null = null;
  private listeners = new Set<ChangeListener>();

  constructor(private crepe: Crepe) {}

  /// Wraps the shared view's transaction dispatch to keep the active tab's
  /// stored `EditorState` in sync and detect doc-changing edits as "dirty"
  /// (02_design.md 12.3節). Must be called once, after `setupEditor()`.
  init(): void {
    this.withCtx((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.setProps({
        dispatchTransaction: (tr) => {
          const newState = view.state.apply(tr);
          view.updateState(newState);
          const active = this.activeTab();
          if (!active) return;
          active.editorState = newState;
          // A transaction explicitly kept out of the undo stack (e.g.
          // plantuml-view.ts caching a re-rendered SVG on tab switch) is a
          // background side effect, not a user edit — don't flag the tab
          // dirty for it either.
          const isRealEdit = tr.docChanged && tr.getMeta("addToHistory") !== false;
          if (isRealEdit && !active.dirty) {
            active.dirty = true;
            this.emit();
          }
        },
      });
    });
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot, this.activeId);
  }

  snapshot(): TabSnapshot[] {
    return this.tabs.map((tab) => ({ id: tab.id, title: titleForTab(tab), dirty: tab.dirty }));
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getActiveFilePath(): string | null {
    return this.activeTab()?.filePath ?? null;
  }

  hasDirtyTabs(): boolean {
    return this.tabs.some((tab) => tab.dirty);
  }

  private activeTab(): TabState | undefined {
    return this.tabs.find((tab) => tab.id === this.activeId);
  }

  private withCtx<T>(fn: (ctx: Ctx) => T): T {
    let result!: T;
    this.crepe.editor.action((ctx) => {
      result = fn(ctx);
    });
    return result;
  }

  private emptyEditorState(ctx: Ctx): EditorState {
    const schema = ctx.get(schemaCtx);
    const overrideOptions = ctx.get(editorStateOptionsCtx);
    const plugins = ctx.get(prosePluginsCtx);
    // No `doc` given: EditorState.create() fills one in from the schema
    // itself (prosemirror-state's own default), giving a minimal valid
    // empty document without round-tripping through the markdown parser.
    return EditorState.create(overrideOptions({ schema, plugins }));
  }

  private pushTab(editorState: EditorState, filePath: string | null): TabState {
    const tab: TabState = { id: crypto.randomUUID(), filePath, dirty: false, editorState };
    this.tabs.push(tab);
    return tab;
  }

  /// Sets `activeId` and notifies listeners (`emit()`) *before* pushing the
  /// new/target tab's `EditorState` into the shared view. `view.updateState`
  /// synchronously (re)constructs a NodeView for every node in the incoming
  /// document — including any that read `getActiveFilePath()` at
  /// construction time (nodes/image-view.ts, to resolve a relative `src`) —
  /// so if `emit()` ran afterward instead, that read would still see
  /// whichever file path was active *before* this switch. Confirmed by hand:
  /// opening a file whose Markdown contains a relative image path resolved
  /// the image against the previously active tab's directory (or `null`),
  /// producing a broken image every time, until this ordering was fixed.
  private setActive(tab: TabState): void {
    this.activeId = tab.id;
    this.emit();
    this.withCtx((ctx) => ctx.get(editorViewCtx).updateState(tab.editorState));
  }

  createTab(): void {
    const tab = this.pushTab(this.withCtx((ctx) => this.emptyEditorState(ctx)), null);
    this.setActive(tab);
  }

  switchTo(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || tab.id === this.activeId) return;
    this.setActive(tab);
  }

  switchRelative(delta: 1 | -1): void {
    if (this.tabs.length === 0) return;
    const currentIndex = this.tabs.findIndex((t) => t.id === this.activeId);
    const nextIndex = ((currentIndex === -1 ? 0 : currentIndex) + delta + this.tabs.length) % this.tabs.length;
    this.switchTo(this.tabs[nextIndex]!.id);
  }

  async openFile(): Promise<void> {
    const opened = await invoke<OpenedFile | null>("open_file");
    if (!opened) return;
    this.loadFile(opened.path, opened.content);
  }

  /// Opens a file given directly by path rather than through the native
  /// Open dialog — the command-line-argument/single-instance startup path
  /// (02_design.md 21章, `take_startup_file_path`/`open-file-path` in
  /// main.ts). Shares `loadFile`'s reuse-a-blank-tab/already-open-tab
  /// logic, and the same error handling as a `restoreSession` entry that
  /// failed to reopen.
  ///
  /// Checks for an already-open tab *before* reading the file (`loadFile`
  /// does too, but only after a successful read): re-launching `mdyx` on a
  /// file that's already open shouldn't fail with a "could not open" toast
  /// just because that file was, say, deleted or unmounted since — the tab
  /// with its last-known content is right there and switching to it needs
  /// no read at all.
  async openPath(path: string): Promise<void> {
    const alreadyOpen = this.tabs.find((t) => t.filePath === path);
    if (alreadyOpen) {
      this.setActive(alreadyOpen);
      return;
    }
    try {
      const content = await invoke<string>("read_file", { path });
      this.loadFile(path, content);
    } catch {
      showToast(`Could not open "${path}" — it may have been moved or deleted.`, "warning");
    }
  }

  /// File > Open target selection (01_requirements.md 3.5節/12.2節): if
  /// `path` is already open in some tab, just switch to it — re-reading
  /// `content` over top would either discard unsaved edits in that tab or
  /// (harmlessly but pointlessly) duplicate it, and neither is useful when
  /// the file's contents are already right there. Otherwise, reuse the
  /// active tab only if it's a never-touched blank tab; otherwise open into
  /// a new tab (including when there are currently 0 tabs). `path` is
  /// always absolute here (the native Open dialog's result, or
  /// `first_file_arg`'s canonicalized startup-argument path, 02_design.md
  /// 21章) — the same as every `filePath` this compares against — so this
  /// is a plain string comparison, no normalization needed.
  private loadFile(path: string, content: string): void {
    const alreadyOpen = this.tabs.find((t) => t.filePath === path);
    if (alreadyOpen) {
      this.setActive(alreadyOpen);
      return;
    }

    const state =
      this.withCtx((ctx) => buildEditorStateFromMarkdown(ctx, content)) ??
      this.withCtx((ctx) => this.emptyEditorState(ctx));
    const active = this.activeTab();
    const reuseActive = active && active.filePath === null && !active.dirty;
    const tab = reuseActive ? active! : this.pushTab(state, path);
    if (reuseActive) {
      tab.editorState = state;
      tab.filePath = path;
    }
    this.setActive(tab);
  }

  private async writeToPath(tab: TabState, path: string): Promise<void> {
    const markdown = this.withCtx((ctx) => serializeDocWithHtmlTables(ctx, tab.editorState.doc));
    await invoke("save_file", { path, content: markdown });
    tab.filePath = path;
    tab.dirty = false;
    this.emit();
  }

  private async promptSaveAs(tab: TabState): Promise<boolean> {
    const markdown = this.withCtx((ctx) => serializeDocWithHtmlTables(ctx, tab.editorState.doc));
    const path = await invoke<string | null>("save_file_as", { content: markdown });
    if (!path) return false;
    tab.filePath = path;
    tab.dirty = false;
    this.emit();
    return true;
  }

  private async saveTab(tab: TabState): Promise<boolean> {
    if (tab.filePath) {
      await this.writeToPath(tab, tab.filePath);
      return true;
    }
    return this.promptSaveAs(tab);
  }

  async save(): Promise<boolean> {
    const tab = this.activeTab();
    return tab ? this.saveTab(tab) : false;
  }

  async saveAs(): Promise<boolean> {
    const tab = this.activeTab();
    return tab ? this.promptSaveAs(tab) : false;
  }

  closeActiveTab(): void {
    const tab = this.activeTab();
    if (tab) void this.closeTab(tab.id);
  }

  async closeTab(id: string): Promise<void> {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.dirty) {
      const choice = await showUnsavedChangesDialog(titleForTab(tab));
      if (choice === "cancel") return;
      if (choice === "save" && !(await this.saveTab(tab))) return;
    }
    this.removeTab(tab);
  }

  private removeTab(tab: TabState): void {
    const index = this.tabs.indexOf(tab);
    if (index === -1) return;
    this.tabs.splice(index, 1);
    if (tab.id === this.activeId) {
      // Prefer the previous tab, else the one now at the same index (the
      // former next tab), else none — 01_requirements.md 3.5節.
      const neighbor = this.tabs[index - 1] ?? this.tabs[index];
      if (neighbor) {
        this.setActive(neighbor);
      } else {
        this.activeId = null;
      }
    }
    this.emit();
  }

  /// Runs the unsaved-changes dialog for every dirty tab in turn (simplest
  /// option for "multiple dirty tabs on exit", 01_requirements.md 3.5節).
  /// Returns `false` if the user cancelled at any point, meaning the caller
  /// must not proceed with closing the app.
  async confirmAllDirtyTabs(): Promise<boolean> {
    for (const tab of [...this.tabs]) {
      if (!tab.dirty) continue;
      const choice = await showUnsavedChangesDialog(titleForTab(tab));
      if (choice === "cancel") return false;
      if (choice === "save" && !(await this.saveTab(tab))) return false;
    }
    return true;
  }

  /// Paths of tabs to persist across restarts, plus which one was active
  /// (index into that same list). Never-saved tabs are excluded — only a
  /// file path is remembered, never draft content (01_requirements.md
  /// 3.5節/6章).
  getSessionSnapshot(): { openTabs: string[]; activeIndex: number | null } {
    const openTabs = this.tabs.map((t) => t.filePath).filter((p): p is string => p !== null);
    const active = this.activeTab();
    const activeIndex = active?.filePath ? openTabs.indexOf(active.filePath) : -1;
    return { openTabs, activeIndex: activeIndex === -1 ? null : activeIndex };
  }

  async restoreSession(openTabs: string[], activeIndex: number | null): Promise<void> {
    for (const path of openTabs) {
      try {
        const content = await invoke<string>("read_file", { path });
        const state =
          this.withCtx((ctx) => buildEditorStateFromMarkdown(ctx, content)) ??
          this.withCtx((ctx) => this.emptyEditorState(ctx));
        this.pushTab(state, path);
      } catch {
        showToast(`Could not reopen "${path}" — it may have been moved or deleted.`, "warning");
      }
    }
    if (this.tabs.length === 0) return;
    const target = this.tabs[activeIndex ?? 0] ?? this.tabs[0]!;
    this.setActive(target);
    this.emit();
  }
}

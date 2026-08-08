import type { EditorState } from "@milkdown/prose/state";

/// A single open document. `TabManager` (tab-manager.ts) is the only place
/// that creates/mutates these; see 02_design.md 12.2節.
export interface TabState {
  id: string;
  /// `null` for a never-saved document ("Untitled").
  filePath: string | null;
  dirty: boolean;
  /// The full ProseMirror state (doc, selection, undo/redo history) for this
  /// tab, kept up to date even while another tab is active — only the
  /// active tab's state is ever loaded into the shared `EditorView`
  /// (02_design.md 12.1節).
  editorState: EditorState;
}

/// Read-only view of a `TabState` for UI rendering (tab-bar.ts), with the
/// display title already derived from `filePath` rather than left for every
/// caller to recompute.
export interface TabSnapshot {
  id: string;
  title: string;
  dirty: boolean;
}

export function titleForTab(tab: Pick<TabState, "filePath">): string {
  if (!tab.filePath) return "Untitled";
  const segments = tab.filePath.split(/[\\/]/);
  return segments[segments.length - 1] || tab.filePath;
}

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { editorViewCtx } from "@milkdown/core";

import { setupEditor } from "./editor/setup";
import { setupEditorContextMenu } from "./editor/context-menu";
import { TabManager } from "./tabs/tab-manager";
import { setupTabBar } from "./tabs/tab-bar";
import { setupToolbar, runInsertTable, runUndo, runRedo } from "./toolbar/tool-bar";
import { insertImageFromClipboardOrDialog } from "./clipboard/insert-image-dialog";
import { insertPlantumlNodeFromClipboard } from "./editor/nodes/plantuml";
import { showInsertLinkDialog } from "./editor/insert-link-dialog";
import { openSettingsPanel } from "./settings/settings-panel";
import { getConfig } from "./settings/config";

window.addEventListener("DOMContentLoaded", async () => {
  const editorRoot = document.querySelector<HTMLDivElement>("#editor-root");
  const toolbarRoot = document.querySelector<HTMLDivElement>("#toolbar-root");
  const tabBarRoot = document.querySelector<HTMLDivElement>("#tabbar-root");
  const emptyStateRoot = document.querySelector<HTMLDivElement>("#empty-state-root");
  if (!editorRoot || !toolbarRoot || !tabBarRoot || !emptyStateRoot) return;

  // `setupEditor` needs a way to resolve image paths against "whichever tab
  // is active", but it also has to run before `TabManager` exists (the
  // latter wraps the `Crepe` instance the former creates) — see
  // editor/setup.ts's `ActiveFilePathGetter` doc comment. `activeFilePath`
  // is kept in lockstep purely via `tabManager.onChange` below, never set
  // from anywhere else, so `TabManager` remains the single source of truth.
  let activeFilePath: string | null = null;
  // Same forward-reference pattern for the toolbar's toggle-button refresh
  // (Phase 10, 02_design.md 13.2節): `setupEditor` registers the plugin
  // that will call this on every editor update, but the real function only
  // exists once `setupToolbar` runs, further down.
  let refreshToolbar: (() => void) | undefined;
  const crepe = await setupEditor(
    editorRoot,
    () => activeFilePath,
    () => refreshToolbar?.()
  );

  const tabManager = new TabManager(crepe);
  tabManager.init();
  tabManager.onChange(() => {
    activeFilePath = tabManager.getActiveFilePath();
  });

  refreshToolbar = setupToolbar(toolbarRoot, crepe, () => activeFilePath);
  setupTabBar(tabBarRoot, emptyStateRoot, editorRoot, tabManager);
  setupEditorContextMenu(editorRoot, crepe);

  const config = await getConfig();
  await tabManager.restoreSession(config.openTabs, config.activeTabIndex);

  // Focus the editor so it's ready for typing immediately on startup
  // (01_requirements.md 3.9節, Phase 12) — only if a tab actually exists
  // (`getActiveId()` is null iff there are zero tabs, 3.5節's empty state,
  // which has no editor to focus).
  if (tabManager.getActiveId() !== null) {
    crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
  }

  await listen("menu-file-new-tab", () => tabManager.createTab());
  await listen("menu-file-open", () => void tabManager.openFile());
  await listen("menu-file-save", () => void tabManager.save());
  await listen("menu-file-save-as", () => void tabManager.saveAs());
  await listen("menu-edit-undo", () => runUndo(crepe));
  await listen("menu-edit-redo", () => runRedo(crepe));
  await listen("menu-insert-table", () => runInsertTable(crepe));
  await listen("menu-insert-image", () =>
    crepe.editor.action((ctx) => void insertImageFromClipboardOrDialog(ctx, () => activeFilePath))
  );
  await listen("menu-insert-plantuml", () =>
    crepe.editor.action((ctx) => void insertPlantumlNodeFromClipboard(ctx.get(editorViewCtx)))
  );
  await listen("menu-insert-link", () =>
    crepe.editor.action((ctx) => showInsertLinkDialog(ctx, () => activeFilePath))
  );
  await listen("menu-settings-plantuml-server", () => void openSettingsPanel());

  // Fired by Rust when the window's close button is clicked, or File > Exit
  // is chosen (both funnel into the same `WindowEvent::CloseRequested`
  // interception now — 02_design.md 12.6節) — resolve any unsaved tabs
  // first, then hand back to Rust to actually persist the session and exit.
  await listen("app-close-requested", () => void handleCloseRequested(tabManager));
});

async function handleCloseRequested(tabManager: TabManager): Promise<void> {
  const canProceed = await tabManager.confirmAllDirtyTabs();
  if (!canProceed) return;

  const { openTabs, activeIndex } = tabManager.getSessionSnapshot();
  await invoke("save_open_tabs", { openTabs, activeTabIndex: activeIndex });
  await invoke("confirm_close");
}

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { editorViewCtx } from "@milkdown/core";

import { setupEditor } from "./editor/setup";
import { setupEditorContextMenu } from "./editor/context-menu";
import { TabManager } from "./tabs/tab-manager";
import { titleForTab } from "./tabs/tab-state";
import { setupTabBar } from "./tabs/tab-bar";
import { setupToolbar, runInsertTable, runUndo, runRedo } from "./toolbar/tool-bar";
import { insertImageFromClipboardOrDialog } from "./clipboard/insert-image-dialog";
import { insertPlantumlNodeFromClipboard } from "./editor/nodes/plantuml";
import { insertMermaidNodeFromClipboard } from "./editor/nodes/mermaid";
import { showInsertLinkDialog } from "./editor/insert-link-dialog";
import { exportToHtmlFile, openExportInBrowser } from "./export/html-export";
import { openSettingsPanel } from "./settings/settings-panel";
import { getConfig } from "./settings/config";
import { applyEditorTheme } from "./theme/theme-style";
import { showToast } from "./ui/toast";

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
  await applyEditorTheme();

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

  // A file given on this process's own command line (02_design.md 21章) —
  // read *after* restoreSession so it opens as an additional tab rather
  // than replacing the restored ones, and *before* the focus block below
  // so whichever tab ends up active (the restored one, or this one) is the
  // one that gets focused.
  const startupFilePath = await invoke<string | null>("take_startup_file_path");
  if (startupFilePath) await tabManager.openPath(startupFilePath);

  // Focus the editor so it's ready for typing immediately on startup
  // (01_requirements.md 3.9節, Phase 12) — only if a tab actually exists
  // (`getActiveId()` is null iff there are zero tabs, 3.5節's empty state,
  // which has no editor to focus).
  if (tabManager.getActiveId() !== null) {
    crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
  }

  // A file given on a *second* launch's command line, forwarded here by
  // the already-running instance (`tauri_plugin_single_instance`'s
  // callback in lib.rs, 02_design.md 21章) — unlike the startup path
  // above, this instance is already fully running, so a plain event is
  // fine (no risk of firing before this listener exists).
  await listen<string>("open-file-path", (event) => void tabManager.openPath(event.payload));

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
  await listen("menu-insert-mermaid", () =>
    crepe.editor.action((ctx) => void insertMermaidNodeFromClipboard(ctx.get(editorViewCtx)))
  );
  await listen("menu-insert-link", () =>
    crepe.editor.action((ctx) => showInsertLinkDialog(ctx, () => activeFilePath))
  );
  await listen("menu-export-html", () =>
    crepe.editor.action((ctx) => void runExport(exportToHtmlFile(ctx, exportTitle(), activeFilePath)))
  );
  await listen("menu-export-open-browser", () =>
    crepe.editor.action((ctx) => void runExport(openExportInBrowser(ctx, exportTitle(), activeFilePath)))
  );
  await listen("menu-settings-plantuml-server", () => void openSettingsPanel());
  await listen("menu-settings-theme", () => void openSettingsPanel());

  // Export's HTML <title> and temp-file name (html-export.ts) both want a
  // plain "document name", not a full path — reuses the tab bar's own
  // "Untitled"/basename logic (tab-state.ts) and additionally strips the
  // `.md` extension, since neither an HTML <title> nor a downstream
  // "notes.html" file name should keep it.
  function exportTitle(): string {
    return titleForTab({ filePath: activeFilePath }).replace(/\.[^./\\]+$/, "");
  }

  // Fired by Rust when the window's close button is clicked, or File > Exit
  // is chosen (both funnel into the same `WindowEvent::CloseRequested`
  // interception now — 02_design.md 12.6節) — resolve any unsaved tabs
  // first, then hand back to Rust to actually persist the session and exit.
  await listen("app-close-requested", () => void handleCloseRequested(tabManager));
});

/// Export > Export to HTML/Open in Browser (html-export.ts) can fail for
/// reasons genuinely worth surfacing (a PlantUML re-render mid-export, the
/// temp/target file write) — unlike most other menu actions here, which
/// either can't fail in a user-actionable way or already show their own
/// toast internally.
async function runExport(work: Promise<void>): Promise<void> {
  try {
    await work;
  } catch (error) {
    showToast(`Export failed: ${String(error)}`, "error");
  }
}

async function handleCloseRequested(tabManager: TabManager): Promise<void> {
  const canProceed = await tabManager.confirmAllDirtyTabs();
  if (!canProceed) return;

  const { openTabs, activeIndex } = tabManager.getSessionSnapshot();
  await invoke("save_open_tabs", { openTabs, activeTabIndex: activeIndex });
  await invoke("confirm_close");
}

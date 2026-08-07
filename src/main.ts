import { listen } from "@tauri-apps/api/event";

import { setupEditor } from "./editor/setup";
import { FileManager } from "./file/file-manager";
import { setupToolbar, runInsertTable, runUndo, runRedo } from "./toolbar/tool-bar";

window.addEventListener("DOMContentLoaded", async () => {
  const editorRoot = document.querySelector<HTMLDivElement>("#editor-root");
  const toolbarRoot = document.querySelector<HTMLDivElement>("#toolbar-root");
  if (!editorRoot || !toolbarRoot) return;

  const crepe = await setupEditor(editorRoot);
  const fileManager = new FileManager(crepe);
  setupToolbar(toolbarRoot, crepe);

  await listen("menu-file-open", () => fileManager.open());
  await listen("menu-file-save", () => fileManager.save());
  await listen("menu-file-save-as", () => fileManager.saveAs());
  await listen("menu-edit-undo", () => runUndo(crepe));
  await listen("menu-edit-redo", () => runRedo(crepe));
  await listen("menu-insert-table", () => runInsertTable(crepe));
});

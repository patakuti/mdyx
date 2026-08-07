import { listen } from "@tauri-apps/api/event";

import { setupEditor } from "./editor/setup";
import { FileManager } from "./file/file-manager";

window.addEventListener("DOMContentLoaded", async () => {
  const root = document.querySelector<HTMLDivElement>("#editor-root");
  if (!root) return;

  const crepe = await setupEditor(root);
  const fileManager = new FileManager(crepe);

  await listen("menu-file-open", () => fileManager.open());
  await listen("menu-file-save", () => fileManager.save());
  await listen("menu-file-save-as", () => fileManager.saveAs());
});

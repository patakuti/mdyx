import { invoke } from "@tauri-apps/api/core";
import type { Crepe } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/utils";

import { getCurrentFilePath, setCurrentFilePath } from "./current-file";

interface OpenedFile {
  path: string;
  content: string;
}

export class FileManager {
  constructor(private crepe: Crepe) {}

  getCurrentPath(): string | null {
    return getCurrentFilePath();
  }

  async open(): Promise<void> {
    const opened = await invoke<OpenedFile | null>("open_file");
    if (!opened) return;

    this.crepe.editor.action(replaceAll(opened.content, true));
    setCurrentFilePath(opened.path);
  }

  async save(): Promise<void> {
    const currentPath = getCurrentFilePath();
    if (currentPath) {
      await invoke("save_file", {
        path: currentPath,
        content: this.crepe.getMarkdown(),
      });
      return;
    }
    await this.saveAs();
  }

  async saveAs(): Promise<void> {
    const path = await invoke<string | null>("save_file_as", {
      content: this.crepe.getMarkdown(),
    });
    if (path) {
      setCurrentFilePath(path);
    }
  }
}

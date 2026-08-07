import { invoke } from "@tauri-apps/api/core";
import type { Crepe } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/utils";

interface OpenedFile {
  path: string;
  content: string;
}

export class FileManager {
  private currentPath: string | null = null;

  constructor(private crepe: Crepe) {}

  async open(): Promise<void> {
    const opened = await invoke<OpenedFile | null>("open_file");
    if (!opened) return;

    this.crepe.editor.action(replaceAll(opened.content, true));
    this.currentPath = opened.path;
  }

  async save(): Promise<void> {
    if (this.currentPath) {
      await invoke("save_file", {
        path: this.currentPath,
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
      this.currentPath = path;
    }
  }
}

import { setupEditor } from "./editor/setup";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector<HTMLDivElement>("#editor-root");
  if (root) {
    setupEditor(root);
  }
});

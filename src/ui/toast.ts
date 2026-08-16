export type ToastLevel = "error" | "warning" | "info";

let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (container) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  document.body.appendChild(container);
  return container;
}

export function showToast(message: string, level: ToastLevel = "error"): void {
  const el = document.createElement("div");
  el.className = `toast toast-${level}`;
  el.textContent = message;
  getContainer().appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

const COPIED_PREVIEW_MAX_LENGTH = 60;

/// 01_requirements.md 5.7節: lets a copy action confirm what actually landed
/// on the clipboard. Only the first line is shown, truncated, since the
/// full content (a PlantUML/Mermaid source) can be arbitrarily long and
/// would overflow the toast.
export function showCopiedToast(label: string, content: string): void {
  const firstLine = content.trim().split("\n", 1)[0];
  const preview =
    firstLine.length > COPIED_PREVIEW_MAX_LENGTH
      ? firstLine.slice(0, COPIED_PREVIEW_MAX_LENGTH) + "…"
      : firstLine;
  showToast(`Copied ${label}: ${preview}`, "info");
}

export type ToastLevel = "error" | "warning";

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

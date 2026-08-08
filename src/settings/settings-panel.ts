import { getConfig, saveConfig } from "./config";
import { showToast } from "../ui/toast";

let overlay: HTMLElement | null = null;

function close(): void {
  overlay?.remove();
  overlay = null;
}

export async function openSettingsPanel(): Promise<void> {
  if (overlay) return;

  const config = await getConfig();

  overlay = document.createElement("div");
  overlay.className = "settings-overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  const panel = document.createElement("div");
  panel.className = "settings-panel";
  overlay.appendChild(panel);

  const title = document.createElement("h2");
  title.textContent = "Settings";
  panel.appendChild(title);

  const label = document.createElement("label");
  label.className = "settings-label";
  label.textContent = "PlantUML Server URL";
  panel.appendChild(label);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-input";
  input.value = config.plantumlServerUrl;
  panel.appendChild(input);

  const buttons = document.createElement("div");
  buttons.className = "settings-buttons";
  panel.appendChild(buttons);

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", close);
  buttons.appendChild(cancelButton);

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", () => {
    const url = input.value.trim();
    if (!url) {
      showToast("Server URL cannot be empty.", "error");
      return;
    }
    void saveConfig({ plantumlServerUrl: url }).then(close);
  });
  buttons.appendChild(saveButton);

  document.body.appendChild(overlay);
  input.focus();
}

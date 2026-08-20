import { invoke } from "@tauri-apps/api/core";

import { getConfig, savePlantumlServerUrl, saveTheme } from "./config";
import { showToast } from "../ui/toast";
import { applyEditorTheme, builtinThemeNames } from "../theme/theme-style";

const CUSTOM_THEME_VALUE = "custom";

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

  const themeLabel = document.createElement("label");
  themeLabel.className = "settings-label settings-section-label";
  themeLabel.textContent = "Theme";
  panel.appendChild(themeLabel);

  // Applies to both the live editor and Export to HTML/Open in Browser
  // (01_requirements.md 10.3節, 02_design.md 18.2節) — a built-in theme, or
  // "Custom..." to point at an arbitrary CSS file.
  const themeSelect = document.createElement("select");
  themeSelect.className = "settings-input";
  for (const name of builtinThemeNames()) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    themeSelect.appendChild(option);
  }
  const customOption = document.createElement("option");
  customOption.value = CUSTOM_THEME_VALUE;
  customOption.textContent = "Custom...";
  themeSelect.appendChild(customOption);
  themeSelect.value = builtinThemeNames().includes(config.theme) ? config.theme : CUSTOM_THEME_VALUE;
  panel.appendChild(themeSelect);

  const customCssRow = document.createElement("div");
  customCssRow.className = "insert-image-input-row";
  panel.appendChild(customCssRow);

  const customCssInput = document.createElement("input");
  customCssInput.type = "text";
  customCssInput.className = "settings-input";
  customCssInput.placeholder = "Path to a .css file";
  customCssInput.value = config.customCssPath ?? "";
  customCssRow.appendChild(customCssInput);

  const browseCssButton = document.createElement("button");
  browseCssButton.type = "button";
  browseCssButton.textContent = "Browse...";
  browseCssButton.addEventListener("click", () => {
    void invoke<string | null>("pick_css_file").then((picked) => {
      if (picked) customCssInput.value = picked;
    });
  });
  customCssRow.appendChild(browseCssButton);

  // Kept visible (not `hidden`) even when Theme isn't "Custom...": a saved
  // customCssPath survives switching to a built-in theme (save_theme's own
  // doc comment, config.rs), and hiding the row entirely gave no hint that
  // path was still there but inactive — confusing (01_requirements.md
  // 10.3節, 02_design.md 18.6節).
  function updateCustomCssEnabled(): void {
    const enabled = themeSelect.value === CUSTOM_THEME_VALUE;
    customCssInput.disabled = !enabled;
    browseCssButton.disabled = !enabled;
  }
  themeSelect.addEventListener("change", updateCustomCssEnabled);
  updateCustomCssEnabled();

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
    const theme = themeSelect.value;
    // Saved regardless of which theme is currently selected (config.rs's
    // `save_theme` doc comment) — switching back to "Custom..." later
    // remembers the last CSS file the user pointed at.
    const customCssPath = customCssInput.value.trim() || null;
    if (theme === CUSTOM_THEME_VALUE && !customCssPath) {
      showToast("Enter a path to a .css file, or choose a built-in theme.", "error");
      return;
    }
    void Promise.all([savePlantumlServerUrl(url), saveTheme(theme, customCssPath)]).then(async () => {
      await applyEditorTheme();
      close();
    });
  });
  buttons.appendChild(saveButton);

  document.body.appendChild(overlay);
  input.focus();
}

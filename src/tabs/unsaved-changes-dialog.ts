export type UnsavedChangesChoice = "save" | "discard" | "cancel";

/// Save / Don't Save / Cancel confirmation, shown before closing a dirty tab
/// or exiting with dirty tabs open (02_design.md 12.5節). Follows the same
/// fixed-overlay + centered-panel pattern as settings/settings-panel.ts.
export function showUnsavedChangesDialog(title: string): Promise<UnsavedChangesChoice> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "settings-overlay";

    const resolveAndClose = (choice: UnsavedChangesChoice) => {
      overlay.remove();
      resolve(choice);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) resolveAndClose("cancel");
    });

    const panel = document.createElement("div");
    panel.className = "settings-panel";
    overlay.appendChild(panel);

    const heading = document.createElement("h2");
    heading.textContent = "Unsaved Changes";
    panel.appendChild(heading);

    const message = document.createElement("p");
    message.className = "settings-label";
    message.textContent = `"${title}" has unsaved changes. Save before closing?`;
    panel.appendChild(message);

    const buttons = document.createElement("div");
    buttons.className = "settings-buttons";
    panel.appendChild(buttons);

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => resolveAndClose("cancel"));
    buttons.appendChild(cancelButton);

    const discardButton = document.createElement("button");
    discardButton.type = "button";
    discardButton.textContent = "Don't Save";
    discardButton.addEventListener("click", () => resolveAndClose("discard"));
    buttons.appendChild(discardButton);

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";
    saveButton.addEventListener("click", () => resolveAndClose("save"));
    buttons.appendChild(saveButton);

    document.body.appendChild(overlay);
    saveButton.focus();
  });
}

import type { TabManager } from "./tab-manager";

/// Renders the tab strip (menubar/toolbar ↔ editor, 02_design.md 12.9節),
/// shows/hides the empty-state placeholder when there are 0 tabs, and wires
/// up tab-level keyboard shortcuts for actions that aren't native menu items
/// — Close Tab/switch (01_requirements.md 3.5節). New Tab *is* a native
/// File menu item (like Open/Save), so its `CmdOrCtrl+N` accelerator is
/// handled there instead (lib.rs), the same way as the rest of the File
/// menu — see main.ts's `menu-file-new-tab` listener.
export function setupTabBar(
  tabBarRoot: HTMLElement,
  emptyStateRoot: HTMLElement,
  editorRoot: HTMLElement,
  tabManager: TabManager
): void {
  const render = (): void => {
    const tabs = tabManager.snapshot();
    const activeId = tabManager.getActiveId();

    tabBarRoot.replaceChildren();
    for (const tab of tabs) {
      const el = document.createElement("div");
      el.className = "tab" + (tab.id === activeId ? " tab-active" : "");
      el.addEventListener("mousedown", (event) => {
        // Don't let clicking a background tab steal focus/selection from
        // the editor before we've had a chance to swap its EditorState in.
        event.preventDefault();
        tabManager.switchTo(tab.id);
      });

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = (tab.dirty ? "● " : "") + tab.title;
      el.appendChild(title);

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "tab-close";
      closeButton.title = "Close tab";
      closeButton.textContent = "×";
      closeButton.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void tabManager.closeTab(tab.id);
      });
      el.appendChild(closeButton);

      tabBarRoot.appendChild(el);
    }

    const hasTabs = tabs.length > 0;
    editorRoot.style.display = hasTabs ? "block" : "none";
    emptyStateRoot.style.display = hasTabs ? "none" : "flex";
  };

  tabManager.onChange(render);
  render();

  window.addEventListener("keydown", (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;
    if (event.code === "KeyW") {
      event.preventDefault();
      tabManager.closeActiveTab();
    } else if (event.code === "Tab") {
      event.preventDefault();
      tabManager.switchRelative(event.shiftKey ? -1 : 1);
    }
  });
}

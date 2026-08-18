import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  plantumlServerUrl: string;
  /// Paths of tabs open at last exit, restored on startup (Phase 9,
  /// 02_design.md 12.7節). Never-saved tabs aren't included.
  openTabs: string[];
  /// Index into `openTabs` of the tab that was active, or `null`.
  activeTabIndex: number | null;
  /// Export/editor display theme (Phase 15, 01_requirements.md 10.3節): a
  /// built-in theme name (theme/theme-style.ts's `BUILTIN_THEMES`), or
  /// `"custom"` — in which case `customCssPath` names the CSS file to use.
  theme: string;
  customCssPath: string | null;
  /// Editor display zoom level as a percentage (Phase 21,
  /// 01_requirements.md 3.15節). Shared across all tabs, like `theme`.
  zoomLevel: number;
}

export function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
}

/// Each writable setting has its own command (see config.rs) rather than a
/// single generic "save the whole config" one, so that saving one setting
/// can never blank out another (e.g. Phase 9's `openTabs`) that the caller
/// didn't fetch and re-supply.
export function savePlantumlServerUrl(url: string): Promise<void> {
  return invoke("save_plantuml_server_url", { url });
}

export function saveTheme(theme: string, customCssPath: string | null): Promise<void> {
  return invoke("save_theme", { theme, customCssPath });
}

/// Called once at app exit (main.ts's `handleCloseRequested`), not on every
/// `Ctrl+Wheel` tick — see `editor/zoom.ts` and 02_design.md 24.4節.
export function saveZoomLevel(zoomLevel: number): Promise<void> {
  return invoke("save_zoom_level", { zoomLevel });
}

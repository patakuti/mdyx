use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

const CONFIG_FILE_NAME: &str = "config.json";
const DEFAULT_PLANTUML_SERVER_URL: &str = "https://www.plantuml.com/plantuml/svg/";
const DEFAULT_THEME: &str = "github";

fn default_plantuml_server_url() -> String {
    DEFAULT_PLANTUML_SERVER_URL.to_string()
}

fn default_theme() -> String {
    DEFAULT_THEME.to_string()
}

fn default_zoom_level() -> u32 {
    100
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_plantuml_server_url")]
    pub plantuml_server_url: String,
    #[serde(default)]
    pub last_opened_dir: Option<String>,
    /// Tabs open at last exit (file paths only — never-saved tabs aren't
    /// persisted), restored on startup. Phase 9, 02_design.md 12.7節.
    #[serde(default)]
    pub open_tabs: Vec<String>,
    /// Index into `open_tabs` of the tab that was active.
    #[serde(default)]
    pub active_tab_index: Option<usize>,
    /// Window geometry at last exit, restored on startup (Phase 12,
    /// 02_design.md 15.2節). `window_x`/`window_y` are the outer position
    /// (top-left corner including window decorations); `window_width`/
    /// `window_height` are the inner (content area) size, matching
    /// `tauri.conf.json`'s `width`/`height` semantics. `None` (e.g. first
    /// run) means "use the `tauri.conf.json` default".
    #[serde(default)]
    pub window_x: Option<i32>,
    #[serde(default)]
    pub window_y: Option<i32>,
    #[serde(default)]
    pub window_width: Option<u32>,
    #[serde(default)]
    pub window_height: Option<u32>,
    /// Export/editor display theme (01_requirements.md 10.3節, 02_design.md
    /// 18.2節). Either a built-in theme name (`"github"`) or `"custom"`, in
    /// which case `custom_css_path` names the CSS file to use instead.
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub custom_css_path: Option<String>,
    /// Directory to pre-select in the Theme setting's "Browse..." dialog
    /// (`pick_css_file`, file_io.rs), from the last CSS file successfully
    /// picked — its own memory, independent of `last_opened_dir` (Markdown
    /// files) and of Insert > Image/Link's Browse buttons (which instead
    /// derive their starting directory from the *active tab's* folder each
    /// time, file_io.rs's `pick_image_file`/`pick_link_file` doc comments).
    /// A CSS theme file has no natural relationship to whichever Markdown
    /// file happens to be open, so remembering where the user last went
    /// looking for one is the closer fit here (01_requirements.md 10.6節).
    #[serde(default)]
    pub last_css_dir: Option<String>,
    /// Editor display zoom level as a percentage (01_requirements.md
    /// 3.15節, 02_design.md 24.4節), shared across all tabs like `theme`
    /// rather than per-document. Saved once at app exit (`save_zoom_level`
    /// below), not on every `Ctrl+Wheel` tick — mirrors `window_x`/etc.
    /// above (saved once at `CloseRequested`) rather than `theme` (saved
    /// immediately on change), since a zoom level changes far more often
    /// than a theme choice.
    #[serde(default = "default_zoom_level")]
    pub zoom_level: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            plantuml_server_url: default_plantuml_server_url(),
            last_opened_dir: None,
            open_tabs: Vec::new(),
            active_tab_index: None,
            window_x: None,
            window_y: None,
            window_width: None,
            window_height: None,
            theme: default_theme(),
            custom_css_path: None,
            last_css_dir: None,
            zoom_level: default_zoom_level(),
        }
    }
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(CONFIG_FILE_NAME))
}

#[tauri::command]
pub fn get_config(app: tauri::AppHandle) -> Result<Config, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(Config::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Not exposed directly to the frontend (no `#[tauri::command]`): every
/// write goes through a dedicated command below instead, each of which
/// reads the current config, mutates only its own field(s), and writes the
/// whole struct back — so no writer ever clobbers a field it doesn't know
/// about (e.g. saving PlantUML settings must not blank out `open_tabs`).
pub fn save_config(app: tauri::AppHandle, config: Config) -> Result<(), String> {
    let path = config_path(&app)?;
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_plantuml_server_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let mut config = get_config(app.clone())?;
    config.plantuml_server_url = url;
    save_config(app, config)
}

/// `custom_css_path` is only meaningful when `theme == "custom"`, but is
/// still saved as given (not cleared) when `theme` is a built-in name — so
/// switching back to "Custom..." in the theme dropdown (settings-panel.ts)
/// remembers the last CSS file the user pointed at.
#[tauri::command]
pub fn save_theme(app: tauri::AppHandle, theme: String, custom_css_path: Option<String>) -> Result<(), String> {
    let mut config = get_config(app.clone())?;
    config.theme = theme;
    config.custom_css_path = custom_css_path;
    save_config(app, config)
}

/// Called once, right before the app actually exits (02_design.md 12.6節/
/// 12.7節), with the tab paths/active index gathered from the frontend's
/// live `TabManager` state.
#[tauri::command]
pub fn save_open_tabs(
    app: tauri::AppHandle,
    open_tabs: Vec<String>,
    active_tab_index: Option<usize>,
) -> Result<(), String> {
    let mut config = get_config(app.clone())?;
    config.open_tabs = open_tabs;
    config.active_tab_index = active_tab_index;
    save_config(app, config)
}

/// Called once, right before the app actually exits (main.ts's
/// `handleCloseRequested`, same point `save_open_tabs` is called from) —
/// not on every `Ctrl+Wheel` tick, to avoid a stream of IPC calls while the
/// user is actively zooming (02_design.md 24.4節).
#[tauri::command]
pub fn save_zoom_level(app: tauri::AppHandle, zoom_level: u32) -> Result<(), String> {
    let mut config = get_config(app.clone())?;
    config.zoom_level = zoom_level;
    save_config(app, config)
}

/// Not exposed as a `#[tauri::command]`: called directly from `lib.rs`'s
/// `CloseRequested` handler, right after the window geometry is read —
/// unlike `save_open_tabs`, there's no need to wait on the frontend's
/// unsaved-changes confirmation flow first (02_design.md 15.2節).
pub fn save_window_state(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let mut config = get_config(app.clone())?;
    config.window_x = Some(x);
    config.window_y = Some(y);
    config.window_width = Some(width);
    config.window_height = Some(height);
    save_config(app, config)
}

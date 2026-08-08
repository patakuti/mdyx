use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

const CONFIG_FILE_NAME: &str = "config.json";
const DEFAULT_PLANTUML_SERVER_URL: &str = "https://www.plantuml.com/plantuml/svg/";

fn default_plantuml_server_url() -> String {
    DEFAULT_PLANTUML_SERVER_URL.to_string()
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
}

impl Default for Config {
    fn default() -> Self {
        Self {
            plantuml_server_url: default_plantuml_server_url(),
            last_opened_dir: None,
            open_tabs: Vec::new(),
            active_tab_index: None,
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

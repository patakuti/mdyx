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
}

impl Default for Config {
    fn default() -> Self {
        Self {
            plantuml_server_url: default_plantuml_server_url(),
            last_opened_dir: None,
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

#[tauri::command]
pub fn save_config(app: tauri::AppHandle, config: Config) -> Result<(), String> {
    let path = config_path(&app)?;
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

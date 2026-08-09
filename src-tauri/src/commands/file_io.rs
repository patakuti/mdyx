use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

use super::config;
use crate::path_resolver::IMAGE_EXTENSIONS;

#[derive(Serialize)]
pub struct OpenedFile {
    path: String,
    content: String,
}

/// Directory to pre-select in the Open/Save As dialog, from the last
/// successfully opened/saved file's directory (01_requirements.md 3.4節).
/// Falls back to `None` (OS default) if unset or no longer present, e.g. a
/// removed/unmounted drive.
fn last_opened_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = config::get_config(app.clone()).ok()?.last_opened_dir?;
    let path = PathBuf::from(dir);
    path.is_dir().then_some(path)
}

fn remember_opened_dir(app: &tauri::AppHandle, file_path: &Path) {
    let Some(dir) = file_path.parent() else {
        return;
    };
    let Ok(mut cfg) = config::get_config(app.clone()) else {
        return;
    };
    cfg.last_opened_dir = Some(dir.to_string_lossy().into_owned());
    let _ = config::save_config(app.clone(), cfg);
}

#[tauri::command]
pub async fn open_file(app: tauri::AppHandle) -> Result<Option<OpenedFile>, String> {
    let mut dialog = app.dialog().file().add_filter("Markdown", &["md", "markdown"]);
    if let Some(dir) = last_opened_dir(&app) {
        dialog = dialog.set_directory(dir);
    }
    let file_path = dialog.blocking_pick_file();

    let Some(file_path) = file_path else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    remember_opened_dir(&app, &path);

    Ok(Some(OpenedFile {
        path: path.to_string_lossy().into_owned(),
        content,
    }))
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Reads a file by an already-known path, with no file picker dialog. Used
/// for session restore (02_design.md 12.7節): a path missing/unreadable
/// (moved or deleted since last exit) surfaces as an `Err`, which the
/// frontend turns into a per-file warning toast and skips that tab.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Backs the Insert > Image dialog's "Browse..." button (insert-image-
/// dialog.ts, 02_design.md 14.3節). Deliberately independent of
/// `last_opened_dir` (3.4節, Markdown files' own "last opened" memory):
/// `initial_dir` is the *active tab's* folder, passed in fresh by the
/// caller each time, and picking an image here never updates
/// `last_opened_dir` — the two "starting directory" concepts shouldn't mix.
#[tauri::command]
pub async fn pick_image_file(
    app: tauri::AppHandle,
    initial_dir: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().add_filter("Images", &IMAGE_EXTENSIONS);
    if let Some(dir) = initial_dir.map(PathBuf::from).filter(|d| d.is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    let file_path = dialog.blocking_pick_file();
    let Some(file_path) = file_path else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn save_file_as(app: tauri::AppHandle, content: String) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().add_filter("Markdown", &["md", "markdown"]);
    if let Some(dir) = last_opened_dir(&app) {
        dialog = dialog.set_directory(dir);
    }
    let file_path = dialog.blocking_save_file();

    let Some(file_path) = file_path else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    remember_opened_dir(&app, &path);

    Ok(Some(path.to_string_lossy().into_owned()))
}

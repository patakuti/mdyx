use std::time::{SystemTime, UNIX_EPOCH};

use tauri_plugin_dialog::DialogExt;

use super::file_io::last_opened_dir;

/// Export > Export to HTML... (01_requirements.md 10.2節, 02_design.md
/// 18.1節): the frontend has already serialized the current doc to a
/// complete, styled HTML document (export/html-export.ts) — this command
/// only owns the save dialog and the actual file write, mirroring
/// `save_file_as` in file_io.rs. Returns `None` if the dialog was cancelled.
#[tauri::command]
pub async fn export_html(app: tauri::AppHandle, content: String) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().add_filter("HTML", &["html", "htm"]);
    if let Some(dir) = last_opened_dir(&app) {
        dialog = dialog.set_directory(dir);
    }
    let file_path = dialog.blocking_save_file();

    let Some(file_path) = file_path else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn sanitize_file_name_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if cleaned.is_empty() {
        "untitled".to_string()
    } else {
        cleaned
    }
}

/// Export > Open in Browser (01_requirements.md 10.2節, 02_design.md
/// 18.1節): writes the same generated HTML to the OS temp directory instead
/// of prompting for a path, so the frontend can hand the returned path
/// straight to `openPath` (`@tauri-apps/plugin-opener`) for an immediate
/// preview. `base_name` (the active tab's file name, sans extension, or
/// "Untitled") is combined with a millisecond timestamp so repeated exports
/// — including from different tabs in the same session — never collide.
/// Nothing here ever deletes these files again: they're ordinary OS temp
/// files, left to the platform's own temp-directory cleanup, matching this
/// project's existing "no need for exact bookkeeping here" stance on
/// low-stakes housekeeping (01_requirements.md 6章).
#[tauri::command]
pub fn write_temp_html(content: String, base_name: String) -> Result<String, String> {
    let dir = std::env::temp_dir().join("mdyx-export");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let file_name = format!("{}-{millis}.html", sanitize_file_name_component(&base_name));
    let path = dir.join(file_name);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

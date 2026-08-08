use std::path::Path;

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::path_resolver;

fn base_dir_of(current_file_path: &Option<String>) -> Option<String> {
    current_file_path
        .as_deref()
        .and_then(|p| Path::new(p).parent())
        .map(|p| p.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClipboardPasteContent {
    #[serde(rename_all = "camelCase")]
    Path {
        path: String,
        is_relative: bool,
        out_of_scope: bool,
    },
    Binary,
    None,
}

/// Inspect the clipboard for an image paste: a text file path takes
/// priority over raw image binary, which is rejected per 01_requirements.md 5.2.
#[tauri::command]
pub fn read_clipboard_for_image(
    app: tauri::AppHandle,
    current_file_path: Option<String>,
) -> Result<ClipboardPasteContent, String> {
    let clipboard = app.clipboard();
    let base_dir = base_dir_of(&current_file_path);
    let home_dir = app.path().home_dir().ok();

    if let Ok(text) = clipboard.read_text() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            if let Some(resolved) = path_resolver::resolve_for_paste(
                trimmed,
                base_dir.as_deref(),
                home_dir.as_deref(),
            ) {
                return Ok(ClipboardPasteContent::Path {
                    path: resolved.path,
                    is_relative: resolved.is_relative,
                    out_of_scope: resolved.out_of_scope,
                });
            }
        }
    }

    if clipboard.read_image().is_ok() {
        return Ok(ClipboardPasteContent::Binary);
    }

    Ok(ClipboardPasteContent::None)
}

/// Resolve a possibly-relative image `src` (as stored in the document) to an
/// absolute filesystem path, for converting into a WebView-loadable URL via
/// `convertFileSrc` on the frontend (02_design.md 4.2).
#[tauri::command]
pub fn resolve_image_display_path(src: String, current_file_path: Option<String>) -> String {
    let base_dir = base_dir_of(&current_file_path);
    path_resolver::resolve_for_copy(&src, base_dir.as_deref())
}

#[tauri::command]
pub fn copy_image_path(
    app: tauri::AppHandle,
    src: String,
    current_file_path: Option<String>,
) -> Result<(), String> {
    let base_dir = base_dir_of(&current_file_path);
    let absolute = path_resolver::resolve_for_copy(&src, base_dir.as_deref());
    app.clipboard()
        .write_text(absolute)
        .map_err(|e| e.to_string())
}

/// Generic text write, used where the frontend already knows exactly what
/// to put on the clipboard (e.g. a PlantUML node's source, 01_requirements.md
/// 5.5) and doesn't need any path resolution first.
#[tauri::command]
pub fn write_clipboard_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

/// Generic text read, used by Insert > PlantUML Diagram to check whether the
/// clipboard already holds a PlantUML source before falling back to an
/// empty diagram (mirroring Insert > Image reading `read_clipboard_for_image`
/// for its own paste-from-clipboard behavior).
#[tauri::command]
pub fn read_clipboard_text(app: tauri::AppHandle) -> Option<String> {
    app.clipboard().read_text().ok()
}

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

/// Whether `candidate` starts with a URL scheme (`https://...`, `file://...`,
/// etc.), mirroring `image-paste.ts`'s `URL_SCHEME_PATTERN`
/// (`/^[a-z][a-z0-9+.-]*:/i`). A URL is used as an image `src` as-is — no
/// filesystem resolution, no relative-path/allowed-scope handling
/// (01_requirements.md 5.2節, Phase 11).
fn looks_like_url(candidate: &str) -> bool {
    let Some(colon_pos) = candidate.find(':') else {
        return false;
    };
    let scheme = &candidate[..colon_pos];
    !scheme.is_empty()
        && scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '.' || c == '-')
}

/// Shared by `read_clipboard_for_image` (candidate = clipboard text) and
/// `resolve_image_candidate` (candidate = arbitrary text already in hand —
/// text just extracted from a paste event, or typed into the Insert > Image
/// dialog, Phase 11) so both paths validate a path/URL identically.
fn resolve_candidate(
    candidate: &str,
    current_file_path: &Option<String>,
    app: &tauri::AppHandle,
) -> ClipboardPasteContent {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return ClipboardPasteContent::None;
    }
    if looks_like_url(trimmed) {
        return ClipboardPasteContent::Path {
            path: trimmed.to_string(),
            is_relative: false,
            out_of_scope: false,
        };
    }

    let base_dir = base_dir_of(current_file_path);
    let home_dir = app.path().home_dir().ok();
    match path_resolver::resolve_for_paste(trimmed, base_dir.as_deref(), home_dir.as_deref()) {
        Some(resolved) => ClipboardPasteContent::Path {
            path: resolved.path,
            is_relative: resolved.is_relative,
            out_of_scope: resolved.out_of_scope,
        },
        None => ClipboardPasteContent::None,
    }
}

/// Inspect the clipboard for an image paste: a text file path takes
/// priority over raw image binary, which is rejected per 01_requirements.md 5.2.
#[tauri::command]
pub fn read_clipboard_for_image(
    app: tauri::AppHandle,
    current_file_path: Option<String>,
) -> Result<ClipboardPasteContent, String> {
    let clipboard = app.clipboard();

    if let Ok(text) = clipboard.read_text() {
        let resolved = resolve_candidate(&text, &current_file_path, &app);
        if !matches!(resolved, ClipboardPasteContent::None) {
            return Ok(resolved);
        }
    }

    if clipboard.read_image().is_ok() {
        return Ok(ClipboardPasteContent::Binary);
    }

    Ok(ClipboardPasteContent::None)
}

/// Validates an explicit candidate (not read from the clipboard): text
/// already extracted from a paste event (general auto-detect paste,
/// image-clipboard-plugin.ts) or typed into the Insert > Image dialog
/// (insert-image-dialog.ts). `ClipboardPasteContent::Binary` is never
/// produced here — that variant only makes sense for the real system
/// clipboard (01_requirements.md 5.2節, Phase 11).
#[tauri::command]
pub fn resolve_image_candidate(
    app: tauri::AppHandle,
    candidate: String,
    current_file_path: Option<String>,
) -> ClipboardPasteContent {
    resolve_candidate(&candidate, &current_file_path, &app)
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

/// Writes both clipboard formats a copied table needs at once
/// (01_requirements.md 5.3節): `text/html` (always the table's HTML) and
/// `text/plain` (`arboard`'s `alt_text`; pipe syntax normally, or the same
/// HTML as text when the table has a merged cell that pipe syntax can't
/// represent — `plain_text` already reflects that choice by the time it
/// reaches here, table-clipboard-plugin.ts decides it). Routed through
/// `arboard` (not the WebView's `clipboardData.setData`) for the same
/// reason `write_clipboard_text` is: WebKitGTK mangles non-ASCII text
/// written via the JS clipboard API (02_design.md 10章).
#[tauri::command]
pub fn write_clipboard_table(app: tauri::AppHandle, html: String, plain_text: String) -> Result<(), String> {
    app.clipboard()
        .write_html(html, Some(plain_text))
        .map_err(|e| e.to_string())
}

/// Generic text read, used by Insert > PlantUML Diagram to check whether the
/// clipboard already holds a PlantUML source before falling back to an
/// empty diagram (mirroring Insert > Image reading `read_clipboard_for_image`
/// for its own paste-from-clipboard behavior).
#[tauri::command]
pub fn read_clipboard_text(app: tauri::AppHandle) -> Option<String> {
    app.clipboard().read_text().ok()
}

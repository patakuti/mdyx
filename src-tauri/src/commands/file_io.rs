use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
pub struct OpenedFile {
    path: String,
    content: String,
}

#[tauri::command]
pub async fn open_file(app: tauri::AppHandle) -> Result<Option<OpenedFile>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file();

    let Some(file_path) = file_path else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    Ok(Some(OpenedFile {
        path: path.to_string_lossy().into_owned(),
        content,
    }))
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_file_as(app: tauri::AppHandle, content: String) -> Result<Option<String>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_save_file();

    let Some(file_path) = file_path else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

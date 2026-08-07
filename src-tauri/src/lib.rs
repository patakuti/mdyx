mod commands;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::file_io::open_file,
            commands::file_io::save_file,
            commands::file_io::save_file_as,
        ])
        .setup(|app| {
            let open_item = MenuItemBuilder::with_id("file-open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save_item = MenuItemBuilder::with_id("file-save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let save_as_item = MenuItemBuilder::with_id("file-save-as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_item)
                .item(&save_item)
                .item(&save_as_item)
                .build()?;
            let menu = MenuBuilder::new(app).item(&file_menu).build()?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                let Some(window) = app.get_webview_window("main") else {
                    return;
                };
                let event_name = match event.id().as_ref() {
                    "file-open" => Some("menu-file-open"),
                    "file-save" => Some("menu-file-save"),
                    "file-save-as" => Some("menu-file-save-as"),
                    _ => None,
                };
                if let Some(event_name) = event_name {
                    let _ = window.emit(event_name, ());
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

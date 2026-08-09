mod commands;
mod path_resolver;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

/// Only reachable after the frontend has resolved any unsaved tabs and
/// persisted the session (main.ts's `handleCloseRequested`) — see the
/// `CloseRequested` interception in `run()` below (02_design.md 12.6節).
#[tauri::command]
fn confirm_close(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::file_io::open_file,
            commands::file_io::save_file,
            commands::file_io::save_file_as,
            commands::file_io::read_file,
            commands::file_io::pick_image_file,
            commands::clipboard::read_clipboard_for_image,
            commands::clipboard::resolve_image_candidate,
            commands::clipboard::copy_image_path,
            commands::clipboard::resolve_image_display_path,
            commands::clipboard::write_clipboard_text,
            commands::clipboard::write_clipboard_table,
            commands::clipboard::read_clipboard_text,
            commands::plantuml::render_plantuml,
            commands::config::get_config,
            commands::config::save_plantuml_server_url,
            commands::config::save_open_tabs,
            confirm_close,
        ])
        .setup(|app| {
            // Labels use `&` to mark a mnemonic (Alt+letter menu navigation,
            // e.g. Alt+F then O for File > Open) — `muda` (Tauri's native
            // menu backend) turns this into the platform's own underlined
            // access-key convention (01_requirements.md 3.2節, Phase 8).
            let new_tab_item = MenuItemBuilder::with_id("file-new-tab", "&New Tab")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let open_item = MenuItemBuilder::with_id("file-open", "&Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save_item = MenuItemBuilder::with_id("file-save", "&Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let save_as_item = MenuItemBuilder::with_id("file-save-as", "Save &As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let exit_item = MenuItemBuilder::with_id("file-exit", "E&xit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;
            let file_menu = SubmenuBuilder::new(app, "&File")
                .item(&new_tab_item)
                .item(&open_item)
                .item(&save_item)
                .item(&save_as_item)
                .separator()
                .item(&exit_item)
                .build()?;

            let undo_item = MenuItemBuilder::with_id("edit-undo", "&Undo").build(app)?;
            let redo_item = MenuItemBuilder::with_id("edit-redo", "&Redo").build(app)?;
            let edit_menu = SubmenuBuilder::new(app, "&Edit")
                .item(&undo_item)
                .item(&redo_item)
                .build()?;

            let insert_table_item = MenuItemBuilder::with_id("insert-table", "&Table")
                .accelerator("CmdOrCtrl+Alt+T")
                .build(app)?;
            let insert_image_item =
                MenuItemBuilder::with_id("insert-image", "&Image (from clipboard path)")
                    .accelerator("CmdOrCtrl+Shift+I")
                    .build(app)?;
            let insert_plantuml_item = MenuItemBuilder::with_id("insert-plantuml", "&PlantUML Diagram")
                .accelerator("CmdOrCtrl+Alt+U")
                .build(app)?;
            let insert_menu = SubmenuBuilder::new(app, "&Insert")
                .item(&insert_table_item)
                .item(&insert_image_item)
                .item(&insert_plantuml_item)
                .build()?;

            let settings_plantuml_server_item =
                MenuItemBuilder::with_id("settings-plantuml-server", "&PlantUML Server...")
                    .build(app)?;
            let settings_menu = SubmenuBuilder::new(app, "&Settings")
                .item(&settings_plantuml_server_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&insert_menu)
                .item(&settings_menu)
                .build()?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                let Some(window) = app.get_webview_window("main") else {
                    return;
                };
                if event.id().as_ref() == "file-exit" {
                    // Goes through the same `CloseRequested` interception as
                    // the window's own close button, instead of exiting
                    // directly, so File > Exit also confirms unsaved tabs
                    // (02_design.md 12.6節).
                    let _ = window.close();
                    return;
                }
                let event_name = match event.id().as_ref() {
                    "file-new-tab" => Some("menu-file-new-tab"),
                    "file-open" => Some("menu-file-open"),
                    "file-save" => Some("menu-file-save"),
                    "file-save-as" => Some("menu-file-save-as"),
                    "edit-undo" => Some("menu-edit-undo"),
                    "edit-redo" => Some("menu-edit-redo"),
                    "insert-table" => Some("menu-insert-table"),
                    "insert-image" => Some("menu-insert-image"),
                    "insert-plantuml" => Some("menu-insert-plantuml"),
                    "settings-plantuml-server" => Some("menu-settings-plantuml-server"),
                    _ => None,
                };
                if let Some(event_name) = event_name {
                    let _ = window.emit(event_name, ());
                }
            });

            // Block the window from closing immediately (whether from the
            // OS close button or File > Exit's `window.close()` above) and
            // hand off to the frontend instead: it may need to show one or
            // more unsaved-changes confirmations first (`TabManager`,
            // 02_design.md 12.5節/12.6節). The frontend calls the
            // `confirm_close` command once it's actually ready to exit.
            if let Some(window) = app.get_webview_window("main") {
                let emit_window = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = emit_window.emit("app-close-requested", ());
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

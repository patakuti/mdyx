mod commands;
mod path_resolver;

use std::sync::Mutex;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};

use commands::startup::{first_file_arg, StartupFilePath};

/// Only reachable after the frontend has resolved any unsaved tabs and
/// persisted the session (main.ts's `handleCloseRequested`) — see the
/// `CloseRequested` interception in `run()` below (02_design.md 12.6節).
#[tauri::command]
fn confirm_close(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Read before `Builder` takes over, so it reflects *this* process's own
    // launch arguments — the single-instance callback below only ever fires
    // for a *second* launch, never the first (02_design.md 21章).
    let startup_file_path = first_file_arg(std::env::args().skip(1));

    tauri::Builder::default()
        // Must be the very first plugin registered (Tauri's own
        // requirement): it needs to intercept a second launch before any
        // other plugin's setup runs, so that launch can exit immediately
        // instead of standing up a second, redundant app instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let Some(window) = app.get_webview_window("main") else {
                return;
            };
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            if let Some(path) = first_file_arg(argv.into_iter().skip(1)) {
                let _ = window.emit("open-file-path", path);
            }
        }))
        .manage(StartupFilePath(Mutex::new(startup_file_path)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::file_io::open_file,
            commands::file_io::save_file,
            commands::file_io::save_file_as,
            commands::file_io::read_file,
            commands::file_io::pick_image_file,
            commands::file_io::pick_link_file,
            commands::file_io::pick_css_file,
            commands::clipboard::read_clipboard_for_image,
            commands::clipboard::resolve_image_candidate,
            commands::clipboard::resolve_link_candidate,
            commands::clipboard::copy_image_path,
            commands::clipboard::resolve_image_display_path,
            commands::clipboard::write_clipboard_text,
            commands::clipboard::write_clipboard_table,
            commands::clipboard::read_clipboard_text,
            commands::plantuml::render_plantuml,
            commands::export::export_html,
            commands::export::write_temp_html,
            commands::config::get_config,
            commands::config::save_plantuml_server_url,
            commands::config::save_theme,
            commands::config::save_open_tabs,
            commands::config::save_zoom_level,
            commands::startup::take_startup_file_path,
            confirm_close,
        ])
        .setup(|app| {
            // Labels use `&` to mark a mnemonic (Alt+letter menu navigation,
            // e.g. Alt+F then O for File > Open) — `muda` (Tauri's native
            // menu backend) turns this into the platform's own underlined
            // access-key convention (01_requirements.md 3.2節, Phase 8).
            //
            // No `.accelerator(...)` on this item or several others below
            // (see each item's own comment): on Windows, WebView2 owns
            // keyboard focus and these never reach `muda`'s native
            // accelerator table, so key handling for them lives in
            // `main.ts`'s own `keydown` listener instead — the menu item
            // still works by click either way (01_requirements.md 3.17節,
            // 02_design.md 27章).
            let new_tab_item = MenuItemBuilder::with_id("file-new-tab", "&New Tab").build(app)?;
            let open_item = MenuItemBuilder::with_id("file-open", "&Open...").build(app)?;
            let save_item = MenuItemBuilder::with_id("file-save", "&Save").build(app)?;
            let save_as_item = MenuItemBuilder::with_id("file-save-as", "Save &As...").build(app)?;
            let exit_item = MenuItemBuilder::with_id("file-exit", "E&xit").build(app)?;
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
            // No accelerator (Windows/WebView2, see the File menu comment
            // above): handled by `main.ts`'s `keydown` listener instead.
            let find_item = MenuItemBuilder::with_id("edit-find", "&Find...").build(app)?;
            let replace_item = MenuItemBuilder::with_id("edit-replace", "&Replace...").build(app)?;
            // No accelerator: `Ctrl/Cmd+A` is left as the browser's native
            // contenteditable behavior (01_requirements.md 3.13節) — a
            // native menu accelerator would take priority over it even when
            // a dialog's own text input has focus (e.g. this find/replace
            // bar's own fields), selecting the whole document instead of
            // the focused input's text. This item exists purely so
            // "Select All" is discoverable from the menu; the shortcut
            // itself still works exactly as before.
            let select_all_item = MenuItemBuilder::with_id("edit-select-all", "Select &All").build(app)?;
            let edit_menu = SubmenuBuilder::new(app, "&Edit")
                .item(&undo_item)
                .item(&redo_item)
                .separator()
                .item(&find_item)
                .item(&replace_item)
                .separator()
                .item(&select_all_item)
                .build()?;

            // "=" (not "+"): muda's accelerator parser has no bare "+" key
            // outside the numpad ("NumpadAdd"/`Code::NumpadAdd`, confirmed by
            // reading `muda`'s `accelerator.rs`), so this instead binds the
            // physical "="/"+" key — the same key browsers themselves bind
            // Ctrl+Zoom-In to for exactly this reason (no Shift needed).
            let zoom_in_item = MenuItemBuilder::with_id("view-zoom-in", "Zoom &In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?;
            let zoom_out_item = MenuItemBuilder::with_id("view-zoom-out", "Zoom &Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?;
            let zoom_reset_item = MenuItemBuilder::with_id("view-zoom-reset", "&Reset Zoom")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;
            let view_menu = SubmenuBuilder::new(app, "&View")
                .item(&zoom_in_item)
                .item(&zoom_out_item)
                .item(&zoom_reset_item)
                .build()?;

            // No accelerators on any of these five (Windows/WebView2, see
            // the File menu comment above): Table/PlantUML/Mermaid are
            // handled by their existing toolbar buttons' `shortcut`
            // (`tool-bar.ts`'s `BUTTON_GROUPS`), Image/Link by `main.ts`'s
            // (Link: already existing) `keydown` listener.
            let insert_table_item = MenuItemBuilder::with_id("insert-table", "&Table").build(app)?;
            let insert_image_item =
                MenuItemBuilder::with_id("insert-image", "&Image (from clipboard path)").build(app)?;
            let insert_plantuml_item =
                MenuItemBuilder::with_id("insert-plantuml", "&PlantUML Diagram").build(app)?;
            let insert_mermaid_item =
                MenuItemBuilder::with_id("insert-mermaid", "&Mermaid Diagram").build(app)?;
            let insert_link_item = MenuItemBuilder::with_id("insert-link", "&Link...").build(app)?;
            let insert_menu = SubmenuBuilder::new(app, "&Insert")
                .item(&insert_table_item)
                .item(&insert_image_item)
                .item(&insert_plantuml_item)
                .item(&insert_mermaid_item)
                .item(&insert_link_item)
                .build()?;

            let export_html_item = MenuItemBuilder::with_id("export-html", "Export to &HTML...").build(app)?;
            let export_open_browser_item =
                MenuItemBuilder::with_id("export-open-browser", "&Open in Browser").build(app)?;
            let export_menu = SubmenuBuilder::new(app, "E&xport")
                .item(&export_html_item)
                .item(&export_open_browser_item)
                .build()?;

            let settings_plantuml_server_item =
                MenuItemBuilder::with_id("settings-plantuml-server", "&PlantUML Server...")
                    .build(app)?;
            let settings_theme_item = MenuItemBuilder::with_id("settings-theme", "&Theme...").build(app)?;
            let settings_menu = SubmenuBuilder::new(app, "&Settings")
                .item(&settings_plantuml_server_item)
                .item(&settings_theme_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&insert_menu)
                .item(&export_menu)
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
                    "edit-find" => Some("menu-edit-find"),
                    "edit-replace" => Some("menu-edit-replace"),
                    "edit-select-all" => Some("menu-edit-select-all"),
                    "view-zoom-in" => Some("menu-view-zoom-in"),
                    "view-zoom-out" => Some("menu-view-zoom-out"),
                    "view-zoom-reset" => Some("menu-view-zoom-reset"),
                    "insert-table" => Some("menu-insert-table"),
                    "insert-image" => Some("menu-insert-image"),
                    "insert-plantuml" => Some("menu-insert-plantuml"),
                    "insert-mermaid" => Some("menu-insert-mermaid"),
                    "insert-link" => Some("menu-insert-link"),
                    "export-html" => Some("menu-export-html"),
                    "export-open-browser" => Some("menu-export-open-browser"),
                    "settings-plantuml-server" => Some("menu-settings-plantuml-server"),
                    "settings-theme" => Some("menu-settings-theme"),
                    _ => None,
                };
                if let Some(event_name) = event_name {
                    let _ = window.emit(event_name, ());
                }
            });

            if let Some(window) = app.get_webview_window("main") {
                // Restore the window geometry saved at last exit (Phase 12,
                // 02_design.md 15.2節) before the window is ever shown
                // (`tauri.conf.json`'s `windows[0].visible` is `false`), so
                // there's no visible jump from the default position/size.
                // `window_x`/`window_y` were saved via `outer_position()`
                // (whole window, decorations included) and `window_width`/
                // `window_height` via `inner_size()` (content area, matching
                // `tauri.conf.json`'s own `width`/`height` semantics) —
                // restored the same way via `set_position`/`set_size`.
                if let Ok(config) = commands::config::get_config(app.handle().clone()) {
                    if let (Some(x), Some(y)) = (config.window_x, config.window_y) {
                        let _ = window.set_position(PhysicalPosition::new(x, y));
                    }
                    if let (Some(width), Some(height)) = (config.window_width, config.window_height) {
                        let _ = window.set_size(PhysicalSize::new(width, height));
                    }
                }
                let _ = window.show();

                // Block the window from closing immediately (whether from
                // the OS close button or File > Exit's `window.close()`
                // above) and hand off to the frontend instead: it may need
                // to show one or more unsaved-changes confirmations first
                // (`TabManager`, 02_design.md 12.5節/12.6節). The frontend
                // calls the `confirm_close` command once it's actually
                // ready to exit.
                let emit_window = window.clone();
                let geometry_window = window.clone();
                let geometry_app = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Captured here (not in the frontend's later
                        // `save_open_tabs` flow, 12.7節) since the geometry
                        // is already final the moment the user asked to
                        // close, and doesn't need to wait on any unsaved-
                        // changes confirmation (02_design.md 15.2節).
                        if let (Ok(position), Ok(size)) =
                            (geometry_window.outer_position(), geometry_window.inner_size())
                        {
                            let _ = commands::config::save_window_state(
                                geometry_app.clone(),
                                position.x,
                                position.y,
                                size.width,
                                size.height,
                            );
                        }
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

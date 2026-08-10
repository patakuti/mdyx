use std::path::PathBuf;
use std::sync::Mutex;

/// The file path (if any) passed as a command-line argument to *this*
/// process's own launch, held until the frontend claims it via
/// `take_startup_file_path` below (02_design.md 21章). A second launch's
/// argument instead reaches the frontend directly via the `open-file-path`
/// event (`tauri_plugin_single_instance`'s callback in `lib.rs`), since by
/// then the frontend is already up and listening.
pub struct StartupFilePath(pub Mutex<Option<String>>);

/// The first argument that doesn't look like a flag (doesn't start with
/// `-`), resolved to an absolute path and taken as the file to open at
/// startup. Shared between this process's own `std::env::args()`
/// (`lib.rs::run()`) and a second instance's `argv` (the
/// `tauri_plugin_single_instance` callback) — both are plain argument lists
/// with the executable path as element 0, which the caller is expected to
/// have already skipped.
///
/// Absolute, not the raw argument, because this ends up as a tab's
/// `filePath` (`TabManager.openPath`, main.ts) exactly like every other way
/// a tab gets one (the native Open dialog, session restore) — all already
/// absolute. Besides keeping that invariant (relative image paths inside
/// the document resolve against the file's directory, 01_requirements.md
/// 5.2節), it's what lets the frontend recognize "this file is already
/// open" by simple string equality against those other tabs' `filePath`,
/// regardless of what directory the shell launching `mdyx` happened to be
/// in. `std::fs::canonicalize` needs the file to exist, which it always
/// will here — a file to open was necessarily already there when the
/// launching shell resolved it against argv[0]'s own working directory. If
/// canonicalization still somehow fails (e.g. removed between shell
/// resolution and here), fall back to joining against this process's own
/// cwd — still absolute, just not symlink-resolved — rather than passing a
/// relative path through, which not just the tab-matching but also the
/// existing image/link relative-path resolution (`path_resolver.rs`) was
/// never built to expect from `filePath`.
pub fn first_file_arg(args: impl IntoIterator<Item = String>) -> Option<String> {
    let raw = args.into_iter().find(|arg| !arg.starts_with('-'))?;
    let absolute = std::fs::canonicalize(&raw).unwrap_or_else(|_| {
        std::env::current_dir()
            .map(|cwd| cwd.join(&raw))
            .unwrap_or_else(|_| PathBuf::from(&raw))
    });
    Some(absolute.to_string_lossy().into_owned())
}

/// Called once by the frontend (`main.ts`), after `restoreSession()` and
/// its own event listeners are already registered, to pick up a file path
/// given on the command line at first launch. Returns `None` on every call
/// after the first — the value is consumed (`.take()`) so it can't be
/// mistaken for a fresh request on a later, unrelated call.
///
/// A pull-based command rather than an `app.emit` at startup: `main.ts`'s
/// `listen()` calls happen after an `await` early in its DOMContentLoaded
/// handler, so an `emit` fired before that point would have no listener
/// yet and Tauri v2 doesn't buffer events — the notification would simply
/// be lost (same reasoning as `get_config`, which this mirrors).
#[tauri::command]
pub fn take_startup_file_path(state: tauri::State<StartupFilePath>) -> Option<String> {
    state.0.lock().unwrap().take()
}

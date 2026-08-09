use std::path::{Path, PathBuf};

/// Also used by `commands::file_io::pick_image_file` (Phase 11) to filter
/// the native file picker to the same set of extensions this module treats
/// as an image.
pub const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

pub struct ResolvedPath {
    pub path: String,
    pub is_relative: bool,
    pub out_of_scope: bool,
}

fn has_image_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// `~`/`~/...` isn't special to the filesystem (only shells expand it), so
/// `Path::is_file()` always reports "not found" for such paths otherwise.
/// `~username` (another user's home) is intentionally not handled, matching
/// 01_requirements.md 5.2's scope.
fn expand_home(candidate: &str, home_dir: Option<&Path>) -> PathBuf {
    let Some(home_dir) = home_dir else {
        return PathBuf::from(candidate);
    };
    match candidate.strip_prefix('~') {
        Some(rest) if rest.is_empty() => home_dir.to_path_buf(),
        Some(rest) => match rest.strip_prefix('/') {
            Some(rest) => home_dir.join(rest),
            None => PathBuf::from(candidate),
        },
        None => PathBuf::from(candidate),
    }
}

/// Resolve a clipboard text candidate into an image path for pasting.
/// Returns `None` if the candidate isn't an existing image file.
///
/// - `base_dir` is the directory of the currently open/saved Markdown file.
///   When `None` (unsaved document), the absolute path is used as-is; this
///   was the documented open question in 01_requirements.md 8, resolved here
///   in Phase 4.
/// - `home_dir` is used to expand a leading `~`/`~/` (Phase 8).
pub fn resolve_for_paste(
    candidate: &str,
    base_dir: Option<&str>,
    home_dir: Option<&Path>,
) -> Option<ResolvedPath> {
    let candidate_path = expand_home(candidate, home_dir);
    let candidate_path = candidate_path.as_path();
    if !candidate_path.is_file() || !has_image_extension(candidate_path) {
        return None;
    }

    let Some(base_dir) = base_dir else {
        return Some(ResolvedPath {
            path: candidate_path.to_string_lossy().into_owned(),
            is_relative: false,
            out_of_scope: false,
        });
    };

    match candidate_path.strip_prefix(base_dir) {
        Ok(rel) => Some(ResolvedPath {
            path: rel.to_string_lossy().into_owned(),
            is_relative: true,
            out_of_scope: false,
        }),
        Err(_) => Some(ResolvedPath {
            path: candidate_path.to_string_lossy().into_owned(),
            is_relative: false,
            out_of_scope: true,
        }),
    }
}

/// Resolve an image node's `src` (possibly relative) into an absolute path
/// for writing to the clipboard on copy.
pub fn resolve_for_copy(src: &str, base_dir: Option<&str>) -> String {
    let src_path = Path::new(src);
    if src_path.is_absolute() {
        return src_path.to_string_lossy().into_owned();
    }
    match base_dir {
        Some(base_dir) => Path::new(base_dir)
            .join(src_path)
            .to_string_lossy()
            .into_owned(),
        None => src.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempHome {
        dir: PathBuf,
    }

    impl TempHome {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("mdyx-path-resolver-test-{name}"));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("photo.png"), b"not a real png, just needs to exist").unwrap();
            Self { dir }
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn expands_tilde_slash_against_home_dir() {
        let home = TempHome::new("tilde-slash");
        let resolved = resolve_for_paste("~/photo.png", None, Some(&home.dir));
        assert!(resolved.is_some(), "~/photo.png should resolve when it exists under home_dir");
    }

    #[test]
    fn bare_tilde_paths_are_untouched_when_no_home_dir_is_known() {
        // Same behavior as before Phase 8: no home_dir means `~` is left as a
        // literal (nonexistent) path, not silently misinterpreted.
        let resolved = resolve_for_paste("~/photo.png", None, None);
        assert!(resolved.is_none());
    }

    #[test]
    fn other_users_home_tilde_is_not_expanded() {
        let home = TempHome::new("other-user");
        // `~otheruser/photo.png` must not resolve into this home_dir's
        // photo.png — that would silently point at the wrong file.
        let resolved = resolve_for_paste("~otheruser/photo.png", None, Some(&home.dir));
        assert!(resolved.is_none());
    }

    #[test]
    fn plain_absolute_paths_still_work_without_home_dir_involvement() {
        let home = TempHome::new("absolute");
        let absolute = home.dir.join("photo.png");
        let resolved = resolve_for_paste(absolute.to_str().unwrap(), None, Some(&home.dir));
        assert!(resolved.is_some());
    }
}

use std::path::Path;

const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

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

/// Resolve a clipboard text candidate into an image path for pasting.
/// Returns `None` if the candidate isn't an existing image file.
///
/// - `base_dir` is the directory of the currently open/saved Markdown file.
///   When `None` (unsaved document), the absolute path is used as-is; this
///   was the documented open question in 01_requirements.md 8, resolved here
///   in Phase 4.
pub fn resolve_for_paste(candidate: &str, base_dir: Option<&str>) -> Option<ResolvedPath> {
    let candidate_path = Path::new(candidate);
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

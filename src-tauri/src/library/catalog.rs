//! In-memory library catalog: imported folder roots and a flat map of every
//! photo discovered under them.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::folder::Folder;
use super::photo::{is_photo_extension, parse_variant, viewable_rank, Photo, PhotoFile};
use super::portable_path::make_portable_key;

#[derive(Default)]
pub struct LibraryCatalog {
    pub roots: Vec<Folder>,
    pub photos: HashMap<String, Photo>,
}

impl LibraryCatalog {
    /// Walk `root` recursively, register every photo found, and return the
    /// folder tree.
    pub fn import_root(
        &mut self,
        root_id: &str,
        name: &str,
        root: &Path,
    ) -> Result<Folder, String> {
        let mut folder = scan_tree(root, root, root_id, &mut self.photos)?;
        folder.name = name.to_string();
        self.roots.retain(|existing| existing.id != root_id);
        self.roots.push(folder.clone());
        Ok(folder)
    }

    /// Re-hydrate a previously imported root without recording it twice.
    pub fn rehydrate_root(&mut self, root_id: &str, name: &str, root: &Path) -> Result<(), String> {
        let mut folder = scan_tree(root, root, root_id, &mut self.photos)?;
        folder.name = name.to_string();
        self.roots.push(folder);
        Ok(())
    }

    pub fn add_unavailable_root(&mut self, root_id: &str, name: &str) {
        self.roots.push(Folder {
            id: root_id.to_string(),
            path: root_id.to_string(),
            name: name.to_string(),
            children: Vec::new(),
            available: false,
        });
    }

    /// Clear every imported root + photo entry. Used by the
    /// "Refresh imported folders" command before re-walking from
    /// disk so stale entries (deleted files) disappear.
    pub fn reset(&mut self) {
        self.roots.clear();
        self.photos.clear();
    }

    pub fn roots(&self) -> Vec<Folder> {
        self.roots.clone()
    }

    /// Like `photos_in_folder` but also includes photos in any nested
    /// subfolder when `recursive` is true.
    pub fn photos_in_folder_filtered(&self, folder: &Path, recursive: bool) -> Vec<Photo> {
        let mut groups: HashMap<String, Vec<&Photo>> = HashMap::new();
        for photo in self.photos.values() {
            let entry_path = Path::new(&photo.path);
            let parent = match entry_path.parent() {
                Some(p) => p,
                None => continue,
            };
            let in_scope = if recursive {
                parent == folder || parent.starts_with(folder)
            } else {
                parent == folder
            };
            if !in_scope {
                continue;
            }
            let stem = entry_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let (base_stem, _variant) = parse_variant(stem);
            let stem_key = if base_stem.is_empty() {
                photo.filename.to_ascii_lowercase()
            } else {
                base_stem.to_ascii_lowercase()
            };
            // Scope the sidecar group key by parent path so identically-named
            // files in different subfolders don't collapse into one entry.
            let key = format!("{}|{}", parent.to_string_lossy(), stem_key);
            groups.entry(key).or_default().push(photo);
        }

        let mut result: Vec<Photo> = groups.into_values().map(merge_sidecar_group).collect();
        result.sort_by(|a, b| a.filename.cmp(&b.filename));
        result
    }
}

/// Pick the primary file from a sidecar/variant group (preferring base
/// variant + viewable formats) and collect every member into the
/// returned `Photo`.
fn merge_sidecar_group(members: Vec<&Photo>) -> Photo {
    let mut files: Vec<PhotoFile> = members
        .iter()
        .map(|p| {
            let path = p.path.clone();
            let ext = lowercase_extension(&path);
            let stem = Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let (_base, variant) = parse_variant(stem);
            PhotoFile {
                path,
                extension: ext,
                variant,
            }
        })
        .collect();

    // Sort: base variant first; within a variant viewable formats first.
    files.sort_by(|a, b| {
        let av = if a.variant == "base" { 0 } else { 1 };
        let bv = if b.variant == "base" { 0 } else { 1 };
        av.cmp(&bv)
            .then_with(|| viewable_rank(&a.extension).cmp(&viewable_rank(&b.extension)))
            .then_with(|| a.variant.cmp(&b.variant))
            .then_with(|| a.extension.cmp(&b.extension))
    });

    let primary_path = files[0].path.clone();
    let primary_filename = Path::new(&primary_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();

    let mut extensions: Vec<String> = files
        .iter()
        .map(|f| f.extension.clone())
        .filter(|e| !e.is_empty())
        .collect();
    // Keep first-seen order (already viewable-first), drop duplicates.
    let mut seen = std::collections::HashSet::new();
    extensions.retain(|e| seen.insert(e.clone()));

    Photo {
        path: primary_path,
        filename: primary_filename,
        extensions,
        files,
    }
}

fn lowercase_extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

fn scan_tree(
    path: &Path,
    root: &Path,
    root_id: &str,
    photos: &mut HashMap<String, Photo>,
) -> Result<Folder, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut children = Vec::new();

    for entry in entries.flatten() {
        let entry_path = entry.path();
        // Skip dotfiles / hidden directories (e.g. `.DS_Store`, `.thumbs`).
        let is_hidden = entry
            .file_name()
            .to_str()
            .map(|n| n.starts_with('.'))
            .unwrap_or(false);
        if is_hidden {
            continue;
        }
        if entry_path.is_dir() {
            if let Ok(child) = scan_tree(&entry_path, root, root_id, photos) {
                children.push(child);
            }
        } else if entry_path.is_file() {
            if let Some(photo) = photo_from_path(&entry_path, root, root_id) {
                photos.insert(photo.path.clone(), photo);
            }
        }
    }

    children.sort_by(|a, b| a.name.cmp(&b.name));

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or_default())
        .to_string();
    let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
    let id = make_portable_key(root_id, relative)?;

    Ok(Folder {
        path: id.clone(),
        id,
        name,
        children,
        available: true,
    })
}

fn photo_from_path(entry_path: &Path, root: &Path, root_id: &str) -> Option<Photo> {
    let ext = entry_path
        .extension()
        .and_then(|e| e.to_str())?
        .to_ascii_lowercase();
    if !is_photo_extension(&ext) {
        return None;
    }
    let filename = entry_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    let relative = entry_path.strip_prefix(root).ok()?;
    let path = make_portable_key(root_id, relative).ok()?;
    Some(Photo {
        path,
        filename,
        extensions: vec![ext],
        files: Vec::new(),
    })
}

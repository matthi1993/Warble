//! In-memory library catalog: imported folder roots and a flat map of every
//! photo discovered under them.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::folder::Folder;
use super::photo::{is_photo_extension, viewable_rank, Photo};

#[derive(Default)]
pub struct LibraryCatalog {
    pub roots: Vec<Folder>,
    pub photos: HashMap<String, Photo>,
}

impl LibraryCatalog {
    /// Walk `root` recursively, register every photo found, and return the
    /// folder tree.
    pub fn import_root(&mut self, root: &Path) -> Result<Folder, String> {
        let folder = scan_tree(root, &mut self.photos)?;
        self.roots.push(folder.clone());
        Ok(folder)
    }

    /// Re-hydrate a previously imported root without recording it twice.
    pub fn rehydrate_root(&mut self, root: &Path) -> Result<(), String> {
        let folder = scan_tree(root, &mut self.photos)?;
        self.roots.push(folder);
        Ok(())
    }

    pub fn roots(&self) -> Vec<Folder> {
        self.roots.clone()
    }

    /// Return all photos directly inside `folder`, with sidecar files
    /// (same stem, different extension) merged into a single entry.
    pub fn photos_in_folder(&self, folder: &Path) -> Vec<Photo> {
        let mut groups: HashMap<String, Vec<&Photo>> = HashMap::new();
        for photo in self.photos.values() {
            let entry_path = Path::new(&photo.path);
            if entry_path.parent() != Some(folder) {
                continue;
            }
            let key = entry_path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_else(|| photo.filename.to_ascii_lowercase());
            groups.entry(key).or_default().push(photo);
        }

        let mut result: Vec<Photo> = groups.into_values().map(merge_sidecar_group).collect();
        result.sort_by(|a, b| a.filename.cmp(&b.filename));
        result
    }
}

/// Pick the primary file from a sidecar group (preferring viewable formats)
/// and collect every extension into a single `Photo`.
fn merge_sidecar_group(mut members: Vec<&Photo>) -> Photo {
    members.sort_by(|a, b| {
        let ea = lowercase_extension(&a.path);
        let eb = lowercase_extension(&b.path);
        viewable_rank(&ea)
            .cmp(&viewable_rank(&eb))
            .then_with(|| ea.cmp(&eb))
    });

    let mut extensions: Vec<String> = members
        .iter()
        .map(|p| lowercase_extension(&p.path))
        .filter(|e| !e.is_empty())
        .collect();
    extensions.dedup();

    let primary = members[0];
    Photo {
        path: primary.path.clone(),
        filename: primary.filename.clone(),
        extensions,
    }
}

fn lowercase_extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

fn scan_tree(path: &Path, photos: &mut HashMap<String, Photo>) -> Result<Folder, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut children = Vec::new();

    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            if let Ok(child) = scan_tree(&entry_path, photos) {
                children.push(child);
            }
        } else if entry_path.is_file() {
            if let Some(photo) = photo_from_path(&entry_path) {
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
    let id = path.to_string_lossy().into_owned();

    Ok(Folder {
        id,
        path: path.to_path_buf(),
        name,
        children,
    })
}

fn photo_from_path(entry_path: &Path) -> Option<Photo> {
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
    let path = entry_path.to_string_lossy().into_owned();
    Some(Photo {
        path,
        filename,
        extensions: vec![ext],
    })
}

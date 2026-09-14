//! In-memory library catalog: imported folder roots and a flat map of every
//! photo discovered under them.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::Path;
use std::time::Duration;

use super::folder::Folder;
use super::photo::{is_photo_extension, parse_variant, viewable_rank, Photo, PhotoFile};
use super::portable_path::{make_portable_key, split_portable_key};

#[derive(Default)]
pub struct LibraryCatalog {
    pub roots: Vec<Folder>,
    pub photos: HashMap<String, Photo>,
    indexed_folders: HashSet<String>,
}

impl LibraryCatalog {
    pub fn add_unavailable_root(&mut self, root_id: &str, name: &str) {
        self.roots.push(Folder {
            id: root_id.to_string(),
            path: root_id.to_string(),
            name: name.to_string(),
            children: Vec::new(),
            available: false,
            scanning: false,
        });
    }

    /// Show a connected root immediately while its background scan runs.
    pub fn add_pending_root(&mut self, root_id: &str, name: &str) {
        if let Some(root) = self
            .roots
            .iter_mut()
            .find(|root| root.id == root_id && root.available)
        {
            root.name = name.to_string();
            root.scanning = true;
            return;
        }
        self.remove_root(root_id);
        self.roots.push(Folder {
            id: root_id.to_string(),
            path: root_id.to_string(),
            name: name.to_string(),
            children: Vec::new(),
            available: true,
            scanning: true,
        });
    }

    pub fn set_folder_scanning(&mut self, folder_key: &str, scanning: bool) {
        set_folder_scanning(&mut self.roots, folder_key, scanning);
    }

    pub fn remove_root(&mut self, root_id: &str) {
        remove_photos_under_root(&mut self.photos, root_id);
        remove_keys_under(&mut self.indexed_folders, root_id);
        self.roots.retain(|root| root.id != root_id);
    }

    /// Atomically replace one root's directory tree while preserving image
    /// indexes for folders that still exist.
    pub fn merge_root_tree(&mut self, folder: Folder) {
        let root_id = folder.id.clone();
        let folder_ids = collect_folder_ids(&folder);
        remove_keys_under(&mut self.indexed_folders, &root_id);
        self.photos.retain(|path, _| {
            !path.starts_with(&format!("{root_id}/"))
                || Path::new(path)
                    .parent()
                    .and_then(Path::to_str)
                    .map(|parent| folder_ids.contains(parent))
                    .unwrap_or(false)
        });
        if let Some(existing) = self.roots.iter_mut().find(|root| root.id == folder.id) {
            *existing = folder;
        } else {
            self.roots.push(folder);
        }
    }

    /// Atomically replace a directory subtree without scanning its images.
    pub fn merge_subtree_tree(
        &mut self,
        folder_key: &str,
        replacement: Folder,
    ) -> Result<(), String> {
        let folder_ids = collect_folder_ids(&replacement);
        let mut replacement = Some(replacement);
        if !replace_folder(&mut self.roots, folder_key, &mut replacement) {
            return Err("folder disappeared while it was being refreshed".to_string());
        }
        let prefix = format!("{}/", folder_key.trim_end_matches('/'));
        remove_keys_under(&mut self.indexed_folders, folder_key);
        self.photos.retain(|path, _| {
            if !path.starts_with(&prefix) {
                return true;
            }
            Path::new(path)
                .parent()
                .and_then(Path::to_str)
                .map(|parent| folder_ids.contains(parent))
                .unwrap_or(false)
        });
        Ok(())
    }

    /// Replace images for one folder, optionally including its subtree.
    pub fn merge_folder_images(
        &mut self,
        folder_key: &str,
        photos: HashMap<String, Photo>,
        recursive: bool,
    ) {
        let folder_path = Path::new(folder_key);
        self.photos.retain(|key, _| {
            let Some(parent) = Path::new(key).parent() else {
                return true;
            };
            if recursive {
                parent != folder_path && !parent.starts_with(folder_path)
            } else {
                parent != folder_path
            }
        });
        self.photos.extend(photos);
        if recursive {
            let mut folder_ids = Vec::new();
            collect_keys_from_match(&self.roots, folder_key, &mut folder_ids);
            self.indexed_folders.extend(folder_ids);
        } else {
            self.indexed_folders.insert(folder_key.to_string());
        }
    }

    pub fn folder_images_indexed(&self, folder_key: &str, recursive: bool) -> bool {
        if !recursive {
            return self.indexed_folders.contains(folder_key);
        }
        let mut folder_ids = Vec::new();
        collect_keys_from_match(&self.roots, folder_key, &mut folder_ids);
        !folder_ids.is_empty()
            && folder_ids
                .iter()
                .all(|id| self.indexed_folders.contains(id))
    }

    pub fn roots(&self) -> Vec<Folder> {
        self.roots.clone()
    }

    /// Re-scan only the files beside one photo. Saving or deleting a variant
    /// cannot change the folder tree, so walking every nested directory is
    /// unnecessary and can take seconds on large or remote libraries.
    pub fn refresh_photo_parent(&mut self, photo_key: &str, root: &Path) -> Result<(), String> {
        let (root_id, relative) = split_portable_key(photo_key)?;
        let relative_parent = relative.parent().unwrap_or_else(|| Path::new(""));
        let parent_key = make_portable_key(root_id, relative_parent)?;
        let physical_parent = root.join(relative_parent);
        let entries = read_directory_with_retry(&physical_parent)?;
        let mut refreshed_photos = HashMap::new();

        for entry in entries {
            let entry_path = entry.path();
            let is_hidden = entry
                .file_name()
                .to_str()
                .map(|name| name.starts_with('.'))
                .unwrap_or(false);
            if is_hidden {
                continue;
            }
            let is_photo = entry_path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| is_photo_extension(&value.to_ascii_lowercase()))
                .unwrap_or(false);
            if !is_photo {
                continue;
            }
            let metadata = retry_io(
                || fs::metadata(&entry_path),
                || format!("could not read metadata for {}", entry_path.display()),
            )?;
            if metadata.is_file() {
                if let Some(photo) = photo_from_path(&entry_path, root, root_id) {
                    refreshed_photos.insert(photo.path.clone(), photo);
                }
            }
        }

        let parent_path = Path::new(&parent_key);
        self.photos
            .retain(|key, _| Path::new(key).parent() != Some(parent_path));
        self.photos.extend(refreshed_photos);
        self.indexed_folders.insert(parent_key);
        Ok(())
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

pub fn scan_root_tree(root_id: &str, name: &str, root: &Path) -> Result<Folder, String> {
    let mut folder = scan_directory_tree(root, root, root_id)?;
    folder.name = name.to_string();
    Ok(folder)
}

pub fn scan_subtree_tree(folder_key: &str, root: &Path) -> Result<Folder, String> {
    let (root_id, relative) = split_portable_key(folder_key)?;
    let physical_folder = root.join(relative);
    scan_directory_tree(&physical_folder, root, root_id)
}

pub fn scan_folder_images(
    folder_key: &str,
    root: &Path,
    recursive: bool,
) -> Result<HashMap<String, Photo>, String> {
    let (root_id, relative) = split_portable_key(folder_key)?;
    let physical_folder = root.join(relative);
    let mut photos = HashMap::new();
    scan_image_files(&physical_folder, root, root_id, recursive, &mut photos)?;
    Ok(photos)
}

fn scan_image_files(
    folder: &Path,
    root: &Path,
    root_id: &str,
    recursive: bool,
    photos: &mut HashMap<String, Photo>,
) -> Result<(), String> {
    let entries = read_directory_with_retry(folder)?;
    for entry in entries {
        let entry_path = entry.path();
        let is_hidden = entry
            .file_name()
            .to_str()
            .map(|name| name.starts_with('.'))
            .unwrap_or(false);
        if is_hidden {
            continue;
        }
        if recursive {
            let file_type = retry_io(
                || entry.file_type(),
                || format!("could not read file type for {}", entry_path.display()),
            )?;
            if file_type.is_dir() {
                scan_image_files(&entry_path, root, root_id, true, photos)?;
                continue;
            }
        }
        if photo_from_path(&entry_path, root, root_id).is_none() {
            continue;
        }
        let metadata = retry_io(
            || fs::metadata(&entry_path),
            || format!("could not read metadata for {}", entry_path.display()),
        )?;
        if metadata.is_file() {
            if let Some(photo) = photo_from_path(&entry_path, root, root_id) {
                photos.insert(photo.path.clone(), photo);
            }
        }
    }
    Ok(())
}

fn remove_photos_under_root(photos: &mut HashMap<String, Photo>, root_id: &str) {
    let prefix = format!("{root_id}/");
    photos.retain(|path, _| path != root_id && !path.starts_with(&prefix));
}

fn remove_keys_under(keys: &mut HashSet<String>, folder_key: &str) {
    let prefix = format!("{}/", folder_key.trim_end_matches('/'));
    keys.retain(|key| key != folder_key && !key.starts_with(&prefix));
}

fn replace_folder(folders: &mut [Folder], id: &str, replacement: &mut Option<Folder>) -> bool {
    for folder in folders {
        if folder.id == id {
            *folder = replacement
                .take()
                .expect("replacement is consumed only once");
            return true;
        }
        if replace_folder(&mut folder.children, id, replacement) {
            return true;
        }
    }
    false
}

fn set_folder_scanning(folders: &mut [Folder], id: &str, scanning: bool) -> bool {
    for folder in folders {
        if folder.id == id {
            folder.scanning = scanning;
            return true;
        }
        if set_folder_scanning(&mut folder.children, id, scanning) {
            return true;
        }
    }
    false
}

fn collect_folder_ids(folder: &Folder) -> std::collections::HashSet<String> {
    let mut ids = std::collections::HashSet::new();
    collect_folder_ids_into(folder, &mut ids);
    ids
}

fn collect_folder_ids_into(folder: &Folder, ids: &mut std::collections::HashSet<String>) {
    ids.insert(folder.id.clone());
    for child in &folder.children {
        collect_folder_ids_into(child, ids);
    }
}

fn collect_keys_from_match(folders: &[Folder], id: &str, keys: &mut Vec<String>) -> bool {
    for folder in folders {
        if folder.id == id {
            collect_folder_keys(folder, keys);
            return true;
        }
        if collect_keys_from_match(&folder.children, id, keys) {
            return true;
        }
    }
    false
}

fn collect_folder_keys(folder: &Folder, keys: &mut Vec<String>) {
    keys.push(folder.id.clone());
    for child in &folder.children {
        collect_folder_keys(child, keys);
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

fn scan_directory_tree(path: &Path, root: &Path, root_id: &str) -> Result<Folder, String> {
    // iOS file providers (including SMB shares exposed through Files) may
    // briefly return EIO/ESTALE-like failures while they materialise a remote
    // directory. Reading and collecting the whole directory in one retryable
    // operation prevents a transient iterator error from producing a
    // permanently incomplete tree.
    let entries = read_directory_with_retry(path)?;
    let mut children = Vec::new();

    for entry in entries {
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
        // `file_type` avoids fetching full metadata for every image while the
        // app only needs the directory structure.
        let file_type = retry_io(
            || entry.file_type(),
            || format!("could not read file type for {}", entry_path.display()),
        )?;
        if file_type.is_dir() {
            let child = scan_directory_tree(&entry_path, root, root_id)
                .map_err(|error| format!("could not scan {}: {error}", entry_path.display()))?;
            children.push(child);
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
        scanning: false,
    })
}

const IO_RETRY_DELAYS: [Duration; 4] = [
    Duration::from_millis(100),
    Duration::from_millis(250),
    Duration::from_millis(500),
    Duration::from_millis(1_000),
];

/// Retry filesystem operations that can fail transiently while an iOS file
/// provider fetches SMB directory metadata. The first attempt is immediate;
/// delays are only paid after a failure.
fn retry_io<T>(
    mut operation: impl FnMut() -> io::Result<T>,
    context: impl Fn() -> String,
) -> Result<T, String> {
    let mut last_error = None;
    for attempt in 0..=IO_RETRY_DELAYS.len() {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) => last_error = Some(error),
        }
        if let Some(delay) = IO_RETRY_DELAYS.get(attempt) {
            std::thread::sleep(*delay);
        }
    }
    let error = last_error.expect("retry loop always performs at least one operation");
    Err(format!("{}: {error}", context()))
}

fn read_directory_with_retry(path: &Path) -> Result<Vec<fs::DirEntry>, String> {
    retry_io(
        || fs::read_dir(path)?.collect::<io::Result<Vec<_>>>(),
        || format!("could not read directory {}", path.display()),
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refreshes_only_the_requested_folder_subtree() {
        let root_id = uuid::Uuid::new_v4().to_string();
        let root = std::env::temp_dir().join(format!("warble-refresh-{root_id}"));
        let first = root.join("First");
        let second = root.join("Second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fs::write(first.join("old.jpg"), []).unwrap();
        fs::write(second.join("untouched.jpg"), []).unwrap();

        let scanned = scan_root_tree(&root_id, "Photos", &root).unwrap();
        let mut catalog = LibraryCatalog::default();
        catalog.merge_root_tree(scanned);
        for key in [format!("{root_id}/First"), format!("{root_id}/Second")] {
            let photos = scan_folder_images(&key, &root, false).unwrap();
            catalog.merge_folder_images(&key, photos, false);
        }

        fs::remove_file(first.join("old.jpg")).unwrap();
        fs::write(first.join("new.jpg"), []).unwrap();
        let folder_key = format!("{root_id}/First");
        let photos = scan_folder_images(&folder_key, &root, false).unwrap();
        catalog.merge_folder_images(&folder_key, photos, false);

        assert!(!catalog
            .photos
            .contains_key(&format!("{root_id}/First/old.jpg")));
        assert!(catalog
            .photos
            .contains_key(&format!("{root_id}/First/new.jpg")));
        assert!(catalog
            .photos
            .contains_key(&format!("{root_id}/Second/untouched.jpg")));

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn does_not_silently_accept_a_partial_directory_scan() {
        use std::os::unix::fs::symlink;

        let root_id = uuid::Uuid::new_v4().to_string();
        let root = std::env::temp_dir().join(format!("warble-partial-scan-{root_id}"));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("visible.jpg"), []).unwrap();
        symlink(
            root.join("missing.jpg"),
            root.join("remote-placeholder.jpg"),
        )
        .unwrap();

        let error = match scan_folder_images(&root_id, &root, false) {
            Ok(_) => panic!("broken image entry should fail its folder scan"),
            Err(error) => error,
        };
        assert!(error.contains("remote-placeholder.jpg"));

        fs::remove_dir_all(root).unwrap();
    }
}

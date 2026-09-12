//! Tauri commands for writing and trashing photo variants.

use std::borrow::Cow;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::library::{is_photo_extension, parse_variant};

/// Write a rendered JPEG as `Name (Variant).jpg` next to the source photo.
/// The source path is a portable library key; the target is derived on the
/// backend so callers cannot escape the source directory.
#[tauri::command]
pub fn save_photo_variant(request: Request<'_>, state: State<'_, AppState>) -> Result<(), String> {
    let photo_path = decoded_header(&request, "photo-path")?;
    let variant = decoded_header(&request, "variant")?;
    validate_variant(&variant)?;
    let overwrite = request
        .headers()
        .get("overwrite")
        .and_then(|value| value.to_str().ok())
        == Some("true");
    let jpeg_bytes = match request.body() {
        InvokeBody::Raw(bytes) => Cow::Borrowed(bytes.as_slice()),
        InvokeBody::Json(serde_json::Value::Array(values)) => {
            let mut bytes = Vec::with_capacity(values.len());
            for value in values {
                let byte = value
                    .as_u64()
                    .filter(|value| *value <= u8::MAX as u64)
                    .ok_or_else(|| "rendered JPEG contains invalid byte data".to_string())?;
                bytes.push(byte as u8);
            }
            Cow::Owned(bytes)
        }
        _ => return Err("rendered JPEG must be sent as binary data".to_string()),
    };
    if jpeg_bytes.is_empty() {
        return Err("rendered JPEG is empty".to_string());
    }

    let source = state.resolve_library_path(&photo_path)?;
    let target = variant_target(&source, &variant)?;

    if overwrite {
        fs::write(&target, jpeg_bytes.as_ref())
            .map_err(|e| format!("failed to write variant: {e}"))?;
        return Ok(());
    }

    let mut file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(format!("variant already exists: {}", target.display()));
        }
        Err(error) => return Err(format!("failed to create variant: {error}")),
    };
    file.write_all(jpeg_bytes.as_ref())
        .map_err(|e| format!("failed to write variant: {e}"))?;
    Ok(())
}

/// Check for a name collision before the frontend performs an expensive
/// full-resolution render and transfers the resulting JPEG.
#[tauri::command]
pub fn photo_variant_exists(
    photo_path: String,
    variant: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    validate_variant(&variant)?;
    let source = state.resolve_library_path(&photo_path)?;
    Ok(variant_target(&source, &variant)?.exists())
}

fn validate_variant(variant: &str) -> Result<(), String> {
    if variant.is_empty()
        || !variant
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_'))
    {
        return Err("invalid variant name".to_string());
    }
    Ok(())
}

fn variant_target(source: &Path, variant: &str) -> Result<PathBuf, String> {
    let parent = source
        .parent()
        .ok_or_else(|| "source photo has no parent directory".to_string())?;
    let source_stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| "source photo has no valid filename".to_string())?;
    let (base_stem, _) = parse_variant(source_stem);
    Ok(parent.join(format!("{base_stem} ({variant}).jpg")))
}

fn decoded_header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let encoded = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("missing {name} header"))?
        .to_str()
        .map_err(|_| format!("invalid {name} header"))?;
    percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|_| format!("invalid UTF-8 in {name} header"))
}

/// Move the currently displayed photo file to the operating system's bin.
/// Unlike `trash_photo_group`, this removes exactly one JPEG/RAW/other
/// recognised image file and leaves every sibling variant untouched.
#[tauri::command]
pub async fn trash_photo_variant(
    photo_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let source = state.resolve_library_path(&photo_path)?;
    if !is_photo_extension(&lowercase_extension(&source)) {
        return Err("the selected file is not a recognised image".to_string());
    }
    move_paths_to_bin(vec![source], app).await
}

/// Move every recognised image file in this sidecar group to the bin. This
/// includes RAW files, the base JPEG, and every parenthesised variant, while
/// leaving unrelated files in the directory untouched.
#[tauri::command]
pub async fn trash_photo_group(
    photo_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let source = state.resolve_library_path(&photo_path)?;
    let parent = source
        .parent()
        .ok_or_else(|| "photo has no parent directory".to_string())?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "photo has no valid filename".to_string())?;
    let (base_stem, _) = parse_variant(stem);

    let mut paths = Vec::new();
    for entry in fs::read_dir(parent).map_err(|e| format!("failed to read photo folder: {e}"))? {
        let entry = entry.map_err(|e| format!("failed to read photo folder entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() || !is_photo_extension(&lowercase_extension(&path)) {
            continue;
        }
        let Some(candidate_stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        let (candidate_base, _) = parse_variant(candidate_stem);
        if candidate_base.eq_ignore_ascii_case(&base_stem) {
            paths.push(path);
        }
    }
    if paths.is_empty() {
        return Err("no files were found for this photo".to_string());
    }
    let count = paths.len();
    move_paths_to_bin(paths, app).await?;
    Ok(count)
}

fn lowercase_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

async fn move_paths_to_bin(paths: Vec<PathBuf>, app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let _ = app;
        return tauri::async_runtime::spawn_blocking(move || trash::delete_all(paths))
            .await
            .map_err(|e| format!("failed to run trash operation: {e}"))?
            .map_err(|e| format!("failed to move photo to the bin: {e}"));
    }

    #[cfg(target_os = "ios")]
    {
        let paths = paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        return tauri_plugin_folder_access::trash_files(&app, &paths);
    }

    #[cfg(target_os = "android")]
    {
        let _ = (paths, app);
        Err("Moving photos to the bin is unavailable on Android".to_string())
    }
}

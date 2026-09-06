use std::path::{Component, Path, PathBuf};

/// Build an OS-independent library key. The root itself is represented by its
/// UUID; descendants use forward-slash-separated relative components.
pub fn make_portable_key(root_id: &str, relative: &Path) -> Result<String, String> {
    validate_root_id(root_id)?;
    let mut parts = vec![root_id.to_string()];
    for component in relative.components() {
        match component {
            Component::Normal(value) => {
                let value = value
                    .to_str()
                    .ok_or_else(|| "photo path is not valid UTF-8".to_string())?;
                if value.is_empty() {
                    return Err("photo path contains an empty component".to_string());
                }
                parts.push(value.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("photo path must be relative and may not contain '..'".to_string())
            }
        }
    }
    Ok(parts.join("/"))
}

/// Split and validate a portable key into its root UUID and safe relative path.
pub fn split_portable_key(key: &str) -> Result<(&str, PathBuf), String> {
    let (root_id, relative) = key.split_once('/').unwrap_or((key, ""));
    validate_root_id(root_id)?;
    let relative = Path::new(relative);
    // Rebuilding validates all components and catches absolute / traversal keys.
    let rebuilt = make_portable_key(root_id, relative)?;
    if rebuilt != key.trim_end_matches('/') {
        return Err("invalid portable photo path".to_string());
    }
    Ok((root_id, relative.to_path_buf()))
}

fn validate_root_id(root_id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(root_id)
        .map(|_| ())
        .map_err(|_| "path does not start with a valid media-root UUID".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = "123e4567-e89b-12d3-a456-426614174000";

    #[test]
    fn round_trips_portable_key() {
        let key = make_portable_key(ROOT, Path::new("Trips/Italy/a.jpg")).unwrap();
        assert_eq!(key, format!("{ROOT}/Trips/Italy/a.jpg"));
        assert_eq!(
            split_portable_key(&key).unwrap().1,
            Path::new("Trips/Italy/a.jpg")
        );
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        assert!(make_portable_key(ROOT, Path::new("../secret.jpg")).is_err());
        assert!(make_portable_key(ROOT, Path::new("/secret.jpg")).is_err());
    }
}

use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub path: String,
    pub name: String,
    pub children: Vec<Folder>,
    pub available: bool,
    /// True while a background scan is building this root's tree.
    #[serde(default)]
    pub scanning: bool,
}

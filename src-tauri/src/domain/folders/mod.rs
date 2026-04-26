use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub path: PathBuf,
    pub name: String,
    pub children: Vec<Folder>,
}

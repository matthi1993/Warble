use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub path: String,
    pub name: String,
    pub children: Vec<Folder>,
    pub available: bool,
}

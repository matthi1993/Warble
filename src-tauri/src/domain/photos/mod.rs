use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Photo {
    pub path: String,
    pub filename: String,
    /// All file extensions (lowercase, no dot) belonging to the same stem in
    /// the same folder. For a single-file photo this contains exactly one
    /// entry. For sidecar pairs (e.g. `IMG_0001.jpg` + `IMG_0001.RAF`) it
    /// contains every related extension, ordered with viewable formats first.
    #[serde(default)]
    pub extensions: Vec<String>,
}

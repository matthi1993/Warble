//! Library domain: imported folders, photos, and the catalog that links
//! them together. Persistence lives in `repository`.

mod catalog;
mod folder;
mod photo;
mod repository;

pub use catalog::LibraryCatalog;
pub use folder::Folder;
pub use photo::Photo;
pub use repository::LibraryRepository;

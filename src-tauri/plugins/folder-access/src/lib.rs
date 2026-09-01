use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderGrant {
    pub path: String,
    pub bookmark: String,
}

#[derive(Deserialize)]
struct PickResponse {
    folders: Vec<FolderGrant>,
}

#[derive(Deserialize)]
struct ResolveResponse {
    path: String,
}

#[derive(Deserialize)]
struct LibraryResponse {
    selection: Option<FolderGrant>,
}

struct FolderAccess<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("folder-access")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            {
                tauri::ios_plugin_binding!(init_plugin_folder_access);
                let handle = api.register_ios_plugin(init_plugin_folder_access)?;
                app.manage(FolderAccess(handle));
            }
            Ok(())
        })
        .build()
}

pub fn pick_folders<R: Runtime>(
    app: &AppHandle<R>,
    multiple: bool,
) -> Result<Vec<FolderGrant>, String> {
    app.state::<FolderAccess<R>>()
        .0
        .run_mobile_plugin::<PickResponse>("pickFolders", serde_payload(multiple))
        .map(|response| response.folders)
        .map_err(|e| e.to_string())
}

pub fn resolve_bookmark<R: Runtime>(app: &AppHandle<R>, bookmark: &str) -> Result<String, String> {
    app.state::<FolderAccess<R>>()
        .0
        .run_mobile_plugin::<ResolveResponse>("resolveBookmark", BookmarkPayload { bookmark })
        .map(|response| response.path)
        .map_err(|e| e.to_string())
}

pub fn pick_library<R: Runtime>(app: &AppHandle<R>) -> Result<Option<FolderGrant>, String> {
    app.state::<FolderAccess<R>>()
        .0
        .run_mobile_plugin::<LibraryResponse>("pickLibrary", ())
        .map(|response| response.selection)
        .map_err(|e| e.to_string())
}

pub fn export_library<R: Runtime>(
    app: &AppHandle<R>,
    source: &str,
) -> Result<Option<FolderGrant>, String> {
    app.state::<FolderAccess<R>>()
        .0
        .run_mobile_plugin::<LibraryResponse>("exportLibrary", ExportPayload { source })
        .map(|response| response.selection)
        .map_err(|e| e.to_string())
}

pub fn replace_library<R: Runtime>(
    app: &AppHandle<R>,
    source: &str,
    destination: &str,
) -> Result<(), String> {
    app.state::<FolderAccess<R>>()
        .0
        .run_mobile_plugin::<()>(
            "replaceLibrary",
            ReplacePayload {
                source,
                destination,
            },
        )
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct PickPayload {
    multiple: bool,
}
fn serde_payload(multiple: bool) -> PickPayload {
    PickPayload { multiple }
}

#[derive(Serialize)]
struct BookmarkPayload<'a> {
    bookmark: &'a str,
}

#[derive(Serialize)]
struct ReplacePayload<'a> {
    source: &'a str,
    destination: &'a str,
}

#[derive(Serialize)]
struct ExportPayload<'a> {
    source: &'a str,
}

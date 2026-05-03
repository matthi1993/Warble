//! Native macOS application menu, with a "Cache" submenu that exposes the
//! user-tunable LRU bounds defined in [`crate::settings`].
//!
//! The check-menuitem handles for the radio-style preset rows are kept in
//! a process-wide registry so we can reliably toggle their checked state
//! when the user picks a new preset (looking items up via `Menu::get` only
//! works for top-level entries, not items nested inside submenus).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::menu::{
    AboutMetadataBuilder, CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuEvent,
    MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::app_state::AppState;
use crate::imaging::{full_image, hd_image, thumbnails};

/// Menu IDs are namespaced so the event handler can route by prefix.
const ID_THUMB_PREFIX: &str = "cache.thumb.";
const ID_HD_PREFIX: &str = "cache.hd.";
const ID_FULL_MEM_PREFIX: &str = "cache.full_mem.";
const ID_FULL_BITMAP_PREFIX: &str = "cache.full_bitmap.";
const ID_THUMB_CLEAR: &str = "cache.thumb.clear";
const ID_HD_CLEAR: &str = "cache.hd.clear";
const ID_FULL_MEM_CLEAR: &str = "cache.full_mem.clear";
const ID_DEBUG_STATS_TOGGLE: &str = "window.debug_stats";

/// Preset choices surfaced as check items in the menu. Values are entry
/// counts; conservative on the low end, generous on the high end so users
/// with large libraries can opt in.
const THUMB_PRESETS: &[usize] = &[1_000, 5_000, 10_000, 25_000, 50_000];
const HD_PRESETS: &[usize] = &[500, 1_000, 2_000, 5_000, 10_000];
const FULL_MEM_PRESETS: &[usize] = &[4, 8, 16, 32];
const FULL_BITMAP_PRESETS: &[usize] = &[2, 4, 8, 16];

/// Registry of CheckMenuItem handles, keyed by menu id, populated at menu
/// build time. Used by `sync_group_check_state` to flip the radio tick.
static CHECK_ITEMS: OnceLock<Mutex<HashMap<String, CheckMenuItem<Wry>>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, CheckMenuItem<Wry>>> {
    CHECK_ITEMS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn build(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    let settings = app.state::<AppState>().settings.get();

    let app_submenu = build_app_submenu(app)?;
    let edit_submenu = build_edit_submenu(app)?;
    let view_submenu = build_view_submenu(app)?;
    let cache_submenu = build_cache_submenu(app, &settings)?;
    let window_submenu = build_window_submenu(app)?;

    MenuBuilder::new(app)
        .items(&[
            &app_submenu,
            &edit_submenu,
            &view_submenu,
            &cache_submenu,
            &window_submenu,
        ])
        .build()
}

fn build_app_submenu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    let about_meta = AboutMetadataBuilder::new()
        .name(Some("Warble"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .build();
    SubmenuBuilder::new(app, "Warble")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Warble"),
            Some(about_meta),
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()
}

fn build_edit_submenu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()
}

fn build_view_submenu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()
}

fn build_window_submenu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    let debug_stats =
        MenuItemBuilder::with_id(ID_DEBUG_STATS_TOGGLE, "Show Task Debug Stats").build(app)?;
    SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .separator()
        .item(&debug_stats)
        .build()
}

fn build_cache_submenu(
    app: &AppHandle<Wry>,
    settings: &crate::settings::CacheSettings,
) -> tauri::Result<Submenu<Wry>> {
    // Reset the registry in case `build` is called more than once (e.g.
    // hot-reload during dev).
    if let Ok(mut map) = registry().lock() {
        map.clear();
    }

    let thumb_group = build_preset_group(
        app,
        "Thumbnail Disk Cache",
        ID_THUMB_PREFIX,
        THUMB_PRESETS,
        settings.thumbnail_disk_max_entries,
        |n| format_count_label(n, "files"),
    )?;
    let hd_group = build_preset_group(
        app,
        "HD Image Disk Cache",
        ID_HD_PREFIX,
        HD_PRESETS,
        settings.hd_image_disk_max_entries,
        |n| format_count_label(n, "files"),
    )?;
    let full_mem_group = build_preset_group(
        app,
        "Full Image Memory Cache",
        ID_FULL_MEM_PREFIX,
        FULL_MEM_PRESETS,
        settings.full_image_memory_max_entries,
        |n| format!("{n} images"),
    )?;
    let full_bitmap_group = build_preset_group(
        app,
        "Full Image Bitmap Cache",
        ID_FULL_BITMAP_PREFIX,
        FULL_BITMAP_PRESETS,
        settings.full_image_bitmap_max_entries,
        |n| format!("{n} bitmaps"),
    )?;
    let clear_thumb =
        MenuItemBuilder::with_id(ID_THUMB_CLEAR, "Clear Thumbnail Cache").build(app)?;
    let clear_hd =
        MenuItemBuilder::with_id(ID_HD_CLEAR, "Clear HD Image Cache").build(app)?;
    let clear_full_mem =
        MenuItemBuilder::with_id(ID_FULL_MEM_CLEAR, "Clear Full Image Memory Cache").build(app)?;
    SubmenuBuilder::new(app, "Cache")
        .item(&thumb_group)
        .item(&hd_group)
        .item(&full_mem_group)
        .item(&full_bitmap_group)
        .separator()
        .item(&clear_thumb)
        .item(&clear_hd)
        .item(&clear_full_mem)
        .build()
}

fn build_preset_group(
    app: &AppHandle<Wry>,
    title: &str,
    id_prefix: &str,
    presets: &[usize],
    current: usize,
    label_for: impl Fn(usize) -> String,
) -> tauri::Result<Submenu<Wry>> {
    let mut builder = SubmenuBuilder::new(app, title);
    for &n in presets {
        let id = format!("{id_prefix}{n}");
        let item: CheckMenuItem<Wry> = CheckMenuItemBuilder::with_id(&id, label_for(n))
            .checked(n == current)
            .build(app)?;
        builder = builder.item(&item);
        if let Ok(mut map) = registry().lock() {
            map.insert(id, item);
        }
    }
    builder.build()
}

fn format_count_label(n: usize, suffix: &str) -> String {
    // Group thousands with comma for readability: 10,000 files.
    let mut s = String::new();
    let raw = n.to_string();
    let bytes = raw.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (bytes.len() - i) % 3 == 0 {
            s.push(',');
        }
        s.push(*b as char);
    }
    format!("{s} {suffix}")
}

/// Handle a click on any menu item built by this module. Unknown ids are
/// ignored so other (predefined) menu items continue to work normally.
pub fn handle_event(app: &AppHandle<Wry>, event: MenuEvent) {
    let id = event.id().0.as_str().to_string();
    if id == ID_THUMB_CLEAR {
        thumbnails::clear_disk_cache();
        let _ = app.emit("cache-cleared", "thumbnail_disk");
        return;
    }
    if id == ID_DEBUG_STATS_TOGGLE {
        let _ = app.emit("debug-stats:toggle", ());
        return;
    }
    if id == ID_HD_CLEAR {
        hd_image::clear_disk_cache();
        let _ = app.emit("cache-cleared", "hd_image_disk");
        return;
    }
    if id == ID_FULL_MEM_CLEAR {
        full_image::clear_memory_cache();
        let _ = app.emit("cache-cleared", "full_image_memory");
        return;
    }
    if let Some(rest) = id.strip_prefix(ID_THUMB_PREFIX) {
        if let Ok(n) = rest.parse::<usize>() {
            apply_thumb_max(app, n);
        }
        return;
    }
    if let Some(rest) = id.strip_prefix(ID_HD_PREFIX) {
        if let Ok(n) = rest.parse::<usize>() {
            apply_hd_max(app, n);
        }
        return;
    }
    if let Some(rest) = id.strip_prefix(ID_FULL_MEM_PREFIX) {
        if let Ok(n) = rest.parse::<usize>() {
            apply_full_mem_max(app, n);
        }
        return;
    }
    if let Some(rest) = id.strip_prefix(ID_FULL_BITMAP_PREFIX) {
        if let Ok(n) = rest.parse::<usize>() {
            apply_full_bitmap_max(app, n);
        }
    }
}

fn apply_thumb_max(app: &AppHandle<Wry>, n: usize) {
    let state = app.state::<AppState>();
    let Ok(repo) = state.repository() else { return };
    let snapshot = state
        .settings
        .update(repo, |s| s.thumbnail_disk_max_entries = n);
    thumbnails::set_disk_cache_max_entries(n);
    sync_group_check_state(ID_THUMB_PREFIX, THUMB_PRESETS, n);
    let _ = app.emit("cache-settings-changed", snapshot);
}

fn apply_hd_max(app: &AppHandle<Wry>, n: usize) {
    let state = app.state::<AppState>();
    let Ok(repo) = state.repository() else { return };
    let snapshot = state
        .settings
        .update(repo, |s| s.hd_image_disk_max_entries = n);
    hd_image::set_disk_cache_max_entries(n);
    sync_group_check_state(ID_HD_PREFIX, HD_PRESETS, n);
    let _ = app.emit("cache-settings-changed", snapshot);
}

fn apply_full_mem_max(app: &AppHandle<Wry>, n: usize) {
    let state = app.state::<AppState>();
    let Ok(repo) = state.repository() else { return };
    let snapshot = state
        .settings
        .update(repo, |s| s.full_image_memory_max_entries = n);
    full_image::set_memory_cache_capacity(n);
    sync_group_check_state(ID_FULL_MEM_PREFIX, FULL_MEM_PRESETS, n);
    let _ = app.emit("cache-settings-changed", snapshot);
}

fn apply_full_bitmap_max(app: &AppHandle<Wry>, n: usize) {
    let state = app.state::<AppState>();
    let Ok(repo) = state.repository() else { return };
    let snapshot = state
        .settings
        .update(repo, |s| s.full_image_bitmap_max_entries = n);
    sync_group_check_state(ID_FULL_BITMAP_PREFIX, FULL_BITMAP_PRESETS, n);
    // Frontend listens to `cache-settings-changed` and resizes its own
    // ImageBitmap LRU.
    let _ = app.emit("cache-settings-changed", snapshot);
}

/// Make the picked preset the only checked item in its radio group.
/// Walks the registry of CheckMenuItem handles populated at menu build
/// time so `set_checked` reliably updates items inside nested submenus.
fn sync_group_check_state(prefix: &str, presets: &[usize], selected: usize) {
    let Ok(map) = registry().lock() else { return };
    for &n in presets {
        let id = format!("{prefix}{n}");
        if let Some(item) = map.get(&id) {
            let _ = item.set_checked(n == selected);
        }
    }
}

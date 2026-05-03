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
use crate::tasks;

/// Menu IDs are namespaced so the event handler can route by prefix.
const ID_THUMB_PREFIX: &str = "cache.thumb.";
const ID_HD_PREFIX: &str = "cache.hd.";
const ID_FULL_MEM_PREFIX: &str = "cache.full_mem.";
const ID_FULL_BITMAP_PREFIX: &str = "cache.full_bitmap.";
const ID_BG_PREFIX: &str = "cache.bg.";
const ID_THUMB_CLEAR: &str = "cache.thumb.clear";
const ID_HD_CLEAR: &str = "cache.hd.clear";
const ID_FULL_MEM_CLEAR: &str = "cache.full_mem.clear";
const ID_REVEAL_THUMB: &str = "cache.reveal.thumb";
const ID_REVEAL_HD: &str = "cache.reveal.hd";
const ID_REFRESH_USAGE: &str = "cache.usage.refresh";
const ID_DEBUG_STATS_TOGGLE: &str = "window.debug_stats";

/// Preset choices surfaced as check items in the menu. Values are entry
/// counts; conservative on the low end, generous on the high end so users
/// with large libraries can opt in.
const THUMB_PRESETS: &[usize] = &[1_000, 5_000, 10_000, 25_000, 50_000];
const HD_PRESETS: &[usize] = &[500, 1_000, 2_000, 5_000, 10_000];
const FULL_MEM_PRESETS: &[usize] = &[4, 8, 16, 32];
const FULL_BITMAP_PRESETS: &[usize] = &[2, 4, 8, 16];
/// Background-pool concurrency presets. Filtered down to those `<=
/// bg_thread_capacity` at menu build time so we never offer a setting
/// the pool can't honour.
const BG_PRESETS: &[usize] = &[1, 2, 4, 6, 8, 12, 16];

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

/// Rebuild the application menu in place and re-install it. Called
/// after operations that change the disk-usage labels (e.g. clearing a
/// cache) or after the user picks a "Refresh" item, so the next menu
/// open shows fresh numbers.
fn rebuild_and_install(app: &AppHandle<Wry>) {
    match build(app) {
        Ok(m) => {
            if let Err(e) = app.set_menu(m) {
                eprintln!("failed to re-install application menu: {e}");
            }
        }
        Err(e) => eprintln!("failed to rebuild application menu: {e}"),
    }
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

    // Background-pool concurrency: clamp the preset list to the
    // number of OS threads the pool actually spawned.
    let bg_cap = tasks::pool().bg_thread_capacity().max(1);
    let bg_presets: Vec<usize> = BG_PRESETS
        .iter()
        .copied()
        .filter(|&n| n <= bg_cap)
        .collect();
    let bg_group = build_preset_group(
        app,
        "Background Job Concurrency",
        ID_BG_PREFIX,
        &bg_presets,
        settings.background_pool_workers,
        |n| {
            if n == 1 {
                "1 job".to_string()
            } else {
                format!("{n} jobs")
            }
        },
    )?;

    let usage_submenu = build_disk_usage_submenu(app)?;

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
        .item(&bg_group)
        .separator()
        .item(&usage_submenu)
        .separator()
        .item(&clear_thumb)
        .item(&clear_hd)
        .item(&clear_full_mem)
        .build()
}

/// Builds the "Disk Usage" submenu showing per-cache size + path. The
/// labels are evaluated at menu build time; the menu is rebuilt
/// whenever a cache is cleared or the user picks "Refresh", so values
/// stay reasonably fresh without needing dynamic label updates.
fn build_disk_usage_submenu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    let (thumb_bytes, thumb_files) = thumbnails::cache_disk_usage().unwrap_or((0, 0));
    let (hd_bytes, hd_files) = hd_image::cache_disk_usage().unwrap_or((0, 0));
    let thumb_path = thumbnails::cache_root_path()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "(uninitialised)".to_string());
    let hd_path = hd_image::cache_root_path()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "(uninitialised)".to_string());

    // Disabled "header" rows act as static labels — macOS won't let
    // the user click them but they show up in the menu just fine.
    let thumb_size = MenuItemBuilder::new(format!(
        "Thumbnails — {} · {}",
        format_bytes(thumb_bytes),
        format_count_label(thumb_files, "files"),
    ))
    .enabled(false)
    .build(app)?;
    let thumb_path_item = MenuItemBuilder::new(format!("    {thumb_path}"))
        .enabled(false)
        .build(app)?;
    let reveal_thumb =
        MenuItemBuilder::with_id(ID_REVEAL_THUMB, "Reveal Thumbnails in Finder").build(app)?;

    let hd_size = MenuItemBuilder::new(format!(
        "HD Images — {} · {}",
        format_bytes(hd_bytes),
        format_count_label(hd_files, "files"),
    ))
    .enabled(false)
    .build(app)?;
    let hd_path_item = MenuItemBuilder::new(format!("    {hd_path}"))
        .enabled(false)
        .build(app)?;
    let reveal_hd =
        MenuItemBuilder::with_id(ID_REVEAL_HD, "Reveal HD Images in Finder").build(app)?;

    let refresh =
        MenuItemBuilder::with_id(ID_REFRESH_USAGE, "Refresh Disk Usage").build(app)?;

    SubmenuBuilder::new(app, "Disk Usage")
        .item(&thumb_size)
        .item(&thumb_path_item)
        .item(&reveal_thumb)
        .separator()
        .item(&hd_size)
        .item(&hd_path_item)
        .item(&reveal_hd)
        .separator()
        .item(&refresh)
        .build()
}

fn format_bytes(b: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let f = b as f64;
    if f >= GB {
        format!("{:.2} GB", f / GB)
    } else if f >= MB {
        format!("{:.1} MB", f / MB)
    } else if f >= KB {
        format!("{:.1} KB", f / KB)
    } else {
        format!("{b} B")
    }
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
        rebuild_and_install(app);
        return;
    }
    if id == ID_DEBUG_STATS_TOGGLE {
        let _ = app.emit("debug-stats:toggle", ());
        return;
    }
    if id == ID_HD_CLEAR {
        hd_image::clear_disk_cache();
        let _ = app.emit("cache-cleared", "hd_image_disk");
        rebuild_and_install(app);
        return;
    }
    if id == ID_FULL_MEM_CLEAR {
        full_image::clear_memory_cache();
        let _ = app.emit("cache-cleared", "full_image_memory");
        return;
    }
    if id == ID_REVEAL_THUMB {
        if let Some(path) = thumbnails::cache_root_path() {
            reveal_path(&path);
        }
        return;
    }
    if id == ID_REVEAL_HD {
        if let Some(path) = hd_image::cache_root_path() {
            reveal_path(&path);
        }
        return;
    }
    if id == ID_REFRESH_USAGE {
        rebuild_and_install(app);
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
        return;
    }
    if let Some(rest) = id.strip_prefix(ID_BG_PREFIX) {
        if let Ok(n) = rest.parse::<usize>() {
            apply_bg_concurrency(app, n);
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

fn apply_bg_concurrency(app: &AppHandle<Wry>, n: usize) {
    let state = app.state::<AppState>();
    let Ok(repo) = state.repository() else { return };
    let cap = tasks::pool().bg_thread_capacity().max(1);
    let clamped = n.clamp(1, cap);
    let snapshot = state
        .settings
        .update(repo, |s| s.background_pool_workers = clamped);
    tasks::pool().set_bg_concurrency(clamped);
    sync_group_check_state(ID_BG_PREFIX, BG_PRESETS, clamped);
    let _ = app.emit("cache-settings-changed", snapshot);
}

/// Best-effort "reveal in Finder" used by the macOS Cache menu.
/// Mirrors `commands::reveal_in_file_manager` but inlined here so the
/// menu module doesn't have to round-trip through the JS frontend.
fn reveal_path(path: &std::path::Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(path).status();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path; // suppress unused warning on non-macOS
    }
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

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Unsubscribe } from "@warble/core";
import type { CacheSettings, CacheUsage } from "../state/cache-settings-store";
import type { PersistedViewState, ViewState } from "../state/view-state-store";
import type { AppViewState, SettingsBackend } from "./settings-backend";

export class TauriSettingsBackend implements SettingsBackend {
  getCacheSettings(): Promise<CacheSettings> {
    return invoke<CacheSettings>("get_cache_settings");
  }

  setCacheSettings(settings: CacheSettings): Promise<CacheSettings> {
    return invoke<CacheSettings>("set_cache_settings", { settings });
  }

  getCacheDiskUsage(): Promise<CacheUsage> {
    return invoke<CacheUsage>("get_cache_disk_usage");
  }

  onCacheSettingsChanged(listener: (settings: CacheSettings) => void): Promise<Unsubscribe> {
    return listen<CacheSettings>("cache-settings-changed", (event) => listener(event.payload));
  }

  getViewState(): Promise<PersistedViewState | null> {
    return invoke<PersistedViewState | null>("get_view_state");
  }

  async setViewState(view: ViewState): Promise<void> {
    await invoke("set_view_state", { view });
  }

  getAppView(): Promise<AppViewState | null> {
    return invoke<AppViewState | null>("get_app_view");
  }

  async setAppView(view: AppViewState): Promise<void> {
    await invoke("set_app_view", { view });
  }
}

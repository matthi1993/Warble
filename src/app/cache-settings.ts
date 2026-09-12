import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface CacheSettings {
  thumbnail_disk_max_entries: number;
  hd_image_disk_max_entries: number;
  full_image_memory_max_entries: number;
  full_image_bitmap_max_entries: number;
  full_resolution_enabled: boolean;
}

export const SAFE_CACHE_DEFAULTS: CacheSettings = {
  thumbnail_disk_max_entries: 0,
  hd_image_disk_max_entries: 0,
  full_image_memory_max_entries: 0,
  full_image_bitmap_max_entries: 1,
  full_resolution_enabled: false,
};

let current: CacheSettings = { ...SAFE_CACHE_DEFAULTS };
let configurePromise: Promise<CacheSettings> | null = null;
const changes = new EventTarget();

function publish(settings: CacheSettings): CacheSettings {
  const unchanged = (Object.keys(settings) as (keyof CacheSettings)[])
    .every((key) => current[key] === settings[key]);
  current = { ...settings };
  if (!unchanged) {
    changes.dispatchEvent(new CustomEvent<CacheSettings>("change", { detail: current }));
  }
  return current;
}

export function getCacheSettings(): CacheSettings {
  return current;
}

export function subscribeCacheSettings(listener: (settings: CacheSettings) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<CacheSettings>).detail);
  changes.addEventListener("change", handler);
  return () => changes.removeEventListener("change", handler);
}

export function configureCacheSettings(): Promise<CacheSettings> {
  if (configurePromise) return configurePromise;
  configurePromise = (async () => {
    void listen<CacheSettings>("cache-settings-changed", (event) => publish(event.payload));
    try {
      return publish(await invoke<CacheSettings>("get_cache_settings"));
    } catch (error) {
      console.warn("failed to load device cache settings", error);
      return current;
    }
  })();
  return configurePromise;
}

export async function saveCacheSettings(settings: CacheSettings): Promise<CacheSettings> {
  return publish(await invoke<CacheSettings>("set_cache_settings", { settings }));
}

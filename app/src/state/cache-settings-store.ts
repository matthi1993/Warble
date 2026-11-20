import { Emitter, type Unsubscribe } from "@warble/core";
import type { SettingsBackend } from "../platform/settings-backend";

export interface CacheSettings {
  parallel_workers: number;
  thumbnail_disk_max_entries: number;
  hd_image_disk_max_entries: number;
  full_image_memory_max_entries: number;
  full_image_bitmap_max_entries: number;
  full_resolution_enabled: boolean;
}

export interface CacheUsageEntry {
  path: string | null;
  bytes: number;
  files: number;
}

export interface CacheUsage {
  thumbnail: CacheUsageEntry;
  hd_image: CacheUsageEntry;
}

export const SAFE_CACHE_DEFAULTS: CacheSettings = {
  parallel_workers: 1,
  thumbnail_disk_max_entries: 0,
  hd_image_disk_max_entries: 0,
  full_image_memory_max_entries: 0,
  full_image_bitmap_max_entries: 1,
  full_resolution_enabled: false,
};

export class CacheSettingsStore {
  private current: CacheSettings = { ...SAFE_CACHE_DEFAULTS };
  private loading: Promise<CacheSettings> | null = null;
  private readonly changes = new Emitter<CacheSettings>();

  constructor(private readonly backend: SettingsBackend) {}

  get value(): CacheSettings {
    return this.current;
  }

  subscribe(listener: (settings: CacheSettings) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  load(): Promise<CacheSettings> {
    this.loading ??= this.loadOnce();
    return this.loading;
  }

  async save(settings: CacheSettings): Promise<CacheSettings> {
    return this.publish(await this.backend.setCacheSettings(settings));
  }

  diskUsage(): Promise<CacheUsage> {
    return this.backend.getCacheDiskUsage();
  }

  private async loadOnce(): Promise<CacheSettings> {
    try {
      await this.backend.onCacheSettingsChanged((settings) => this.publish(settings));
      return this.publish(await this.backend.getCacheSettings());
    } catch (error) {
      console.warn("failed to load device cache settings", error);
      return this.current;
    }
  }

  private publish(settings: CacheSettings): CacheSettings {
    const unchanged = (Object.keys(settings) as (keyof CacheSettings)[])
      .every((key) => this.current[key] === settings[key]);
    this.current = { ...settings };
    if (!unchanged) this.changes.emit(this.current);
    return this.current;
  }
}

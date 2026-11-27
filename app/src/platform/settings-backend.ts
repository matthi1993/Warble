import type { Unsubscribe } from "@warble/core";
import type { CacheSettings, CacheUsage } from "../state/cache-settings-store";
import type { PersistedViewState, ViewState } from "../state/view-state-store";

export interface AppViewState {
  path?: string | null;
  view?: string | null;
  sidebarCollapsed?: boolean | null;
  editPanelOpen?: boolean | null;
  includeSubfolders?: boolean | null;
}

export interface SettingsBackend {
  getCacheSettings(): Promise<CacheSettings>;
  setCacheSettings(settings: CacheSettings): Promise<CacheSettings>;
  getCacheDiskUsage(): Promise<CacheUsage>;
  onCacheSettingsChanged(listener: (settings: CacheSettings) => void): Promise<Unsubscribe>;
  getViewState(): Promise<PersistedViewState | null>;
  setViewState(view: ViewState): Promise<void>;
  getAppView(): Promise<AppViewState | null>;
  setAppView(view: AppViewState): Promise<void>;
}

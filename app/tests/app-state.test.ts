import { describe, expect, it } from "vitest";
import type { SettingsBackend } from "../src/platform/settings-backend";
import { CacheSettingsStore, SAFE_CACHE_DEFAULTS, type CacheSettings } from "../src/state/cache-settings-store";
import { SlideshowSettingsStore } from "../src/state/slideshow-settings-store";
import { DEFAULT_VIEW_STATE, ViewStateStore, type PersistedViewState, type ViewState } from "../src/state/view-state-store";

function backend(overrides: Partial<SettingsBackend>): SettingsBackend {
  return overrides as SettingsBackend;
}

describe("ViewStateStore", () => {
  const load = (persisted: PersistedViewState | null) =>
    new ViewStateStore(backend({ getViewState: async () => persisted })).load();

  it("persists auto rotate independently of sizing and migrates the old auto mode", async () => {
    expect(await load({ sizing: "fill", autoRotate: true })).toMatchObject({ sizing: "fill", autoRotate: true });
    expect(await load({ sizing: "auto" })).toMatchObject({ sizing: "fit", autoRotate: true });
    expect(await load({ sizing: "hybrid" })).toMatchObject({ sizing: "hybrid", autoRotate: false });
    const saved: ViewState[] = [];
    const store = new ViewStateStore(backend({ setViewState: async (view) => { saved.push(view); } }));
    await store.save({ ...DEFAULT_VIEW_STATE, sizing: "fill", autoRotate: true });
    expect(saved[0]).toMatchObject({ sizing: "fill", autoRotate: true });
  });

  it("migrates the legacy fit field and ignores unknown values", async () => {
    expect(await load({ fit: "proof" })).toMatchObject({ frameSize: 48 });
    expect(await load({ fit: "tight", frameSize: 7 })).toMatchObject({ frameSize: 12 });
    const state = await load({ bg: "pink", smoothing: "ultra", frameRadius: 3 });
    expect(state).not.toHaveProperty("bg");
    expect(state).not.toHaveProperty("smoothing");
    expect(state.frameRadius).toBe(0);
    expect(await load(null)).toEqual({});
  });
});

describe("CacheSettingsStore", () => {
  it("loads once, follows backend changes and notifies only on real changes", async () => {
    const loaded: CacheSettings = { ...SAFE_CACHE_DEFAULTS, parallel_workers: 4 };
    let pushChange: (settings: CacheSettings) => void = () => {};
    let reads = 0;
    const store = new CacheSettingsStore(backend({
      getCacheSettings: async () => { reads++; return loaded; },
      onCacheSettingsChanged: async (listener) => { pushChange = listener; return () => {}; },
    }));
    const seen: number[] = [];
    store.subscribe((settings) => seen.push(settings.parallel_workers));
    await Promise.all([store.load(), store.load()]);
    pushChange({ ...loaded });
    pushChange({ ...loaded, parallel_workers: 8 });
    expect(reads).toBe(1);
    expect(seen).toEqual([4, 8]);
    expect(store.value.parallel_workers).toBe(8);
  });
});

describe("SlideshowSettingsStore", () => {
  it("falls back to defaults for missing or invalid values", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = new SlideshowSettingsStore(storage);
    expect(store.load()).toEqual({ durationSeconds: 5, transition: "fade" });
    store.save({ durationSeconds: 60, transition: "instant" });
    expect(store.load()).toEqual({ durationSeconds: 60, transition: "instant" });
    values.set("warble.slideshow.v1", JSON.stringify({ durationSeconds: 0, transition: "spin" }));
    expect(store.load()).toEqual({ durationSeconds: 5, transition: "fade" });
  });
});

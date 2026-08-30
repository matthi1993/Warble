/** User-created presets for the global Post-Processing tab only. */
import { invoke } from "@tauri-apps/api/core";
import {
  defaultPostProcess,
  type PostProcessSettings,
} from "./post-process-store";

export type PostProcessPresetValues = Omit<PostProcessSettings, "enabled">;

export interface PostProcessPreset {
  id: string;
  name: string;
  values: PostProcessPresetValues;
}

const LEGACY_STORAGE_KEY = "warble.postProcessPresets.v1";
const listeners = new Set<(presets: readonly PostProcessPreset[]) => void>();

function snapshot(settings: PostProcessSettings): PostProcessPresetValues {
  return structuredClone({
    color: settings.color,
    curve: settings.curve,
    sharpen: settings.sharpen,
    grain: settings.grain,
  });
}

function parse(raw: string): PostProcessPreset[] {
  try {
    const parsed = JSON.parse(raw) as Array<Partial<PostProcessPreset>>;
    const defaults = defaultPostProcess();
    return parsed.flatMap((item) => {
      if (!item.id || !item.name || !item.values) return [];
      const values = item.values as Partial<PostProcessPresetValues>;
      return [{
        id: item.id,
        name: item.name,
        values: structuredClone({
          color: values.color ?? defaults.color,
          curve: values.curve ?? defaults.curve,
          sharpen: values.sharpen ?? defaults.sharpen,
          grain: values.grain ?? defaults.grain,
        }),
      }];
    });
  } catch (error) {
    console.warn("post-process presets: invalid persisted data", error);
    return [];
  }
}

function loadLegacy(): PostProcessPreset[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  return raw ? parse(raw) : [];
}

let presets = loadLegacy();
let loaded = false;
let loadPromise: Promise<void> | null = null;
let loadGeneration = 0;
let persistChain: Promise<void> = Promise.resolve();
let persistError: unknown = null;

function persist(): Promise<void> {
  const presetsJson = JSON.stringify(presets);
  const operation = persistChain.then(() =>
    invoke<void>("set_post_process_presets", { presetsJson })
  );
  persistChain = operation.then(
    () => { persistError = null; },
    (error) => {
      persistError = error;
      console.warn("post-process presets: failed to persist", error);
    }
  );
  return operation;
}

function notify(): void {
  const value = getPostProcessPresets();
  for (const listener of listeners) listener(value);
}

export function getPostProcessPresets(): readonly PostProcessPreset[] {
  return presets;
}

async function hydrate(migrateLegacy: boolean): Promise<void> {
  const generation = loadGeneration;
  try {
    const raw = await invoke<string | null>("get_post_process_presets");
    if (generation !== loadGeneration) return;
    if (raw !== null) {
      presets = parse(raw);
    } else if (migrateLegacy && presets.length > 0) {
      await persist();
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } else {
      presets = [];
    }
  } catch (error) {
    console.warn("post-process presets: failed to load", error);
  } finally {
    if (generation === loadGeneration) {
      loaded = true;
      notify();
    }
  }
}

/** Hydrate presets from the active library, migrating the legacy global
 * localStorage value once for existing installations. */
export function loadPostProcessPresets(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loadPromise) loadPromise = hydrate(true);
  return loadPromise;
}

/** Drop the previous library's presets and load the newly opened library. */
export function reloadPostProcessPresets(): Promise<void> {
  loadGeneration += 1;
  loaded = false;
  loadPromise = null;
  presets = [];
  notify();
  loadPromise = hydrate(false);
  return loadPromise;
}

/** Wait until every preset change has reached SQLite before snapshotting or
 * replacing the active library. */
export async function flushPostProcessPresets(): Promise<void> {
  if (loadPromise) await loadPromise;
  await persistChain;
  if (persistError) await persist();
}

/** Save the current tool values. Reusing a name updates that preset. */
export function savePostProcessPreset(
  name: string,
  settings: PostProcessSettings
): PostProcessPreset | null {
  const cleanName = name.trim();
  if (!cleanName) return null;
  const existingIndex = presets.findIndex(
    (preset) => preset.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase()
  );
  const preset: PostProcessPreset = {
    id: existingIndex >= 0
      ? presets[existingIndex].id
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    name: cleanName,
    values: snapshot(settings),
  };
  presets = existingIndex >= 0
    ? presets.map((item, index) => index === existingIndex ? preset : item)
    : [...presets, preset];
  void persist().catch(() => {});
  notify();
  return preset;
}

export function deletePostProcessPreset(id: string): void {
  const next = presets.filter((preset) => preset.id !== id);
  if (next.length === presets.length) return;
  presets = next;
  void persist().catch(() => {});
  notify();
}

/** Preset selection intentionally turns the post layer on so applying or
 * hovering a preset is immediately visible. The master switch itself is not
 * stored as part of a preset because it is not a tool value. */
export function settingsFromPostProcessPreset(
  preset: PostProcessPreset,
  current: PostProcessSettings
): PostProcessSettings {
  return structuredClone({ ...current, ...preset.values, enabled: true });
}

export function subscribePostProcessPresets(
  listener: (presets: readonly PostProcessPreset[]) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

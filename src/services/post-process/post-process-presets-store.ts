/** User-created presets for the global Post-Processing tab only. */
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

const STORAGE_KEY = "warble.postProcessPresets.v1";
const listeners = new Set<(presets: readonly PostProcessPreset[]) => void>();

function snapshot(settings: PostProcessSettings): PostProcessPresetValues {
  return structuredClone({
    color: settings.color,
    curve: settings.curve,
    sharpen: settings.sharpen,
    grain: settings.grain,
  });
}

function load(): PostProcessPreset[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
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

let presets = load();

function persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch (error) {
    console.warn("post-process presets: failed to persist", error);
  }
}

function notify(): void {
  const value = getPostProcessPresets();
  for (const listener of listeners) listener(value);
}

export function getPostProcessPresets(): readonly PostProcessPreset[] {
  return presets;
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
  persist();
  notify();
  return preset;
}

export function deletePostProcessPreset(id: string): void {
  const next = presets.filter((preset) => preset.id !== id);
  if (next.length === presets.length) return;
  presets = next;
  persist();
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

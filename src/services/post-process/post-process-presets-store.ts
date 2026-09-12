/** User-created presets for the global Post-Processing tab only. */
import { invoke } from "@tauri-apps/api/core";
import {
  defaultPostProcess,
  type PostProcessSettings,
} from "./post-process-store";
import { defaultTone, normalizeColor } from "@domain/edits";

export type PostProcessPresetValues = Omit<PostProcessSettings, "enabled">;

export interface PostProcessPreset {
  id: string;
  name: string;
  values: PostProcessPresetValues;
}

export interface PresetExportFile {
  version: 1;
  postProcess: Array<Omit<PostProcessPreset, "id">>;
}

const LEGACY_STORAGE_KEY = "warble.postProcessPresets.v1";
const listeners = new Set<(presets: readonly PostProcessPreset[]) => void>();

function snapshot(settings: PostProcessSettings): PostProcessPresetValues {
  return structuredClone({
    tone: settings.tone,
    color: settings.color,
    curve: settings.curve,
    sharpen: settings.sharpen,
    grain: settings.grain,
  });
}

function createPresetId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
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
          tone: values.tone
            ? { ...defaultTone(), ...values.tone }
            : defaults.tone,
          color: values.color ? normalizeColor(values.color) : defaults.color,
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
let persistChain: Promise<void> = Promise.resolve();

function persist(): Promise<void> {
  const presetsJson = JSON.stringify(presets);
  const operation = persistChain.then(() =>
    invoke<void>("set_post_process_presets", { presetsJson })
  );
  persistChain = operation.catch((error) => {
    console.warn("post-process presets: failed to persist", error);
  });
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
  try {
    const raw = await invoke<string | null>("get_post_process_presets");
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
    loaded = true;
    notify();
  }
}

/** Hydrate presets from the active library, migrating the legacy global
 * localStorage value once for existing installations. */
export function loadPostProcessPresets(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loadPromise) loadPromise = hydrate(true);
  return loadPromise;
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
    id: existingIndex >= 0 ? presets[existingIndex].id : createPresetId(),
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

/** Serialize all currently supported preset groups for the settings export. */
export function exportPostProcessPresets(): string {
  const file: PresetExportFile = {
    version: 1,
    postProcess: presets.map(({ name, values }) => ({
      name,
      values: structuredClone(values),
    })),
  };
  return JSON.stringify(file, null, 2);
}

/** Import post-process presets, keeping existing names and adding suffixes to
 * collisions so importing can never overwrite a user's saved preset. */
export function importPostProcessPresets(raw: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" &&
        Array.isArray((parsed as { postProcess?: unknown }).postProcess)
      ? (parsed as { postProcess: unknown[] }).postProcess
      : null;
  if (!entries) throw new Error("The selected file contains no post-process presets.");

  const parsedPresets = parse(JSON.stringify(entries.map((entry) => ({
    ...(entry as object),
    id: typeof (entry as { id?: unknown }).id === "string"
      ? (entry as { id: string }).id
      : createPresetId(),
  }))));
  const usedNames = new Set(presets.map((preset) => preset.name.toLocaleLowerCase()));
  const imported = parsedPresets.map((preset) => {
    const baseName = preset.name.trim();
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name.toLocaleLowerCase())) {
      name = `${baseName} (${suffix})`;
      suffix += 1;
    }
    usedNames.add(name.toLocaleLowerCase());
    return {
      id: createPresetId(),
      name,
      values: structuredClone(preset.values),
    };
  });

  if (imported.length === 0) return 0;
  presets = [...presets, ...imported];
  void persist().catch(() => {});
  notify();
  return imported.length;
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

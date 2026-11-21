import type { EffectCatalog } from "../effects/effect-catalog";
import type { PostProcessSettings } from "../post/post-process-settings";
import type { PostProcessPreset, PostProcessPresetValues, PresetExportFile } from "./post-process-preset";

/** Reads and writes the saved and exported preset formats; older presets get neutral values for newer effects. */
export class PresetCodec {
  constructor(private readonly catalog: EffectCatalog) {}

  valuesOf(settings: Partial<PostProcessPresetValues>): PostProcessPresetValues {
    const values = Object.fromEntries(this.catalog.ids.map((id) => [id, this.catalog.normalize(id, settings[id])]));
    return structuredClone(values) as PostProcessPresetValues;
  }

  settingsFrom(preset: PostProcessPreset, current: PostProcessSettings): PostProcessSettings {
    return structuredClone({ ...current, ...preset.values, enabled: true });
  }

  parse(raw: string): PostProcessPreset[] {
    try {
      const stored = JSON.parse(raw) as Array<Partial<PostProcessPreset>>;
      return stored.flatMap((item) => {
        if (!item.id || !item.name || !item.values) return [];
        return [{ id: item.id, name: item.name, group: item.group ?? "", values: this.valuesOf(item.values) }];
      });
    } catch (error) {
      console.warn("post-process presets: invalid persisted data", error);
      return [];
    }
  }

  exportFile(presets: readonly PostProcessPreset[]): string {
    const file: PresetExportFile = {
      version: 1,
      postProcess: presets.map(({ name, group, values }) => ({ name, group, values: structuredClone(values) })),
    };
    return JSON.stringify(file, null, 2);
  }

  /** Accepts an export file or a bare list; entries without an id get one so they parse like saved presets. */
  parseImport(raw: string, createId: () => string): PostProcessPreset[] {
    const entries = this.importEntries(raw);
    const identified = entries.map((entry) => {
      const id = (entry as { id?: unknown }).id;
      return { ...(entry as object), id: typeof id === "string" ? id : createId() };
    });
    return this.parse(JSON.stringify(identified));
  }

  private importEntries(raw: string): unknown[] {
    let file: unknown;
    try {
      file = JSON.parse(raw);
    } catch {
      throw new Error("The selected file is not valid JSON.");
    }
    if (Array.isArray(file)) return file;
    const postProcess = (file as { postProcess?: unknown } | null)?.postProcess;
    if (file && typeof file === "object" && Array.isArray(postProcess)) return postProcess;
    throw new Error("The selected file contains no post-process presets.");
  }
}

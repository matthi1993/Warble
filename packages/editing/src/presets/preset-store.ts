import { Emitter, type Unsubscribe } from "@warble/core";
import type { EffectCatalog } from "../effects/effect-catalog";
import type { KeyValueStorage } from "../ports/key-value-storage";
import type { PresetRepository } from "../ports/preset-repository";
import type { PostProcessSettings } from "../post/post-process-settings";
import type { PostProcessPreset } from "./post-process-preset";
import { PresetCodec } from "./preset-codec";

const LEGACY_STORAGE_KEY = "warble.postProcessPresets.v1";

/** User-created presets for the global Post look. */
export class PresetStore {
  private readonly changes = new Emitter<readonly PostProcessPreset[]>();
  private readonly codec: PresetCodec;
  private current: PostProcessPreset[];
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: PresetRepository,
    catalog: EffectCatalog,
    private readonly legacyStorage: KeyValueStorage | null = null,
  ) {
    this.codec = new PresetCodec(catalog);
    const legacy = this.legacyStorage?.getItem(LEGACY_STORAGE_KEY);
    this.current = legacy ? this.codec.parse(legacy) : [];
  }

  get presets(): readonly PostProcessPreset[] {
    return this.current;
  }

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loadPromise) this.loadPromise = this.hydrate();
    return this.loadPromise;
  }

  /** Saving under an existing name (ignoring case) replaces that preset. */
  save(name: string, settings: PostProcessSettings): PostProcessPreset | null {
    const cleanName = name.trim();
    if (!cleanName) return null;
    const existing = this.current.find((preset) => this.sameName(preset.name, cleanName));
    const preset: PostProcessPreset = {
      id: existing?.id ?? this.createId(),
      name: cleanName,
      values: this.codec.valuesOf(settings),
    };
    this.publish(
      existing ? this.current.map((item) => (item === existing ? preset : item)) : [...this.current, preset],
    );
    return preset;
  }

  remove(id: string): void {
    const remaining = this.current.filter((preset) => preset.id !== id);
    if (remaining.length !== this.current.length) this.publish(remaining);
  }

  exportJson(): string {
    return this.codec.exportFile(this.current);
  }

  /** Imported presets never overwrite: a taken name gets a numbered suffix. Returns how many were added. */
  importJson(raw: string): number {
    const usedNames = new Set(this.current.map((preset) => preset.name.toLocaleLowerCase()));
    const imported = this.codec.parseImport(raw, () => this.createId()).map((preset) => {
      const baseName = preset.name.trim();
      let name = baseName;
      for (let suffix = 2; usedNames.has(name.toLocaleLowerCase()); suffix += 1) {
        name = `${baseName} (${suffix})`;
      }
      usedNames.add(name.toLocaleLowerCase());
      return { id: this.createId(), name, values: structuredClone(preset.values) };
    });
    if (imported.length > 0) this.publish([...this.current, ...imported]);
    return imported.length;
  }

  /** Applying a preset always turns the Post layer on so the result is visible. */
  settingsFrom(preset: PostProcessPreset, current: PostProcessSettings): PostProcessSettings {
    return this.codec.settingsFrom(preset, current);
  }

  matches(preset: PostProcessPreset, settings: PostProcessSettings): boolean {
    return JSON.stringify(this.codec.valuesOf(preset.values)) === JSON.stringify(this.codec.valuesOf(settings));
  }

  subscribe(listener: (presets: readonly PostProcessPreset[]) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await this.repository.getPostProcessPresets();
      if (raw !== null) {
        this.current = this.codec.parse(raw);
      } else if (this.current.length > 0) {
        await this.persist();
        this.legacyStorage?.removeItem(LEGACY_STORAGE_KEY);
      } else {
        this.current = [];
      }
    } catch (error) {
      console.warn("post-process presets: failed to load", error);
    } finally {
      this.loaded = true;
      this.changes.emit(this.current);
    }
  }

  private publish(presets: PostProcessPreset[]): void {
    this.current = presets;
    void this.persist().catch(() => {});
    this.changes.emit(this.current);
  }

  private persist(): Promise<void> {
    const presetsJson = JSON.stringify(this.current);
    const save = this.saveChain.then(() => this.repository.setPostProcessPresets(presetsJson));
    this.saveChain = save.catch((error) => {
      console.warn("post-process presets: failed to persist", error);
    });
    return save;
  }

  private sameName(first: string, second: string): boolean {
    return first.toLocaleLowerCase() === second.toLocaleLowerCase();
  }

  private createId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

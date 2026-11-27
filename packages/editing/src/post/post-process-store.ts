import { Emitter, type Unsubscribe } from "@warble/core";
import type { EffectId, EffectSettingsMap } from "@warble/render";
import type { EffectCatalog } from "../effects/effect-catalog";
import type { KeyValueStorage } from "../ports/key-value-storage";
import type { PostProcessSettings } from "./post-process-settings";

const STORAGE_KEY = "warble.postProcess.v4";
const LEGACY_STORAGE_KEY = "warble.postProcess.v3";

/** The global look applied after every photo's own edits. */
export class PostProcessStore {
  private readonly changes = new Emitter<PostProcessSettings>();
  private current: PostProcessSettings;
  private previewBase: PostProcessSettings | null = null;

  constructor(
    private readonly storage: KeyValueStorage | null,
    private readonly catalog: EffectCatalog,
  ) {
    this.current = this.load();
  }

  get settings(): PostProcessSettings {
    return this.current;
  }

  /** The saved state underneath a preview, so a preview can never become a preset or get saved by accident. */
  get committed(): PostProcessSettings {
    return this.previewBase ?? this.current;
  }

  get enabled(): boolean {
    return this.current.enabled;
  }

  defaults(): PostProcessSettings {
    return this.read({});
  }

  effect<K extends EffectId>(id: K): EffectSettingsMap[K] {
    return this.current[id];
  }

  setEffect<K extends EffectId>(id: K, settings: EffectSettingsMap[K]): void {
    this.commit({ ...this.committed, [id]: this.catalog.normalize(id, settings) });
  }

  resetEffect(id: EffectId): void {
    this.commit({ ...this.committed, [id]: this.catalog.defaults(id) });
  }

  setEnabled(enabled: boolean): void {
    if (this.committed.enabled === enabled) this.clearPreview();
    else this.commit({ ...this.committed, enabled });
  }

  replace(settings: PostProcessSettings): void {
    this.commit(structuredClone(settings));
  }

  reset(): void {
    this.commit(this.defaults());
  }

  /** Shown but never saved; any committed change ends it. */
  preview(settings: PostProcessSettings): void {
    if (!this.previewBase) this.previewBase = this.current;
    this.current = structuredClone(settings);
    this.changes.emit(this.current);
  }

  clearPreview(): void {
    if (!this.previewBase) return;
    this.current = this.previewBase;
    this.previewBase = null;
    this.changes.emit(this.current);
  }

  subscribe(listener: (settings: PostProcessSettings) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  private commit(next: PostProcessSettings): void {
    this.previewBase = null;
    this.current = next;
    this.save();
    this.changes.emit(this.current);
  }

  private load(): PostProcessSettings {
    const raw = this.storage?.getItem(STORAGE_KEY) ?? this.storage?.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return this.defaults();
    try {
      return this.read(JSON.parse(raw) as Partial<PostProcessSettings>);
    } catch (error) {
      console.warn("post-process: invalid persisted settings, resetting", error);
      return this.defaults();
    }
  }

  private read(stored: Partial<PostProcessSettings>): PostProcessSettings {
    const effects = Object.fromEntries(this.catalog.ids.map((id) => [id, this.catalog.normalize(id, stored[id])]));
    return { enabled: stored.enabled ?? true, ...effects } as PostProcessSettings;
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch (error) {
      console.warn("post-process: failed to persist settings", error);
    }
  }
}

import { Emitter, type Unsubscribe } from "@warble/core";
import type { EffectId, EffectSettingsMap } from "@warble/render";
import type { CropEdit } from "../crop/crop-edit";
import type { EffectCatalog } from "../effects/effect-catalog";
import type { KeyValueStorage } from "../ports/key-value-storage";
import type { PhotoEditRepository } from "../ports/photo-edit-repository";
import type { PhotoEffectsRepository } from "../ports/photo-effects-repository";
import type { PhotoEditChange } from "./photo-edit";
import { PhotoEditTable } from "./photo-edit-table";
import { PhotoEffectTable } from "./photo-effect-table";

/** Changes are visible at once; saving is debounced and stays in order per photo. */
export class PhotoEditStore {
  private readonly changes = new Emitter<PhotoEditChange>();
  private readonly rows: PhotoEditTable;
  private readonly document: PhotoEffectTable;

  constructor(
    repository: PhotoEditRepository & PhotoEffectsRepository,
    private readonly catalog: EffectCatalog,
    legacyStorage: KeyValueStorage | null = null,
  ) {
    this.rows = new PhotoEditTable(repository, catalog, (path) => this.changes.emit({ path, payload: "edits" }));
    this.document = new PhotoEffectTable(repository, catalog, legacyStorage, (path) =>
      this.changes.emit({ path, payload: "effects" }),
    );
  }

  get effectIds(): EffectId[] {
    return this.catalog.ids.filter((id) => this.supports(id));
  }

  supports(id: EffectId): boolean {
    return this.rows.owns(id) || this.document.owns(id);
  }

  async load(): Promise<void> {
    await Promise.all([this.rows.load(), this.document.load()]);
  }

  async reload(): Promise<void> {
    await Promise.all([this.rows.reload(), this.document.reload()]);
  }

  async flush(path: string): Promise<void> {
    await Promise.all([this.rows.flush(path), this.document.flush()]);
  }

  async flushAll(): Promise<void> {
    await Promise.all([this.rows.flushAll(), this.document.flush()]);
  }

  hasEdits(path: string): boolean {
    return this.rows.has(path) || this.document.has(path);
  }

  crop(path: string): CropEdit | null {
    return this.rows.crop(path);
  }

  setCrop(path: string, crop: CropEdit | null): void {
    this.rows.setCrop(path, crop);
  }

  hasEffect(path: string, id: EffectId): boolean {
    return this.effect(path, id) !== null;
  }

  effect<K extends EffectId>(path: string, id: K): EffectSettingsMap[K] | null {
    if (this.rows.owns(id)) return this.rows.effect(path, id);
    if (this.document.owns(id)) return this.document.effect(path, id);
    return null;
  }

  setEffect<K extends EffectId>(path: string, id: K, settings: EffectSettingsMap[K] | null): void {
    if (this.rows.owns(id)) this.rows.setEffect(path, id, settings);
    else if (this.document.owns(id)) this.document.setEffect(path, id, settings);
    else throw new Error(`Effect "${id}" cannot be stored per photo`);
  }

  removeEffectsUnderRoot(rootId: string): void {
    this.document.removeUnderRoot(rootId);
  }

  subscribe(listener: (change: PhotoEditChange) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }
}

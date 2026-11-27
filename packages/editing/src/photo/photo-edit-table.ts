import type { EffectId, EffectSettingsMap } from "@warble/render";
import type { CropEdit } from "../crop/crop-edit";
import type { EffectCatalog } from "../effects/effect-catalog";
import type { PersistedPhotoEdit, PhotoEditRepository } from "../ports/photo-edit-repository";
import type { PhotoEdit } from "./photo-edit";
import { PhotoSaveQueue } from "./photo-save-queue";

const SAVE_DELAY_MS = 150;
const ROW_EFFECT_IDS = ["tone", "curve", "color"] as const;

export type RowEffectId = (typeof ROW_EFFECT_IDS)[number];

/** Crop, tone, curve and color: saved as one native row per photo. Neutral effects are never kept. */
export class PhotoEditTable {
  private readonly edits = new Map<string, PhotoEdit>();
  private readonly saves = new PhotoSaveQueue(SAVE_DELAY_MS, (path) => this.save(path));
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly repository: PhotoEditRepository,
    private readonly catalog: EffectCatalog,
    private readonly notify: (path: string | null) => void,
  ) {}

  owns(id: EffectId): id is RowEffectId {
    return (ROW_EFFECT_IDS as readonly string[]).includes(id);
  }

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.repository
      .getPhotoEdits()
      .then((rows) => {
        for (const row of rows) this.adopt(row);
        this.loaded = true;
        this.notify(null);
      })
      .catch((error) => {
        console.error("Failed to load photo edits", error);
        this.loaded = true;
      });
    return this.loadPromise;
  }

  reload(): Promise<void> {
    this.edits.clear();
    this.loaded = false;
    this.loadPromise = null;
    return this.load();
  }

  has(path: string): boolean {
    return this.edits.has(path);
  }

  crop(path: string): CropEdit | null {
    return this.edits.get(path)?.crop ?? null;
  }

  setCrop(path: string, crop: CropEdit | null): void {
    this.commit(path, { ...this.snapshot(path), crop });
  }

  effect<K extends RowEffectId>(path: string, id: K): EffectSettingsMap[K] | null {
    return (this.edits.get(path)?.[id] as EffectSettingsMap[K] | null | undefined) ?? null;
  }

  setEffect(path: string, id: RowEffectId, settings: object | null): void {
    this.commit(path, { ...this.snapshot(path), [id]: this.meaningful(id, settings) });
  }

  flush(path: string): Promise<void> {
    return this.saves.flush(path);
  }

  async flushAll(): Promise<void> {
    if (this.loadPromise) await this.loadPromise;
    await this.saves.flushAll();
  }

  private adopt(row: PersistedPhotoEdit): void {
    const edit: PhotoEdit = {
      crop: row.crop ?? null,
      tone: this.meaningful("tone", row.tone),
      curve: this.meaningful("curve", row.curve),
      color: this.meaningful("color", row.color),
    };
    if (this.isEmpty(edit)) this.edits.delete(row.path);
    else this.edits.set(row.path, edit);
  }

  private meaningful<K extends RowEffectId>(id: K, settings: unknown): EffectSettingsMap[K] | null {
    if (!settings) return null;
    const normalized = this.catalog.normalize(id, settings);
    return this.catalog.isNeutral(id, normalized) ? null : normalized;
  }

  private snapshot(path: string): PhotoEdit {
    return this.edits.get(path) ?? { crop: null, tone: null, curve: null, color: null };
  }

  private isEmpty(edit: PhotoEdit): boolean {
    return !edit.crop && !edit.tone && !edit.curve && !edit.color;
  }

  private commit(path: string, next: PhotoEdit): void {
    if (this.isEmpty(next)) this.edits.delete(path);
    else this.edits.set(path, next);
    this.notify(path);
    this.saves.schedule(path);
  }

  private async save(path: string): Promise<void> {
    const edit = this.edits.get(path);
    if (edit) await this.repository.setPhotoEdit({ path, ...edit });
    else await this.repository.clearPhotoEdit(path);
  }
}

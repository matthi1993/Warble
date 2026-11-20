import { Debouncer } from "@warble/core";
import type { EffectId, EffectLayer, EffectSettingsMap } from "@warble/render";
import type { EffectCatalog } from "../effects/effect-catalog";
import type { KeyValueStorage } from "../ports/key-value-storage";
import type { PhotoEffectsRepository } from "../ports/photo-effects-repository";

const SAVE_DELAY_MS = 150;
const LEGACY_STORAGE_KEY = "warble.effects.v1";
const DOCUMENT_EFFECT_IDS = ["sharpen", "grain", "clarity", "analog"] as const;

export type DocumentEffectId = (typeof DOCUMENT_EFFECT_IDS)[number];

/**
 * Sharpen, grain, clarity and analog: saved for all photos together as one JSON document.
 * Unlike the row effects, an explicitly set neutral value is kept as a deliberate choice.
 */
export class PhotoEffectTable {
  private readonly effects = new Map<string, EffectLayer>();
  private readonly saveDebouncer = new Debouncer(SAVE_DELAY_MS, () => {
    void this.saveNow().catch(() => {});
  });
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private loadGeneration = 0;
  private saveChain: Promise<void> = Promise.resolve();
  private saveError: unknown = null;

  constructor(
    private readonly repository: PhotoEffectsRepository,
    private readonly catalog: EffectCatalog,
    private readonly legacyStorage: KeyValueStorage | null,
    private readonly notify: (path: string | null) => void,
  ) {
    const legacy = this.legacyStorage?.getItem(LEGACY_STORAGE_KEY);
    if (legacy) this.adopt(legacy);
  }

  owns(id: EffectId): id is DocumentEffectId {
    return (DOCUMENT_EFFECT_IDS as readonly string[]).includes(id);
  }

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loadPromise) this.loadPromise = this.hydrate(true);
    return this.loadPromise;
  }

  reload(): Promise<void> {
    this.loadGeneration += 1;
    this.loaded = false;
    this.effects.clear();
    this.notify(null);
    this.loadPromise = this.hydrate(false);
    return this.loadPromise;
  }

  async flush(): Promise<void> {
    if (this.loadPromise) await this.loadPromise;
    this.saveDebouncer.flush();
    await this.saveChain;
    if (this.saveError) await this.saveNow();
  }

  has(path: string): boolean {
    return this.effects.has(path);
  }

  effect<K extends DocumentEffectId>(path: string, id: K): EffectSettingsMap[K] | null {
    return this.effects.get(path)?.[id] ?? null;
  }

  setEffect(path: string, id: DocumentEffectId, settings: object | null): void {
    const existing = this.effects.get(path);
    if (!settings && !existing?.[id]) return;
    const next = { ...existing, [id]: settings ? this.catalog.normalize(id, settings) : null };
    if (this.isEmpty(next)) this.effects.delete(path);
    else this.effects.set(path, next);
    this.saveDebouncer.schedule();
    this.notify(path);
  }

  removeUnderRoot(rootId: string): void {
    const paths = [...this.effects.keys()].filter((path) => path === rootId || path.startsWith(`${rootId}/`));
    if (paths.length === 0) return;
    for (const path of paths) this.effects.delete(path);
    this.saveDebouncer.schedule();
    this.notify(null);
  }

  private async hydrate(migrateLegacy: boolean): Promise<void> {
    const generation = this.loadGeneration;
    try {
      const raw = await this.repository.getPhotoEffects();
      if (generation !== this.loadGeneration) return;
      if (raw !== null) {
        this.effects.clear();
        this.adopt(raw);
      } else if (migrateLegacy && this.effects.size > 0) {
        await this.saveNow();
        this.legacyStorage?.removeItem(LEGACY_STORAGE_KEY);
      } else {
        this.effects.clear();
      }
    } catch (error) {
      console.warn("effects: failed to load", error);
    } finally {
      if (generation === this.loadGeneration) {
        this.loaded = true;
        this.notify(null);
      }
    }
  }

  private adopt(raw: string): void {
    try {
      const document = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      for (const [path, stored] of Object.entries(document)) {
        const effects: Partial<Record<DocumentEffectId, unknown>> = {};
        for (const id of DOCUMENT_EFFECT_IDS) {
          if (stored[id]) effects[id] = this.catalog.normalize(id, stored[id]);
        }
        if (!this.isEmpty(effects)) this.effects.set(path, effects as EffectLayer);
      }
    } catch (error) {
      console.warn("effects: invalid persisted settings, resetting", error);
    }
  }

  private isEmpty(effects: Readonly<Record<string, unknown>>): boolean {
    return !Object.values(effects).some(Boolean);
  }

  private serialize(): string {
    const document: Record<string, Record<string, unknown>> = {};
    for (const [path, effects] of this.effects) {
      document[path] = Object.fromEntries(DOCUMENT_EFFECT_IDS.map((id) => [id, effects[id] ?? null]));
    }
    return JSON.stringify(document);
  }

  private saveNow(): Promise<void> {
    const effectsJson = this.serialize();
    const save = this.saveChain.then(() => this.repository.setPhotoEffects(effectsJson));
    this.saveChain = save.then(
      () => {
        this.saveError = null;
      },
      (error) => {
        this.saveError = error;
        console.warn("effects: failed to persist", error);
      },
    );
    return save;
  }
}

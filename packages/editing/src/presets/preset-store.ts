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
  private savedGroups: string[] = [];
  private readonly parents = new Map<string, string>();
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

  get groups(): readonly string[] {
    return [...new Set([...this.savedGroups, ...this.current.map((preset) => preset.group).filter(Boolean)])];
  }

  parentGroup(group: string): string {
    return this.parents.get(group) ?? "";
  }

  canMoveGroup(group: string, parent: string): boolean {
    const groups = this.groups;
    if (!groups.includes(group) || (parent && !groups.includes(parent))) return false;
    for (let ancestor = parent; ancestor; ancestor = this.parentGroup(ancestor)) {
      if (ancestor === group) return false;
    }
    return true;
  }

  moveGroup(group: string, parent: string, before: string | null): void {
    if (!this.canMoveGroup(group, parent) || before === group) return;
    const groups = this.groups.filter((item) => item !== group);
    const index = before && this.parentGroup(before) === parent ? groups.indexOf(before) : -1;
    groups.splice(index < 0 ? groups.length : index, 0, group);
    this.setParent(group, parent);
    this.publish(this.current, groups);
  }

  private setParent(group: string, parent: string): void {
    if (parent) this.parents.set(group, parent);
    else this.parents.delete(group);
  }

  createGroup(name: string): string | null {
    const group = name.trim();
    if (!group) return null;
    const existing = this.groups.find((item) => this.sameName(item, group));
    if (existing) return existing;
    this.savedGroups = [...this.groups, group];
    this.publish(this.current);
    return group;
  }

  renameGroup(group: string, name: string): boolean {
    const next = name.trim();
    if (!next || !this.groups.includes(group)) return false;
    if (this.groups.some((item) => item !== group && this.sameName(item, next))) return false;
    if (group !== next) this.replaceGroup(group, next);
    return true;
  }

  deleteGroup(group: string): void {
    if (this.groups.includes(group)) this.replaceGroup(group, "");
  }

  private replaceGroup(group: string, next: string): void {
    const parent = this.parentGroup(group);
    this.parents.delete(group);
    for (const [child, currentParent] of this.parents) {
      if (currentParent === group) this.setParent(child, next || parent);
    }
    if (next) this.setParent(next, parent);
    const groups = this.groups.filter((item) => next || item !== group).map((item) => item === group ? next : item);
    this.publish(
      this.current.map((preset) => preset.group === group ? { ...preset, group: next } : preset),
      groups,
    );
  }

  move(id: string, group: string, beforeId: string | null): void {
    const preset = this.current.find((item) => item.id === id);
    if (!preset || id === beforeId) return;
    const remaining = this.current.filter((item) => item.id !== id);
    const before = remaining.findIndex((item) => item.id === beforeId && item.group === group);
    const last = remaining.map((item) => item.group).lastIndexOf(group);
    const index = before >= 0 ? before : last >= 0 ? last + 1 : remaining.length;
    remaining.splice(index, 0, preset.group === group ? preset : { ...preset, group });
    if (remaining.every((item, position) => item === this.current[position])) return;
    this.publish(remaining);
  }

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loadPromise) this.loadPromise = this.hydrate();
    return this.loadPromise;
  }

  /** Saving under an existing name (ignoring case) replaces that preset. */
  save(name: string, settings: PostProcessSettings, group: string = ""): PostProcessPreset | null {
    const cleanName = name.trim();
    if (!cleanName) return null;
    const existing = this.current.find((preset) => this.sameName(preset.name, cleanName));
    const preset: PostProcessPreset = {
      id: existing?.id ?? this.createId(),
      name: cleanName,
      group: group.trim(),
      values: this.codec.valuesOf(settings),
    };
    this.publish(
      existing ? this.current.map((item) => (item === existing ? preset : item)) : [...this.current, preset],
    );
    return preset;
  }

  rename(id: string, name: string): boolean {
    const next = name.trim();
    const preset = this.current.find((item) => item.id === id);
    if (!preset || !next || this.current.some((item) => item.id !== id && this.sameName(item.name, next))) {
      return false;
    }
    if (preset.name !== next) {
      this.publish(this.current.map((item) => item === preset ? { ...item, name: next } : item));
    }
    return true;
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
      return { id: this.createId(), name, group: preset.group ?? "", values: structuredClone(preset.values) };
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
        const stored: unknown = JSON.parse(raw);
        if (Array.isArray(stored)) {
          this.current = this.codec.parse(raw);
        } else if (stored && typeof stored === "object" && "presets" in stored) {
          this.current = this.codec.parse(JSON.stringify(stored.presets));
          if ("groups" in stored && Array.isArray(stored.groups)) {
            this.savedGroups = stored.groups.filter((group): group is string => typeof group === "string" && !!group.trim());
          }
          if ("parents" in stored && stored.parents && typeof stored.parents === "object") {
            for (const [group, parent] of Object.entries(stored.parents)) {
              if (typeof parent === "string" && this.canMoveGroup(group, parent)) this.setParent(group, parent);
            }
          }
        }
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

  private publish(presets: PostProcessPreset[], groups = this.groups): void {
    this.savedGroups = [...groups];
    this.current = presets;
    void this.persist().catch(() => {});
    this.changes.emit(this.current);
  }

  private persist(): Promise<void> {
    const presetsJson = JSON.stringify({ groups: this.groups, parents: Object.fromEntries(this.parents), presets: this.current });
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

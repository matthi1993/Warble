import type { PostProcessPreset, PostProcessSettings, PostProcessStore, PresetStore } from "@warble/editing";
import type { Dialogs } from "@app/platform/desktop";

export interface PostPresetsHost {
  requestUpdate(): void;
}

/** Saving, previewing, applying and deleting presets of the global Post settings. */
export class PostPresetsController {
  open = true;
  readonly openGroups = new Set<string>();
  name = "";
  group = "";

  private stopListening: Array<() => void> = [];

  constructor(
    private readonly host: PostPresetsHost,
    private readonly post: PostProcessStore,
    private readonly presetStore: PresetStore,
    private readonly dialogs: Pick<Dialogs, "ask">,
  ) {}

  get presets(): readonly PostProcessPreset[] {
    return this.presetStore.presets;
  }

  get groups(): readonly string[] {
    return this.presetStore.groups;
  }

  groupsIn(parent: string): readonly string[] {
    return this.groups.filter((group) => this.parentGroup(group) === parent);
  }

  parentGroup(group: string): string {
    return this.presetStore.parentGroup(group);
  }

  groupPath(group: string): string {
    const parent = this.parentGroup(group);
    return parent ? `${this.groupPath(parent)} / ${group}` : group;
  }

  canMoveGroup(group: string, parent: string): boolean {
    return this.presetStore.canMoveGroup(group, parent);
  }

  moveGroup(group: string, parent: string, before: string | null): void {
    this.presetStore.moveGroup(group, parent, before);
    this.openGroupPath(parent);
    this.host.requestUpdate();
  }

  private openGroupPath(group: string): void {
    for (let current = group; current; current = this.parentGroup(current)) this.openGroups.add(current);
  }

  createGroup(name: string): void {
    const group = this.presetStore.createGroup(name);
    if (!group) return;
    this.group = group;
    this.openGroups.add(group);
    this.host.requestUpdate();
  }

  renameGroup(group: string, name: string): boolean {
    if (!this.presetStore.renameGroup(group, name)) return false;
    const next = name.trim();
    if (this.openGroups.delete(group)) this.openGroups.add(next);
    if (this.group === group) this.group = next;
    this.host.requestUpdate();
    return true;
  }

  async deleteGroup(group: string): Promise<boolean> {
    const confirmed = await this.dialogs.ask(`Delete the group “${group}”? Its presets will move to Ungrouped. Any subgroups will move up one level.`, {
      title: "Delete group",
      kind: "warning",
    });
    if (!confirmed) return false;
    this.presetStore.deleteGroup(group);
    this.openGroups.delete(group);
    if (this.group === group) this.group = "";
    this.host.requestUpdate();
    return true;
  }

  move(id: string, group: string, beforeId: string | null): void {
    this.openGroupPath(group);
    this.presetStore.move(id, group, beforeId);
    this.host.requestUpdate();
  }

  get canSave(): boolean {
    return this.name.trim() !== "";
  }

  connect(): void {
    const update = () => this.host.requestUpdate();
    this.stopListening = [this.presetStore.subscribe(update), this.post.subscribe(update)];
  }

  disconnect(): void {
    this.post.clearPreview();
    for (const stop of this.stopListening) stop();
    this.stopListening = [];
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.host.requestUpdate();
  }

  toggleGroup(group: string): void {
    if (!this.openGroups.delete(group)) this.openGroups.add(group);
    this.host.requestUpdate();
  }

  setName(name: string): void {
    this.name = name;
    this.host.requestUpdate();
  }

  setGroup(group: string): void {
    this.group = group;
    this.host.requestUpdate();
  }

  isActive(preset: PostProcessPreset): boolean {
    return this.presetStore.matches(preset, this.post.committed);
  }

  preview(preset: PostProcessPreset): void {
    this.post.preview(this.settingsOf(preset));
  }

  stopPreview(): void {
    this.post.clearPreview();
  }

  apply(preset: PostProcessPreset): void {
    this.post.replace(this.settingsOf(preset));
  }

  rename(preset: PostProcessPreset, name: string): boolean {
    return this.presetStore.rename(preset.id, name);
  }

  async remove(preset: PostProcessPreset): Promise<void> {
    const confirmed = await this.dialogs.ask(`Delete the preset “${preset.name}”?`, {
      title: "Delete preset",
      kind: "warning",
    });
    if (!confirmed) return;
    this.post.clearPreview();
    this.presetStore.remove(preset.id);
  }

  save(): void {
    if (!this.canSave) return;
    this.presetStore.save(this.name, this.post.committed, this.group);
    this.setName("");
    this.openGroupPath(this.group);
  }

  private settingsOf(preset: PostProcessPreset): PostProcessSettings {
    return this.presetStore.settingsFrom(preset, this.post.committed);
  }
}

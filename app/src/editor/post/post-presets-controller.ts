import type { PostProcessPreset, PostProcessSettings, PostProcessStore, PresetStore } from "@warble/editing";
import type { Dialogs } from "@app/platform/desktop";

export interface PostPresetsHost {
  requestUpdate(): void;
}

/** Saving, previewing, applying and deleting presets of the global Post settings. */
export class PostPresetsController {
  open = true;
  name = "";

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

  setName(name: string): void {
    this.name = name;
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
    this.presetStore.save(this.name, this.post.committed);
    this.setName("");
  }

  private settingsOf(preset: PostProcessPreset): PostProcessSettings {
    return this.presetStore.settingsFrom(preset, this.post.committed);
  }
}

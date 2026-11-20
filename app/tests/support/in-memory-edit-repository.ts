import type { EditRepository, PersistedPhotoEdit } from "@warble/editing";

export class InMemoryEditRepository implements EditRepository {
  private readonly rows = new Map<string, PersistedPhotoEdit>();
  private effectsJson: string | null = null;
  private presetsJson: string | null = null;

  async getPhotoEdits(): Promise<PersistedPhotoEdit[]> {
    return [...this.rows.values()];
  }

  async setPhotoEdit(edit: PersistedPhotoEdit): Promise<void> {
    this.rows.set(edit.path, structuredClone(edit));
  }

  async clearPhotoEdit(path: string): Promise<void> {
    this.rows.delete(path);
  }

  async getPhotoEffects(): Promise<string | null> {
    return this.effectsJson;
  }

  async setPhotoEffects(effectsJson: string): Promise<void> {
    this.effectsJson = effectsJson;
  }

  async getPostProcessPresets(): Promise<string | null> {
    return this.presetsJson;
  }

  async setPostProcessPresets(presetsJson: string): Promise<void> {
    this.presetsJson = presetsJson;
  }
}

import { invoke } from "@tauri-apps/api/core";
import type { EditRepository, PersistedPhotoEdit } from "@warble/editing";

export class TauriEditRepository implements EditRepository {
  getPhotoEdits(): Promise<PersistedPhotoEdit[]> {
    return invoke<PersistedPhotoEdit[]>("get_photo_edits");
  }

  setPhotoEdit({ path, crop, tone, curve, color }: PersistedPhotoEdit): Promise<void> {
    return invoke("set_photo_edit", { path, crop, tone, curve, color });
  }

  clearPhotoEdit(path: string): Promise<void> {
    return invoke("clear_photo_edit", { path });
  }

  getPhotoEffects(): Promise<string | null> {
    return invoke<string | null>("get_photo_effects");
  }

  setPhotoEffects(effectsJson: string): Promise<void> {
    return invoke("set_photo_effects", { effectsJson });
  }

  getPostProcessPresets(): Promise<string | null> {
    return invoke<string | null>("get_post_process_presets");
  }

  setPostProcessPresets(presetsJson: string): Promise<void> {
    return invoke("set_post_process_presets", { presetsJson });
  }
}

/** Presets travel as one JSON document; `null` means nothing was ever saved. */
export interface PresetRepository {
  getPostProcessPresets(): Promise<string | null>;
  setPostProcessPresets(presetsJson: string): Promise<void>;
}

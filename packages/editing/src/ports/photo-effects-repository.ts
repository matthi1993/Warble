/** The effects of every photo travel as one JSON document; `null` means nothing was ever saved. */
export interface PhotoEffectsRepository {
  getPhotoEffects(): Promise<string | null>;
  setPhotoEffects(effectsJson: string): Promise<void>;
}

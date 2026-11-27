import type { PhotoEditRepository } from "./photo-edit-repository";
import type { PhotoEffectsRepository } from "./photo-effects-repository";
import type { PresetRepository } from "./preset-repository";

export interface EditRepository extends PhotoEditRepository, PhotoEffectsRepository, PresetRepository {}

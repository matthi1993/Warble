import type { CropFrame, EffectLayer, LayerId } from "@warble/render";

export interface SavedCrop extends CropFrame {
  readonly rotation?: number;
}

export interface EditStateListener {
  /** The photo the listener shows; changes to other photos are not reported. */
  path(): string | null;
  onEdit(path: string): void;
  onPostEnabled(enabled: boolean): void;
  onEffects(): void;
  onEffectEnabled(layer: LayerId, effectId: string): void;
}

export interface EditStatePort {
  crop(path: string | null): SavedCrop | null;
  cropEnabled(path: string | null): boolean;
  postEnabled(): boolean;
  layer(layer: LayerId, path: string | null): EffectLayer;
  subscribe(listener: EditStateListener): () => void;
}

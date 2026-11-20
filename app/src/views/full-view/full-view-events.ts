import type { Photo } from "@warble/library";

export type CatalogChangeKind = "save" | "variant-delete" | "photo-delete";

export interface FullViewEvents {
  navigate(index: number): void;
  slideshowStart(): void;
  toggleWindowFullscreen(): void;
  toggleImmersiveView(): void;
  controlsVisibility(hidden: boolean): void;
  /** Resolves once the listener has finished refreshing the catalog. */
  catalogChanged(kind: CatalogChangeKind, photo: Photo, previousIndex: number): Promise<void>;
}

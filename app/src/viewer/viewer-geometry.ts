import { ImageGeometry, RotatedImageBounds, type DisplayImage, type ImageSource } from "@warble/render";
import type { ImageSources } from "./image-sources";
import type { ViewerEdits } from "./viewer-edits";
import type { ViewerSettings } from "./viewer-settings";
import type { ViewerSurface } from "./viewer-surface";

export class ViewerGeometry {
  constructor(
    private readonly settings: ViewerSettings,
    private readonly sources: ImageSources,
    private readonly edits: ViewerEdits,
    private readonly surface: ViewerSurface,
    private readonly geometry = new ImageGeometry(),
  ) {}

  image(): DisplayImage | null {
    const source = this.sources.current;
    if (!source) return null;
    const { autoRotate, cropMode, editing, smoothingQuality } = this.settings;
    const followsScreen = this.surface.attached && autoRotate && !cropMode && !editing;
    return this.geometry.resolve({
      source,
      rotation: this.edits.rotation(),
      crop: this.edits.appliedCrop(),
      smoothingQuality,
      screenLandscape: followsScreen ? this.surface.screenLandscape : null,
    });
  }

  rotated(bitmap: ImageBitmap): ImageSource {
    return this.geometry.rotated(bitmap, this.edits.rotation(), this.settings.smoothingQuality);
  }

  /** Only meaningful in the crop tool, where the image is shown uncropped and upright. */
  rotatedBounds(): RotatedImageBounds | null {
    const original = this.sources.current;
    const shown = this.image();
    if (!original || !shown) return null;
    return new RotatedImageBounds(original, shown.source, this.edits.rotation());
  }

  releaseRotations(): void {
    this.geometry.releaseRotations();
  }

  releasePresentation(): void {
    this.geometry.releasePresentation();
  }
}

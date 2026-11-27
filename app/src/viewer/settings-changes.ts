import type { CropSession } from "./crop-session";
import type { ImageLoader } from "./image-loader";
import type { ViewerEdits } from "./viewer-edits";
import type { ViewerInput } from "./viewer-input";
import type { ViewerScene } from "./viewer-scene";
import type { ChangedSettings, ViewerHost } from "./viewer-settings";

export class SettingsChanges {
  constructor(
    private readonly host: ViewerHost,
    private readonly scene: ViewerScene,
    private readonly loader: ImageLoader,
    private readonly edits: ViewerEdits,
    private readonly crop: CropSession,
    private readonly input: ViewerInput,
  ) {}

  apply(changed: ChangedSettings): void {
    const { host, scene } = this;
    if (changed.has("enableFullRes")) this.fullResolutionChanged();
    if (changed.has("path")) {
      this.pathChanged();
    } else if (
      changed.has("frameSize") ||
      changed.has("proofingSize") ||
      changed.has("sizing") ||
      changed.has("autoRotate") ||
      changed.has("editing")
    ) {
      scene.viewport.reset();
      this.resizeNextFrame();
    }
    if (changed.has("frameColor") || changed.has("frameRadius") || changed.has("smoothingQuality")) {
      scene.requestRedraw();
    }
    if (changed.has("cropMode")) this.cropModeChanged();
    if (changed.has("horizonMode")) host.cursor = host.horizonMode ? "horizon" : "";
    if (changed.has("rotation")) this.rotationChanged();
    // Opening the crop tool has already seeded the frame from the saved crop.
    if (changed.has("cropAspect") && host.cropMode && !changed.has("cropMode")) {
      this.crop.frame = this.crop.initialFrame();
      scene.redraw();
      this.crop.announceChange();
    }
    if (changed.has("background")) {
      host.style.setProperty("--pf-canvas-bg", host.background);
      scene.redraw();
    }
    if (changed.has("previewOriginal")) scene.requestRedraw();
    if (changed.has("editing")) {
      if (host.editing) scene.warmup();
      else scene.quality.endEdit();
    }
  }

  private fullResolutionChanged(): void {
    if (!this.loader.followFullResolution()) this.scene.quality.endEdit();
    this.scene.viewport.returnToFit();
    this.resizeNextFrame();
  }

  private pathChanged(): void {
    this.input.endLongPress();
    this.scene.geometry.releasePresentation();
    this.scene.viewport.reset();
    this.crop.end();
    this.edits.refreshSavedCrop();
    if (this.scene.surface.attached) this.loader.start();
  }

  private cropModeChanged(): void {
    const { host, scene } = this;
    scene.viewport.reset();
    if (host.cropMode) {
      this.crop.begin();
    } else {
      this.crop.end();
      host.cursor = "";
    }
    this.input.followCropMode();
    // The crop tool shows its live rotation instead of the saved one.
    scene.geometry.releaseRotations();
    scene.pipeline.releaseSources();
    this.resizeNextFrame();
  }

  private rotationChanged(): void {
    this.scene.viewport.reset();
    this.scene.pipeline.releaseSources();
    if (this.host.cropMode) this.crop.followRotation();
    this.resizeNextFrame();
  }

  private resizeNextFrame(): void {
    requestAnimationFrame(() => this.scene.resize());
  }
}

import type { LayerId } from "@warble/render";
import type { CropSession } from "./crop-session";
import type { EditStateListener, EditStatePort, SavedCrop } from "./edit-state-port";
import type { ViewerEdits } from "./viewer-edits";
import type { ViewerScene } from "./viewer-scene";
import type { ViewerSettings } from "./viewer-settings";

/** Edits are applied at draw time to the bitmap already loaded, so a change only redraws. */
export class EditStateSync implements EditStateListener {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly settings: Pick<ViewerSettings, "path" | "cropMode">,
    private readonly state: EditStatePort,
    private readonly edits: ViewerEdits,
    private readonly scene: ViewerScene,
    private readonly crop: CropSession,
  ) {}

  connect(): void {
    this.unsubscribe = this.state.subscribe(this);
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  path(): string | null {
    return this.settings.path;
  }

  onEdit(path: string): void {
    const previous = this.edits.savedCrop;
    this.edits.refreshSavedCrop();
    const saved = this.edits.savedCrop;
    if (cropChanged(previous, saved)) {
      // Only a new framing resets zoom and pan; tone edits keep the viewport.
      this.scene.viewport.returnToFit();
      if ((previous?.rotation ?? 0) !== (saved?.rotation ?? 0)) {
        this.scene.geometry.releaseRotations();
        this.scene.pipeline.releaseSources();
      }
      this.scene.fit();
      if (this.settings.cropMode && previous && !saved) this.crop.frame = this.crop.initialFrame();
    }
    if (path && path === this.settings.path) this.scene.quality.editChanged();
    this.scene.requestRedraw();
  }

  onPostEnabled(enabled: boolean): void {
    this.edits.postEnabled = enabled;
    this.scene.quality.editChanged();
    this.scene.requestRedraw();
  }

  onEffects(): void {
    this.scene.quality.editChanged();
    this.scene.requestRedraw();
  }

  onEffectEnabled(layer: LayerId, effectId: string): void {
    this.scene.quality.editChanged();
    const togglesCrop = layer === "photo" && (effectId === "crop" || effectId === "all");
    if (togglesCrop && this.edits.savedCrop) {
      this.scene.viewport.returnToFit();
      requestAnimationFrame(() => this.scene.resize());
    } else {
      this.scene.requestRedraw();
    }
  }
}

function cropChanged(previous: SavedCrop | null, saved: SavedCrop | null): boolean {
  if (!previous || !saved) return !!previous !== !!saved;
  return (
    previous.x !== saved.x ||
    previous.y !== saved.y ||
    previous.width !== saved.width ||
    previous.height !== saved.height ||
    previous.rotation !== saved.rotation
  );
}

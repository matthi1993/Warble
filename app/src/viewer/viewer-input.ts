import type { CropGestures } from "./crop-gestures";
import type { LongPress } from "./long-press";
import type { TapGestures } from "./tap-gestures";
import type { ViewerScene } from "./viewer-scene";
import type { ViewerSettings } from "./viewer-settings";
import type { ViewportGestures } from "./viewport-gestures";

export class ViewerInput {
  constructor(
    private readonly settings: Pick<ViewerSettings, "cropMode">,
    private readonly scene: ViewerScene,
    private readonly viewport: ViewportGestures,
    private readonly crop: CropGestures,
    private readonly taps: TapGestures,
    private readonly longPress: LongPress,
  ) {}

  attach(canvas: HTMLCanvasElement): void {
    window.addEventListener("blur", this.onWindowBlur);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("click", this.taps.onClick);
    canvas.addEventListener("dblclick", this.taps.onDoubleClick);
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener("blur", this.onWindowBlur);
    this.taps.cancelActivation();
    this.longPress.end();
  }

  followCropMode(): void {
    if (!this.settings.cropMode) this.crop.cancel();
    if (!this.scene.surface.attached) return;
    const canvas = this.scene.surface.canvas;
    if (this.settings.cropMode) canvas.addEventListener("pointermove", this.crop.onHover);
    else canvas.removeEventListener("pointermove", this.crop.onHover);
  }

  endLongPress(): void {
    this.longPress.end();
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.settings.cropMode) event.preventDefault();
    else this.viewport.onWheel(event);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.scene.hasImage) return;
    if (this.settings.cropMode) this.crop.begin(event);
    else this.viewport.begin(event);
  };

  private readonly onContextMenu = (event: MouseEvent): void => event.preventDefault();

  private readonly onWindowBlur = (): void => {
    this.longPress.end();
    this.scene.quality.endEdit();
    this.scene.quality.viewportSettled();
  };
}

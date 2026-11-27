import { cropEditsEqual, type AspectRatioKey, type CropEdit, type Orientation } from "../crop/crop-edit";
import {
  applyHorizonCorrection,
  effectiveAspect,
  flipOrientation,
  rotateQuarterTurn,
  straighten,
} from "../crop/crop-math";
import { EditTool } from "./edit-tool";
import type { ToolCanvasOverrides, ToolHost, ToolKeyEvent } from "./tool-host";

/**
 * Aspect, orientation and rotation are the tool's working values; the frame itself lives on the canvas.
 * Every interaction saves the canvas frame together with the working values as the photo's crop.
 */
export class CropTool extends EditTool {
  readonly id = "crop";

  aspect: AspectRatioKey = "3:2";
  orientation: Orientation = "landscape";
  rotation = 0;
  horizonModeActive = false;

  private ignoreCanvasChanges = false;

  activate(host: ToolHost): void {
    const saved = this.savedCrop(host.editTarget);
    if (saved) this.adopt(saved);
    else this.rotation = 0;
    this.horizonModeActive = false;
    this.cardOpen = true;
  }

  deactivate(host: ToolHost): void {
    this.persistFromCanvas(host);
    this.cardOpen = false;
    this.horizonModeActive = false;
    if (host.editTarget) void host.flushActiveEdit();
  }

  syncFromStore(target: string | null): void {
    const saved = this.savedCrop(target);
    if (saved) this.adopt(saved);
  }

  /** Opening the card by hand also makes this the tool that owns the canvas, like its shortcut does. */
  setCardOpen(host: ToolHost, open: boolean): void {
    if (open) this.activate(host);
    else this.deactivate(host);
    host.setActiveTool(open ? this.id : null);
    host.requestUpdate();
    if (!open && host.editTarget) void this.context.photoEdits.flush(host.editTarget);
  }

  hasEdits(target: string): boolean {
    return this.savedCrop(target) !== null;
  }

  canRevert(host: ToolHost): boolean {
    return host.editTarget ? this.hasEdits(host.editTarget) : false;
  }

  serializeEdit(target: string): unknown | null {
    const crop = this.savedCrop(target);
    return crop ? { ...crop } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    const target = host.editTarget;
    if (!target) return;
    if (data == null) {
      this.context.photoEdits.setCrop(target, null);
      this.syncFromStore(target);
    } else {
      const crop = data as CropEdit;
      this.context.photoEdits.setCrop(target, { ...crop });
      this.adopt(crop);
    }
    host.requestUpdate();
  }

  async reset(host: ToolHost): Promise<void> {
    const target = host.editTarget;
    if (!target || !this.savedCrop(target)) return;
    // The canvas answers the reset values with a crop change of its own; saving that
    // would put a stale frame back on top of the cleared crop.
    this.ignoreCanvasChanges = true;
    this.aspect = "3:2";
    this.orientation = "landscape";
    this.rotation = 0;
    this.horizonModeActive = false;
    host.requestUpdate();
    await this.nextFrame();
    await this.nextFrame();
    this.ignoreCanvasChanges = false;
    this.context.photoEdits.setCrop(target, null);
  }

  applyToCanvas(): ToolCanvasOverrides {
    return {
      cropMode: true,
      cropAspect: this.effectiveAspect(),
      rotation: this.rotation,
      horizonMode: this.horizonModeActive,
      sizing: "fit",
    };
  }

  /** Escape first leaves horizon mode. Otherwise Escape and Enter are left to the host, which exits the tool. */
  handleKey(event: ToolKeyEvent, host: ToolHost): boolean {
    if (event.key !== "Escape" && event.key !== "Enter") return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key !== "Escape" || !this.horizonModeActive) return false;
    this.horizonModeActive = false;
    host.requestUpdate();
    return true;
  }

  onCanvasCropChange(host: ToolHost): void {
    if (!this.ignoreCanvasChanges) this.persistFromCanvas(host);
  }

  onCanvasOrientationFlip(host: ToolHost): void {
    this.orientation = flipOrientation(this.orientation);
    host.requestUpdate();
  }

  onCanvasHorizonLine(host: ToolHost, delta: number): void {
    if (!Number.isFinite(delta)) return;
    this.horizonModeActive = false;
    this.rotate(host, applyHorizonCorrection(this.rotation, delta));
  }

  setAspect(host: ToolHost, aspect: AspectRatioKey): void {
    this.aspect = aspect;
    this.persistAndUpdate(host);
  }

  setOrientation(host: ToolHost, orientation: Orientation): void {
    this.orientation = orientation;
    this.persistAndUpdate(host);
  }

  rotateQuarterTurn(host: ToolHost, direction: -1 | 1): void {
    this.rotate(host, rotateQuarterTurn(this.rotation, direction));
  }

  setStraighten(host: ToolHost, degrees: number): void {
    const value = Number(degrees);
    if (Number.isFinite(value)) this.rotate(host, straighten(this.rotation, value));
  }

  toggleHorizonMode(host: ToolHost): void {
    this.horizonModeActive = !this.horizonModeActive;
    host.requestUpdate();
  }

  effectiveAspect(): number {
    return effectiveAspect(this.aspect, this.orientation);
  }

  persistFromCanvas(host: ToolHost): void {
    const target = host.editTarget;
    const frame = host.canvas?.getCropFrame();
    if (!target || !frame) return;
    const crop: CropEdit = {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      aspectRatio: this.aspect,
      orientation: this.orientation,
      rotation: this.rotation,
    };
    const saved = this.savedCrop(target);
    if (saved && cropEditsEqual(saved, crop)) return;
    this.context.photoEdits.setCrop(target, crop);
  }

  private savedCrop(target: string | null): CropEdit | null {
    return target ? this.context.photoEdits.crop(target) : null;
  }

  private adopt(crop: CropEdit): void {
    this.aspect = crop.aspectRatio;
    this.orientation = crop.orientation;
    this.rotation = crop.rotation ?? 0;
  }

  private rotate(host: ToolHost, rotation: number): void {
    this.rotation = rotation;
    this.persistAndUpdate(host);
  }

  private persistAndUpdate(host: ToolHost): void {
    this.persistFromCanvas(host);
    host.requestUpdate();
  }

  private nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
}

/**
 * Crop tool: aspect/orientation/rotation/horizon controls plus the
 * canvas overlay that lets the user drag a frame. State that used
 * to live as `@state` fields on `pf-full-view` now lives here.
 *
 * The tool's local mirror (`aspect`, `orientation`, `rotation`,
 * `horizonModeActive`) is re-hydrated from the edit store whenever
 * the active target changes, and pushed back into the store via
 * `persistFromCanvas()` on every interaction.
 */
import { html, type TemplateResult } from "lit";
import {
  ASPECT_RATIO_VALUES,
  cropEditsEqual,
  type AspectRatioKey,
  type CropEdit,
  type Orientation,
} from "@domain/edits";
import {
  flushPhotoEdit,
  getPhotoEdit,
  setPhotoCrop,
} from "@services/edits/edits-store";
import "./crop.ui";
import {
  EditTool,
  type ToolCanvasOverrides,
  type ToolHost,
} from "../../tool";

export class CropTool extends EditTool {
  readonly id = "crop";

  aspect: AspectRatioKey = "3:2";
  orientation: Orientation = "landscape";
  rotation = 0;
  horizonModeActive = false;
  /** Programmatic resets in flight: ignore canvas crop-change events. */
  private suppressPersist = false;

  activate(host: ToolHost): void {
    const target = host.editTarget;
    const saved = target ? getPhotoEdit(target)?.crop ?? null : null;
    if (saved) {
      this.aspect = saved.aspectRatio;
      this.orientation = saved.orientation;
      this.rotation = saved.rotation ?? 0;
    } else {
      this.rotation = 0;
    }
    this.horizonModeActive = false;
    this.cardOpen = true;
  }

  deactivate(host: ToolHost): void {
    // Apply the live crop frame before tearing down so the persisted
    // edit always reflects what the user just saw. The in-memory
    // store is updated synchronously by `setPhotoCrop`, then we
    // flush the debounced write to disk.
    this.persistFromCanvas(host);
    this.cardOpen = false;
    this.horizonModeActive = false;
    if (host.editTarget) void host.flushActiveEdit();
  }

  syncFromStore(target: string | null): void {
    if (!target) return;
    const saved = getPhotoEdit(target)?.crop ?? null;
    if (saved) {
      this.aspect = saved.aspectRatio;
      this.orientation = saved.orientation;
      this.rotation = saved.rotation ?? 0;
    }
  }

  hasEdits(target: string): boolean {
    return getPhotoEdit(target)?.crop != null;
  }

  serializeEdit(target: string): unknown | null {
    const crop = getPhotoEdit(target)?.crop ?? null;
    return crop ? { ...crop } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    const target = host.editTarget;
    if (!target) return;
    if (data == null) {
      setPhotoCrop(target, null);
      this.syncFromStore(target);
      host.requestUpdate();
      return;
    }
    const crop = data as CropEdit;
    setPhotoCrop(target, { ...crop });
    this.aspect = crop.aspectRatio;
    this.orientation = crop.orientation;
    this.rotation = crop.rotation ?? 0;
    host.requestUpdate();
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

  handleKey(e: KeyboardEvent, host: ToolHost): boolean {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.horizonModeActive) {
        this.horizonModeActive = false;
        host.requestUpdate();
        return true;
      }
      // Caller (shell) will treat this as a tool-exit signal.
      return false;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      // Caller (shell) treats Enter as tool-exit; let it bubble up
      // as unhandled (after preventing default).
      return false;
    }
    return false;
  }

  onCanvasCropChange(host: ToolHost): void {
    if (this.suppressPersist) return;
    this.persistFromCanvas(host);
  }

  onCanvasOrientationFlip(host: ToolHost): void {
    this.orientation =
      this.orientation === "landscape" ? "portrait" : "landscape";
    host.requestUpdate();
  }

  onCanvasHorizonLine(host: ToolHost, delta: number): void {
    if (!Number.isFinite(delta)) return;
    let next = (this.rotation || 0) + delta;
    while (next > 45) next -= 90;
    while (next < -45) next += 90;
    this.rotation = next;
    this.horizonModeActive = false;
    this.persistFromCanvas(host);
    host.requestUpdate();
  }

  /** Drop the persisted crop on the active target. */
  async reset(host: ToolHost): Promise<void> {
    const target = host.editTarget;
    if (!target) return;
    const saved = getPhotoEdit(target)?.crop ?? null;
    if (!saved) return;
    // Reset host UI BEFORE clearing the DB: the canvas will re-render
    // and dispatch crop-change as a side effect; suppress that so
    // we don't re-persist a stale frame on top of the cleared edit.
    this.suppressPersist = true;
    this.aspect = "3:2";
    this.orientation = "landscape";
    this.rotation = 0;
    this.horizonModeActive = false;
    host.requestUpdate();
    // Wait two animation frames so the canvas observes the new props
    // and emits its idempotent crop-change before we re-enable persist.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    this.suppressPersist = false;
    setPhotoCrop(target, null);
  }

  renderCard(host: ToolHost): TemplateResult {
    const target = host.editTarget;
    const canRevert = target ? this.hasEdits(target) : false;
    return html`
      <pf-crop-card
        ?open=${this.cardOpen}
        @tool-preview-start=${this.startBeforePreview}
        @tool-preview-end=${this.endBeforePreview}
        .aspect=${this.aspect}
        .orientation=${this.orientation}
        .rotation=${this.rotation}
        ?horizonMode=${this.horizonModeActive}
        ?canRevert=${canRevert}
        @toggle=${(e: CustomEvent<{ open: boolean }>) =>
          this.onCardToggle(host, e.detail.open)}
        @aspect-change=${(e: CustomEvent<AspectRatioKey>) => {
          this.aspect = e.detail;
          this.persistFromCanvas(host);
          host.requestUpdate();
        }}
        @orientation-change=${(e: CustomEvent<Orientation>) => {
          this.orientation = e.detail;
          this.persistFromCanvas(host);
          host.requestUpdate();
        }}
        @rotate-90=${(e: CustomEvent<-1 | 1>) => {
          let next = (this.rotation || 0) + e.detail * 90;
          while (next > 180) next -= 360;
          while (next <= -180) next += 360;
          this.rotation = next;
          this.persistFromCanvas(host);
          host.requestUpdate();
        }}
        @horizon-toggle=${() => {
          this.horizonModeActive = !this.horizonModeActive;
          host.requestUpdate();
        }}
        @rotation-change=${(e: CustomEvent<number>) => {
          const v = Number(e.detail);
          if (!Number.isFinite(v)) return;
          // Slider spans -45..45; preserve any 90° increments stamped
          // in by the rotate buttons.
          const base = Math.round((this.rotation || 0) / 90) * 90;
          this.rotation = base + v;
          this.persistFromCanvas(host);
          host.requestUpdate();
        }}
        @crop-reset=${() => this.reset(host)}
      ></pf-crop-card>
    `;
  }

  /** Effective aspect ratio (W/H) given the current preset + orientation. */
  effectiveAspect(): number {
    const a = ASPECT_RATIO_VALUES[this.aspect];
    return this.orientation === "portrait" ? 1 / a : a;
  }

  /** Pull the current frame from the canvas and persist as the saved
   *  crop, debounced via the edit store. */
  persistFromCanvas(host: ToolHost): void {
    const target = host.editTarget;
    if (!target) return;
    const frame = host.canvas?.getCropFrame();
    if (!frame) return;
    const crop: CropEdit = {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      aspectRatio: this.aspect,
      orientation: this.orientation,
      rotation: this.rotation,
    };
    const prev = getPhotoEdit(target)?.crop ?? null;
    if (prev && cropEditsEqual(prev, crop)) return;
    setPhotoCrop(target, crop);
  }

  private onCardToggle(host: ToolHost, open: boolean): void {
    if (open) {
      this.activate(host);
      // Mouse-driven card open also makes us the active (canvas-
      // owning) tool, so the overlay engages just like when the
      // user hit the `C` shortcut.
      host.setActiveTool(this.id);
    } else {
      this.deactivate(host);
      host.setActiveTool(null);
    }
    // Signal the shell that active-tool status changed.
    host.requestUpdate();
    const target = host.editTarget;
    if (!open && target) void flushPhotoEdit(target);
  }
}

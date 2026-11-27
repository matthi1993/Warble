import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { CropFrame, ImageSizing, ImageSmoothingQuality } from "@warble/render";
import { ImageViewer } from "./image-viewer";
import { imageCanvasStyles } from "./pf-image-canvas.styles";
import { viewerDependencies } from "./viewer-dependencies";
import type { ChangedSettings, ViewerCursor } from "./viewer-settings";

export type { CropFrame, ImageSizing, ImageSmoothingQuality } from "@warble/render";

@customElement("pf-image-canvas")
export class PfImageCanvas extends LitElement {
  static styles = imageCanvasStyles;

  @property({ type: String })
  path: string | null = null;

  @property({ type: Boolean, reflect: true })
  presenting = false;

  @property({ type: Number })
  frameSize = 0;

  @property({ type: Number })
  proofingSize = 0;

  @property({ type: String })
  frameColor = "#fff";

  @property({ type: Number })
  frameRadius = 0;

  @property({ type: String, reflect: true })
  sizing: ImageSizing = "fit";

  @property({ type: Boolean })
  autoRotate = false;

  @property({ type: String })
  smoothingQuality: ImageSmoothingQuality = "high";

  @property({ type: String })
  background = "transparent";

  @property({ type: Boolean, reflect: true })
  cropMode = false;

  @property({ type: Boolean, reflect: true })
  editing = false;

  /** Upgrades from the HD preview to the full-resolution image after a short linger. */
  @property({ type: Boolean })
  enableFullRes = true;

  /** Locked width / height of the crop frame; `null` leaves it free. */
  @property({ type: Number })
  cropAspect: number | null = null;

  /** Degrees applied before the crop while the crop tool is open. */
  @property({ type: Number })
  rotation = 0;

  @property({ type: Boolean, reflect: true })
  horizonMode = false;

  /** Reflected so the styles can pick the cursor for the current crop interaction. */
  @property({ type: String, reflect: true })
  cursor: ViewerCursor = "";

  /** Shows the image without effects while keeping the current framing. */
  @property({ type: Boolean, reflect: true })
  previewOriginal = false;

  private readonly viewer = new ImageViewer(this, viewerDependencies);

  firstUpdated(): void {
    this.viewer.connect(this.renderRoot.querySelector("canvas") as HTMLCanvasElement);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.viewer.disconnect();
  }

  willUpdate(changed: PropertyValues<this>): void {
    this.viewer.settingsChanged(changed as ChangedSettings);
  }

  get imageReady(): boolean {
    return this.viewer.imageReady;
  }

  beginEditInteraction(): void {
    this.viewer.beginEditInteraction();
  }

  endEditInteraction(): void {
    this.viewer.endEditInteraction();
  }

  reloadSource(): void {
    this.viewer.reloadSource();
  }

  resetView(): void {
    this.viewer.resetView();
  }

  exportJpeg(): Promise<Uint8Array> {
    return this.viewer.exportJpeg();
  }

  getCropFrame(): CropFrame | null {
    return this.viewer.getCropFrame();
  }

  setCropFrame(frame: CropFrame | null): void {
    this.viewer.setCropFrame(frame);
  }

  render() {
    const { status, errorMessage, awaitingFirstImage, upgradingToFullResolution } = this.viewer;
    return html`
      <canvas></canvas>
      ${status === "error" ? html`<div class="status error">Failed to load: ${errorMessage}</div>` : null}
      ${awaitingFirstImage ? html`<div class="status">Loading…</div>` : null}
      ${upgradingToFullResolution
        ? html`<div class="loading-spinner" role="status" aria-label="Loading full resolution"></div>`
        : null}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-image-canvas": PfImageCanvas;
  }
}

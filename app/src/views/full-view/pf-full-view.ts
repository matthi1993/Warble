import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { EditTool } from "@warble/editing";
import type { Photo } from "@warble/library";
import { app } from "@app/composition/app";
import "@app/editor";
import "@app/views/rating/pf-rating-overlay";
import "@ui/controls/pf-effect-toggle";
import "@ui/controls/pf-icon-button";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";
import "@viewer/pf-image-canvas";
import "@viewer/pf-video-view";
import { renderBottombar } from "./bottombar-renderer";
import { CanvasSlideOverlay } from "./canvas-slide-overlay";
import { ChromeSizeController } from "./chrome-size-controller";
import { EditClipboard } from "./edit-clipboard";
import { FullViewController } from "./full-view-controller";
import { FullViewEventDispatcher } from "./full-view-event-dispatcher";
import "./pf-edit-side-panel";
import { fullViewStyles } from "./pf-full-view.styles";
import "./pf-info-card";
import { renderSidePanel } from "./side-panel-renderer";
import { renderSideRail } from "./side-rail-renderer";
import { renderStage } from "./stage-renderer";
import { renderToolbar } from "./toolbar-renderer";

@customElement("pf-full-view")
export class PfFullView extends LitElement {
  static styles = fullViewStyles;

  /** One clipboard for every full view, so copied edits survive closing and reopening the view. */
  private static readonly editClipboard = new EditClipboard();

  @property({ attribute: false })
  photos: Photo[] = [];

  @property({ type: Number })
  index = 0;

  @property({ type: Boolean, reflect: true })
  immersive = false;

  @property({ type: Boolean })
  windowFullscreen = false;

  @property({ type: Boolean, reflect: true, attribute: "controls-hidden" })
  controlsHidden = false;

  @property({ type: Boolean, reflect: true, attribute: "edit-panel-open" })
  editPanelOpen = false;

  @property({ type: Boolean, reflect: true })
  private presenting = false;

  private readonly controller = new FullViewController(
    {
      host: this,
      events: new FullViewEventDispatcher(this),
      overlay: new CanvasSlideOverlay(
        () => this.renderRoot.querySelector<HTMLCanvasElement>(".slideshow-overlay"),
        () => this.imageCanvas?.renderRoot.querySelector("canvas") ?? null,
      ),
      clipboard: PfFullView.editClipboard,
      canvas: () => this.imageCanvas,
      videoView: () => this.renderRoot.querySelector("pf-video-view"),
    },
    app,
  );
  private readonly chromeSize = new ChromeSizeController(this);
  private readonly onKeyDown = (event: KeyboardEvent) => this.controller.keyboard.handle(event);
  private readonly onWindowClick = (event: MouseEvent) =>
    this.controller.menus.closeOnOutsideClick(event.composedPath(), this);

  get presentationActive(): boolean {
    return this.controller.slideshow.presenting;
  }

  readonly deletePhoto = (): Promise<void> => this.controller.variants.deletePhoto();

  startPresentation(): void {
    this.controller.slideshow.start();
  }

  stopPresentation(): void {
    this.controller.slideshow.stop();
  }

  toggleVideoPlayback(): boolean {
    return this.controller.toggleVideoPlayback();
  }

  refreshPhotoSource(path: string): void {
    this.controller.refreshPhotoSource(path);
  }

  toggleTool(tool: EditTool): void {
    this.controller.editing.toggleTool(tool);
  }

  toggleToolById(id: string): void {
    this.controller.editing.toggleToolById(id);
  }

  toggleToneCard(): void {
    this.controller.editing.toggleCard("tone");
  }

  toggleCurveCard(): void {
    this.controller.editing.toggleCard("curve");
  }

  toggleColorCard(): void {
    this.controller.editing.toggleCard("color");
  }

  togglePostCurveCard(): void {
    this.controller.panel.openTab("post");
    this.requestUpdate();
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("click", this.onWindowClick, { capture: true });
    this.controller.connect();
    this.tabIndex = -1;
    queueMicrotask(() => this.focus());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.controller.disconnect();
    this.chromeSize.disconnect();
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("click", this.onWindowClick, { capture: true });
  }

  firstUpdated(): void {
    this.chromeSize.observe(this.renderRoot);
  }

  willUpdate(changed: PropertyValues<this>): void {
    const { controls, panel, slideshow } = this.controller;
    const writtenFromOutside = this.hasUpdated && changed.has("controlsHidden");
    if (writtenFromOutside) controls.adopt(this.controlsHidden);
    this.controller.propertiesChanged({
      immersive: changed.has("immersive"),
      photos: changed.has("photos"),
      index: changed.has("index"),
    });
    this.controlsHidden = controls.hidden;
    this.editPanelOpen = panel.open;
    if (this.presenting !== slideshow.presenting) this.presenting = slideshow.presenting;
    this.applyBackground();
  }

  updated(): void {
    this.controller.rendered();
  }

  private get imageCanvas() {
    return this.renderRoot.querySelector("pf-image-canvas");
  }

  private applyBackground(): void {
    const { backgroundCss, foregroundCss } = this.controller.viewState;
    if (this.style.getPropertyValue("--pf-fv-bg") === backgroundCss) return;
    this.style.setProperty("--pf-fv-bg", backgroundCss);
    this.style.setProperty("--pf-fv-fg", foregroundCss);
  }

  render() {
    const { stage, panel } = this.controller;
    const photo = stage.currentPhoto;
    if (!photo) return html``;
    return html`
      <div class="toolbar-wrap">${renderToolbar(this.controller, photo)}</div>
      <div class="stage-row">
        ${renderStage(this.controller, this.controller.resolver.resolvedPath(photo))}
        ${stage.presenting ? null : renderSideRail(this.controller)}
        ${!stage.presenting && panel.open ? renderSidePanel(this.controller) : null}
      </div>
      <div class="bottombar-wrap">${renderBottombar(this.controller)}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-full-view": PfFullView;
  }
}

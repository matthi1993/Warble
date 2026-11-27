import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { app } from "@app/composition/app";
import { videoViewStyles } from "./pf-video-view.styles";
import { VideoGestureController } from "./video-gesture-controller";
import { VideoPlaybackController } from "./video-playback-controller";
import { VideoPosterController } from "./video-poster-controller";
import { VideoViewEvents } from "./video-view-events";

@customElement("pf-video-view")
export class PfVideoView extends LitElement {
  static styles = videoViewStyles;

  @property({ type: String })
  path: string | null = null;

  @property({ type: Number })
  proofingSize = 0;

  @property({ type: Number })
  frameSize = 0;

  @property({ type: String })
  frameColor = "#fff";

  @property({ type: Number })
  frameRadius = 0;

  @property({ type: String, reflect: true })
  sizing = "fit";

  @property({ type: String })
  background = "#000";

  @property({ type: Boolean })
  presenting = false;

  private readonly events = new VideoViewEvents(this);
  private readonly poster = new VideoPosterController(this);
  private readonly playback = new VideoPlaybackController(
    this,
    () => this.renderRoot.querySelector("video"),
    app.media.videos,
    this.poster,
    this.events,
  );
  private readonly gestures = new VideoGestureController(this, this.events);

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.gestures.cancelPendingActivation();
    this.poster.reset();
  }

  togglePlayback(): boolean {
    return this.playback.toggle();
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("path")) this.playback.pathChanged();
  }

  protected updated(changed: PropertyValues<this>): void {
    this.playback.rendered(changed.has("presenting"));
  }

  private onPlaying(): void {
    if (this.presenting) this.events.presentation("video-playing");
  }

  private onEnded(): void {
    if (this.presenting) this.events.presentation("video-ended");
  }

  private renderContent() {
    const { error, url } = this.playback;
    if (error) return html`<span class="error">${error}</span>`;
    if (!url) return html`<span role="status">Loading video…</span>`;
    return html`<div class="frame">
      <video
        src=${url}
        poster=${this.poster.url ?? ""}
        ?controls=${!this.presenting}
        playsinline
        preload="metadata"
        @click=${(event: MouseEvent) => this.gestures.clicked(event)}
        @dblclick=${(event: MouseEvent) => this.gestures.doubleClicked(event)}
        @playing=${this.onPlaying}
        @ended=${this.onEnded}
        @error=${() => this.playback.playbackFailed()}
      ></video>
    </div>`;
  }

  render() {
    const styles = `--proof-size:${this.proofingSize}px;--frame-size:${this.frameSize}px;--frame-color:${this.frameColor};--frame-radius:${this.frameRadius}px;--video-background:${this.background}`;
    return html`<div
      class="proof"
      style=${styles}
      @pointerdown=${(event: PointerEvent) => this.gestures.pointerDown(event)}
      @pointerup=${(event: PointerEvent) => this.gestures.pointerUp(event)}
      @pointercancel=${(event: PointerEvent) => this.gestures.pointerUp(event)}
    >
      ${this.renderContent()}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-video-view": PfVideoView;
  }
}

import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { videoSource } from "@services/images/video-source";

@customElement("pf-video-view")
export class PfVideoView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: var(--video-background, #000);
    }
    .proof {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      padding: var(--proof-size);
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      min-height: 0;
    }
    .frame {
      box-sizing: border-box;
      max-width: 100%;
      max-height: 100%;
      padding: var(--frame-size);
      background: var(--frame-color);
      border-radius: var(--frame-radius);
      overflow: hidden;
      display: flex;
      min-width: 0;
      min-height: 0;
    }
    video {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: var(--frame-radius);
      background: #000;
    }
    :host([sizing="fill"]) .proof, :host([sizing="fill"]) .frame {
      width: 100%;
      height: 100%;
    }
    :host([sizing="fill"]) video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .error { color: #ff8080; padding: 1rem; }
  `;

  @property({ type: String }) path: string | null = null;
  @property({ type: Number }) proofingSize = 0;
  @property({ type: Number }) frameSize = 0;
  @property({ type: String }) frameColor = "#fff";
  @property({ type: Number }) frameRadius = 0;
  @property({ type: String, reflect: true }) sizing = "fit";
  @property({ type: String }) background = "#000";
  @property({ type: Boolean }) presenting = false;

  @state() private url: string | null = null;
  @state() private posterUrl: string | null = null;
  @state() private error: string | null = null;
  private posterRequest = 0;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.posterRequest++;
    this.clearPoster();
  }

  private clearPoster(): void {
    if (this.posterUrl) URL.revokeObjectURL(this.posterUrl);
    this.posterUrl = null;
  }

  private async loadPoster(path: string, url: string): Promise<void> {
    const request = ++this.posterRequest;
    const source = document.createElement("video");
    source.crossOrigin = "anonymous";
    source.muted = true;
    source.preload = "auto";

    try {
      await new Promise<void>((resolve, reject) => {
        source.addEventListener("loadeddata", () => resolve(), { once: true });
        source.addEventListener("error", () => reject(new Error("Video preview unavailable")), { once: true });
        source.src = url;
      });
      if (request !== this.posterRequest || path !== this.path || !this.isConnected) return;

      const scale = Math.min(1, 640 / Math.max(source.videoWidth, source.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(source.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob || request !== this.posterRequest || path !== this.path || !this.isConnected) return;
      this.clearPoster();
      this.posterUrl = URL.createObjectURL(blob);
    } catch {
      // The native video still works when the WebView does not allow poster extraction.
    } finally {
      source.removeAttribute("src");
      source.load();
    }
  }

  togglePlayback(): boolean {
    const video = this.renderRoot.querySelector("video");
    if (!video) return false;
    if (video.paused) {
      void video.play().catch(() => {
        this.error = "Video playback is unavailable on this device.";
      });
    } else {
      video.pause();
    }
    return true;
  }

  private onPlaybackError = () => {
    this.error = "This device cannot play the video's codec.";
    if (this.presenting) this.emitPresentationEvent("video-error");
  };

  private emitPresentationEvent(type: string): void {
    this.dispatchEvent(new CustomEvent(type, { detail: { path: this.path } }));
  }

  private onVideoClick = (event: Event) => {
    event.stopPropagation();
    if (this.presenting) this.emitPresentationEvent("video-activate");
  };

  private onPlaying = () => {
    if (this.presenting) this.emitPresentationEvent("video-playing");
  };

  private onEnded = () => {
    if (this.presenting) this.emitPresentationEvent("video-ended");
  };

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has("url") && !changed.has("presenting")) return;
    const video = this.renderRoot.querySelector("video");
    if (!video) return;
    if (!this.presenting) {
      video.pause();
      return;
    }
    if (changed.has("presenting")) {
      video.currentTime = 0;
      video.muted = false;
    }
    void video.play().catch(async () => {
      if (!this.presenting || video !== this.renderRoot.querySelector("video")) return;
      video.muted = true;
      try {
        await video.play();
      } catch {
        if (this.presenting && video === this.renderRoot.querySelector("video")) {
          this.error = "Video autoplay is unavailable on this device.";
          this.emitPresentationEvent("video-error");
        }
      }
    });
  }

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("path")) {
      this.posterRequest++;
      this.clearPoster();
      this.url = null;
      this.error = null;
      const path = this.path;
      if (path) void videoSource(path).then((url) => {
        if (this.path === path && this.isConnected) {
          this.url = url;
          void this.loadPoster(path, url);
        }
      }).catch((error) => {
        if (this.path === path && this.isConnected) {
          this.error = String(error);
          if (this.presenting) this.emitPresentationEvent("video-error");
        }
      });
    }
  }

  render() {
    const styles = `--proof-size:${this.proofingSize}px;--frame-size:${this.frameSize}px;--frame-color:${this.frameColor};--frame-radius:${this.frameRadius}px;--video-background:${this.background}`;
    return html`<div class="proof" style=${styles}>
      ${this.error ? html`<span class="error">${this.error}</span>` : this.url
        ? html`<div class="frame"><video src=${this.url} poster=${this.posterUrl ?? ""} ?controls=${!this.presenting} playsinline preload="metadata"
          @click=${this.onVideoClick}
          @playing=${this.onPlaying}
          @ended=${this.onEnded}
          @error=${this.onPlaybackError}></video></div>`
        : html`<span role="status">Loading video…</span>`}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "pf-video-view": PfVideoView; }
}

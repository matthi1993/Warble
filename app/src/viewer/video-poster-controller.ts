import type { VideoViewHost } from "./video-view-host";

const POSTER_MAX_EDGE = 640;
const POSTER_JPEG_QUALITY = 0.82;

export class VideoPosterController {
  private posterUrl: string | null = null;
  private request = 0;

  constructor(private readonly view: VideoViewHost) {}

  get url(): string | null {
    return this.posterUrl;
  }

  reset(): void {
    this.request++;
    this.clear();
  }

  async load(path: string, sourceUrl: string): Promise<void> {
    const request = ++this.request;
    const superseded = () => request !== this.request || path !== this.view.path || !this.view.isConnected;
    const source = document.createElement("video");
    source.crossOrigin = "anonymous";
    source.muted = true;
    source.preload = "auto";
    try {
      await new Promise<void>((resolve, reject) => {
        source.addEventListener("loadeddata", () => resolve(), { once: true });
        source.addEventListener("error", () => reject(new Error("Video preview unavailable")), { once: true });
        source.src = sourceUrl;
      });
      if (superseded()) return;
      const blob = await this.firstFrame(source);
      if (!blob || superseded()) return;
      this.clear();
      this.posterUrl = URL.createObjectURL(blob);
      this.view.requestUpdate();
    } catch {
      // The video itself still plays when the webview does not allow reading its frames.
    } finally {
      source.removeAttribute("src");
      source.load();
    }
  }

  private firstFrame(source: HTMLVideoElement): Promise<Blob | null> {
    const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(source.videoWidth, source.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(source.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return Promise.resolve(null);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", POSTER_JPEG_QUALITY));
  }

  private clear(): void {
    if (!this.posterUrl) return;
    URL.revokeObjectURL(this.posterUrl);
    this.posterUrl = null;
    this.view.requestUpdate();
  }
}

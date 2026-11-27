import type { VideoSources } from "@warble/media";
import type { VideoPosterController } from "./video-poster-controller";
import type { VideoViewEvents } from "./video-view-events";
import type { VideoViewHost } from "./video-view-host";

type VideoLookup = () => HTMLVideoElement | null;

export class VideoPlaybackController {
  private sourceUrl: string | null = null;
  private errorMessage: string | null = null;
  private renderedUrl: string | null | undefined;

  constructor(
    private readonly view: VideoViewHost,
    private readonly video: VideoLookup,
    private readonly sources: Pick<VideoSources, "sourceFor">,
    private readonly poster: VideoPosterController,
    private readonly events: VideoViewEvents,
  ) {}

  get url(): string | null {
    return this.sourceUrl;
  }

  get error(): string | null {
    return this.errorMessage;
  }

  pathChanged(): void {
    this.poster.reset();
    this.sourceUrl = null;
    this.errorMessage = null;
    this.view.requestUpdate();
    const path = this.view.path;
    if (path) void this.loadSource(path);
  }

  toggle(): boolean {
    const video = this.video();
    if (!video) return false;
    if (video.paused) {
      void video.play().catch(() => this.fail("Video playback is unavailable on this device."));
    } else {
      video.pause();
    }
    return true;
  }

  playbackFailed(): void {
    this.fail("This device cannot play the video's codec.");
    if (this.view.presenting) this.events.presentation("video-error");
  }

  /** Runs after every render: a presentation plays each video from the start, anything else leaves it paused. */
  rendered(presentingChanged: boolean): void {
    const urlChanged = this.sourceUrl !== this.renderedUrl;
    this.renderedUrl = this.sourceUrl;
    if (!urlChanged && !presentingChanged) return;
    const video = this.video();
    if (!video) return;
    if (!this.view.presenting) {
      video.pause();
      return;
    }
    if (presentingChanged) {
      video.currentTime = 0;
      video.muted = false;
    }
    void this.autoplay(video);
  }

  private async loadSource(path: string): Promise<void> {
    const current = () => this.view.path === path && this.view.isConnected;
    try {
      const url = await this.sources.sourceFor(path);
      if (!current()) return;
      this.sourceUrl = url;
      this.view.requestUpdate();
      void this.poster.load(path, url);
    } catch (error) {
      if (!current()) return;
      this.fail(String(error));
      if (this.view.presenting) this.events.presentation("video-error");
    }
  }

  /** Webviews may refuse to autoplay with sound, so a refused start is retried muted. */
  private async autoplay(video: HTMLVideoElement): Promise<void> {
    const stillWanted = () => this.view.presenting && video === this.video();
    try {
      await video.play();
    } catch {
      if (!stillWanted()) return;
      video.muted = true;
      try {
        await video.play();
      } catch {
        if (!stillWanted()) return;
        this.fail("Video autoplay is unavailable on this device.");
        this.events.presentation("video-error");
      }
    }
  }

  private fail(message: string): void {
    this.errorMessage = message;
    this.view.requestUpdate();
  }
}

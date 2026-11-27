import type { Photo } from "@warble/library";
import { VideoSources, type HdImageCache } from "@warble/media";
import {
  SLIDESHOW_DURATIONS,
  type SlideshowSettings,
  type SlideshowSettingsStore,
} from "@app/state/slideshow-settings-store";
import type { ControlsVisibilityController } from "./controls-visibility-controller";
import type { FullViewEvents } from "./full-view-events";
import type { SlideOverlay } from "./slide-overlay";
import type { StageModel } from "./stage-model";
import type { UpdateHost } from "./update-host";

const MAX_CUSTOM_DURATION_SECONDS = 86400;

export interface SlideshowServices {
  readonly settings: Pick<SlideshowSettingsStore, "load" | "save">;
  readonly hdImages: Pick<HdImageCache, "load">;
}

export interface SlideshowView extends UpdateHost {
  readonly overlay: SlideOverlay;
  readonly events: Pick<FullViewEvents, "navigate">;
  imageReady(): boolean;
}

export class SlideshowController {
  private current: SlideshowSettings;
  private customDurationChosen: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped whenever the pending advance becomes obsolete, so a late timer or preload does nothing. */
  private generation = 0;
  private preloadAbort: AbortController | null = null;
  /** The slide being navigated to; the overlay stays up until that slide reports ready. */
  private transitionPath: string | null = null;

  constructor(
    private readonly view: SlideshowView,
    private readonly stage: StageModel,
    private readonly controls: Pick<ControlsVisibilityController, "hide" | "show">,
    private readonly services: SlideshowServices,
  ) {
    this.current = services.settings.load();
    this.customDurationChosen = !SLIDESHOW_DURATIONS.some((seconds) => seconds === this.current.durationSeconds);
  }

  get settings(): SlideshowSettings {
    return this.current;
  }

  get customDuration(): boolean {
    return this.customDurationChosen;
  }

  get presenting(): boolean {
    return this.stage.presenting;
  }

  updateSettings(change: Partial<SlideshowSettings>): void {
    this.current = { ...this.current, ...change };
    this.services.settings.save(this.current);
    this.view.requestUpdate();
  }

  selectDuration(value: string): void {
    this.customDurationChosen = value === "custom";
    if (this.customDurationChosen) this.view.requestUpdate();
    else this.updateSettings({ durationSeconds: Number(value) });
  }

  /** Returns `false` and keeps the current duration when the value is not a whole number of seconds in range. */
  setCustomDuration(seconds: number): boolean {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_CUSTOM_DURATION_SECONDS) return false;
    this.updateSettings({ durationSeconds: seconds });
    return true;
  }

  start(): void {
    if (this.presenting || !this.stage.currentPhoto) return;
    this.stage.presenting = true;
    this.controls.hide();
    if (!this.stage.activeVideoPath && this.view.imageReady()) this.scheduleNextSlide();
  }

  stop(): void {
    if (!this.presenting) return;
    this.stage.presenting = false;
    this.cancelPendingAdvance();
    this.transitionPath = null;
    this.view.overlay.hide();
    this.controls.show();
  }

  /** Returns `true` when a running presentation was stopped. */
  interrupt(): boolean {
    if (!this.presenting) return false;
    this.stop();
    return true;
  }

  /** The viewer moved to another slide by hand: drop the pending advance and cover the stage until that slide shows. */
  prepareManualAdvance(next: Photo): void {
    if (!this.presenting) return;
    this.cancelPendingAdvance();
    this.view.overlay.capture();
    this.transitionPath = this.stage.slidePath(next);
  }

  /** Any change of photo the slideshow did not start itself ends the presentation. */
  photosChanged(listChanged: boolean, indexChanged: boolean): void {
    if (!this.presenting) return;
    const photo = this.stage.currentPhoto;
    const shownPath = photo ? this.stage.slidePath(photo) : null;
    if (listChanged || (indexChanged && this.transitionPath !== shownPath)) this.stop();
  }

  imageReady(path: string): void {
    if (!this.presenting || path !== this.stage.editTarget) return;
    this.finishTransition(path);
    if (this.timer === null && this.preloadAbort === null) this.scheduleNextSlide();
  }

  imageFailed(path: string): void {
    if (this.presenting && path === this.stage.editTarget) this.stop();
  }

  videoPlaying(path: string): void {
    if (this.presenting && path === this.stage.activeVideoPath) this.finishTransition(path);
  }

  videoEnded(path: string): void {
    if (!this.presenting || path !== this.stage.activeVideoPath) return;
    const next = this.stage.photos[this.stage.index + 1];
    if (!next) {
      this.stop();
      return;
    }
    this.advanceTo(this.stage.slidePath(next));
  }

  videoFailed(path: string): void {
    if (this.presenting && path === this.stage.activeVideoPath) this.stop();
  }

  private scheduleNextSlide(): void {
    if (!this.presenting) return;
    const generation = ++this.generation;
    const duration = this.current.durationSeconds * 1000;
    const next = this.stage.photos[this.stage.index + 1];
    if (!next) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.generation === generation) this.stop();
      }, duration);
      return;
    }
    const path = this.stage.slidePath(next);
    if (!path) {
      this.stop();
      return;
    }
    const abort = VideoSources.isVideo(path) ? null : new AbortController();
    this.preloadAbort = abort;
    const preload = abort ? this.preload(path, abort.signal) : Promise.resolve();
    this.timer = setTimeout(async () => {
      this.timer = null;
      await preload;
      const obsolete = !this.presenting || this.generation !== generation || this.preloadAbort !== abort;
      if (obsolete || abort?.signal.aborted) return;
      this.preloadAbort = null;
      this.advanceTo(path);
    }, duration);
  }

  private async preload(path: string, signal: AbortSignal): Promise<void> {
    try {
      await this.services.hdImages.load(path, { signal, priority: "background" });
    } catch (error) {
      if (!signal.aborted) console.warn("Slideshow preload failed", error);
    }
  }

  private advanceTo(path: string): void {
    this.view.overlay.capture();
    this.transitionPath = path;
    const next = this.stage.index + 1;
    if (next < this.stage.photos.length) this.view.events.navigate(next);
  }

  private finishTransition(path: string): void {
    if (this.transitionPath !== path) return;
    this.transitionPath = null;
    if (this.current.transition === "instant") this.view.overlay.hide();
    else this.view.overlay.fadeOut(() => this.presenting);
  }

  private cancelPendingAdvance(): void {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.preloadAbort?.abort();
    this.preloadAbort = null;
  }
}

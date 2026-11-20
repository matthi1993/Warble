import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Photo } from "@warble/library";
import type { SlideshowSettings } from "@app/state/slideshow-settings-store";
import { ControlsVisibilityController } from "@app/views/full-view/controls-visibility-controller";
import { MenuController } from "@app/views/full-view/menu-controller";
import { PhotoNavigationController } from "@app/views/full-view/photo-navigation-controller";
import { SlideshowController } from "@app/views/full-view/slideshow-controller";
import { CountingHost, FakeStage, RecordingEvents, RecordingOverlay, photo, settle, video } from "./support/full-view-fakes";

interface Preload {
  path: string;
  signal: AbortSignal;
  finish(): void;
  fail(error: Error): void;
}

function createSlideshow(photos: Photo[], options: { saved?: Partial<SlideshowSettings>; imageReady?: boolean } = {}) {
  const stage = new FakeStage(photos);
  const host = new CountingHost();
  const events = new RecordingEvents();
  const overlay = new RecordingOverlay();
  const controls = new ControlsVisibilityController(host, new MenuController(host), events);
  const preloads: Preload[] = [];
  const saved: SlideshowSettings[] = [];
  const slideshow = new SlideshowController(
    { requestUpdate: () => host.requestUpdate(), overlay, events, imageReady: () => options.imageReady ?? true },
    stage.model,
    controls,
    {
      settings: {
        load: () => ({ durationSeconds: 5, transition: "fade", ...options.saved }),
        save: (settings) => void saved.push(settings),
      },
      hdImages: {
        load: (path, loadOptions) =>
          new Promise<ImageBitmap>((resolve, reject) => {
            preloads.push({ path, signal: loadOptions!.signal!, finish: () => resolve({} as ImageBitmap), fail: reject });
          }),
      },
    },
  );
  const navigation = new PhotoNavigationController(stage.model, slideshow, events);
  /** What the app shell does after a navigate event: it gives the view the new index. */
  const show = (index: number) => {
    stage.sequence.index = index;
    slideshow.photosChanged(false, true);
  };
  return { slideshow, navigation, stage, events, overlay, preloads, saved, show };
}

describe("SlideshowController", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("advances after the slide duration, fades the previous slide out and stops after the last slide", async () => {
    const { slideshow, events, overlay, preloads, show } = createSlideshow([photo("a"), photo("b")]);
    slideshow.start();
    expect(slideshow.presenting).toBe(true);
    expect(events.controlsHidden).toEqual([true]);
    expect(preloads.map((preload) => preload.path)).toEqual(["b.jpg"]);

    preloads[0].finish();
    await vi.advanceTimersByTimeAsync(4999);
    expect(events.navigations).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events.navigations).toEqual([1]);
    expect(overlay.calls).toEqual(["capture"]);

    show(1);
    expect(slideshow.presenting).toBe(true);
    slideshow.imageReady("b.jpg");
    expect(overlay.calls).toEqual(["capture", "fadeOut"]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(slideshow.presenting).toBe(false);
    expect(overlay.calls).toEqual(["capture", "fadeOut", "hide"]);
    expect(events.controlsHidden).toEqual([true, false]);
  });

  it("times the first slide only once the open image is ready", async () => {
    const { slideshow, preloads } = createSlideshow([photo("a"), photo("b")], { imageReady: false });
    slideshow.start();
    expect(preloads).toEqual([]);
    slideshow.imageReady("b.jpg");
    expect(preloads).toEqual([]);
    slideshow.imageReady("a.jpg");
    expect(preloads.map((preload) => preload.path)).toEqual(["b.jpg"]);
  });

  it("holds the slide until a slow preload has finished and advances even when the preload fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const slow = createSlideshow([photo("a"), photo("b")]);
    slow.slideshow.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(slow.events.navigations).toEqual([]);
    slow.preloads[0].finish();
    await settle();
    expect(slow.events.navigations).toEqual([1]);

    const failing = createSlideshow([photo("a"), photo("b")]);
    failing.slideshow.start();
    failing.preloads[0].fail(new Error("decode failed"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(failing.events.navigations).toEqual([1]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a manual step cancels the pending advance and restarts the timer on the new slide", async () => {
    const { slideshow, navigation, events, overlay, preloads, show } = createSlideshow([photo("a"), photo("b"), photo("c")]);
    slideshow.start();
    navigation.go(1);
    expect(preloads[0].signal.aborted).toBe(true);
    expect(overlay.calls).toEqual(["capture"]);
    expect(events.navigations).toEqual([1]);

    show(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(slideshow.presenting).toBe(true);
    expect(events.navigations).toEqual([1]);

    slideshow.imageReady("b.jpg");
    expect(preloads.map((preload) => preload.path)).toEqual(["b.jpg", "c.jpg"]);
    preloads[1].finish();
    await vi.advanceTimersByTimeAsync(5000);
    expect(events.navigations).toEqual([1, 2]);
  });

  it("stops when another photo is shown than the one it navigated to, or when the list changes", () => {
    const jumped = createSlideshow([photo("a"), photo("b"), photo("c")]);
    jumped.slideshow.start();
    jumped.show(2);
    expect(jumped.slideshow.presenting).toBe(false);
    expect(jumped.preloads[0].signal.aborted).toBe(true);
    expect(jumped.overlay.calls).toEqual(["hide"]);
    expect(jumped.events.controlsHidden).toEqual([true, false]);

    const reloaded = createSlideshow([photo("a"), photo("b")]);
    reloaded.slideshow.start();
    reloaded.slideshow.photosChanged(true, false);
    expect(reloaded.slideshow.presenting).toBe(false);
  });

  it("plays a video slide to its end instead of timing it, and reveals the next slide instantly when asked to", async () => {
    const { slideshow, events, overlay, preloads, show } = createSlideshow([video("clip"), photo("b"), video("end")], {
      saved: { transition: "instant" },
    });
    slideshow.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(preloads).toEqual([]);
    expect(events.navigations).toEqual([]);

    slideshow.videoEnded("other.mov");
    expect(events.navigations).toEqual([]);
    slideshow.videoEnded("clip.mov");
    expect(events.navigations).toEqual([1]);

    show(1);
    slideshow.imageReady("b.jpg");
    expect(overlay.calls).toEqual(["capture", "hide"]);
    expect(preloads).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(events.navigations).toEqual([1, 2]);

    show(2);
    slideshow.videoPlaying("end.mov");
    expect(overlay.calls).toEqual(["capture", "hide", "capture", "hide"]);
    slideshow.videoEnded("end.mov");
    expect(slideshow.presenting).toBe(false);
  });

  it("keeps a custom duration only when it is a whole number of seconds within a day", () => {
    const { slideshow, saved } = createSlideshow([photo("a")], { saved: { durationSeconds: 42 } });
    expect(slideshow.customDuration).toBe(true);
    expect([0, 1.5, 86401].map((seconds) => slideshow.setCustomDuration(seconds))).toEqual([false, false, false]);
    expect(slideshow.setCustomDuration(90)).toBe(true);
    slideshow.selectDuration("20");
    expect(slideshow.customDuration).toBe(false);
    slideshow.selectDuration("custom");
    expect(slideshow.customDuration).toBe(true);
    expect(slideshow.settings).toEqual({ durationSeconds: 20, transition: "fade" });
    expect(saved.map((settings) => settings.durationSeconds)).toEqual([90, 20]);
  });
});

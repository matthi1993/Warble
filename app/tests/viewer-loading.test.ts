import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_IMAGE_DELAY_MS } from "@viewer/full-image-upgrade";
import { fakeBitmap } from "./support/viewer-fakes";
import { createViewer, installBrowser, settle, uninstallBrowser } from "./support/viewer-harness";

describe("viewer image loading", () => {
  beforeEach(() => void installBrowser());
  afterEach(() => {
    uninstallBrowser();
    vi.restoreAllMocks();
  });

  it("shows the thumbnail first, then the HD preview, then full resolution after the delay", async () => {
    const { host, images, sources, viewer, connect } = createViewer();
    const [thumbnail, hd, full] = [fakeBitmap(320, 213), fakeBitmap(1920, 1280), fakeBitmap(6000, 4000)];
    host.path = "photo";
    connect();
    expect(viewer.status).toBe("loading");
    expect(viewer.awaitingFirstImage).toBe(true);

    images.thumbnails.get("photo")!.resolve(thumbnail);
    await settle();
    expect(sources.current).toBe(thumbnail);
    expect(viewer.imageReady).toBe(false);

    images.hdLoads.get("photo")!.resolve(hd);
    await settle();
    expect(sources.current).toBe(hd);
    expect(thumbnail.closed).toBe(true);
    expect(viewer.imageReady).toBe(true);
    expect(host.events.map((event) => [event.type, event.detail])).toEqual([["image-ready", { path: "photo" }]]);
    expect(viewer.upgradingToFullResolution).toBe(true);

    vi.advanceTimersByTime(FULL_IMAGE_DELAY_MS - 1);
    expect(images.fullRequests).toHaveLength(0);
    vi.advanceTimersByTime(1);
    images.fullRequests[0].resolve(full);
    await settle();
    expect(sources.current).toBe(full);
    expect(viewer.upgradingToFullResolution).toBe(false);
  });

  it("a thumbnail that arrives after the HD preview is discarded", async () => {
    const { host, images, sources, connect } = createViewer();
    const [thumbnail, hd] = [fakeBitmap(320, 213), fakeBitmap(1920, 1280)];
    host.path = "photo";
    connect();
    images.hdLoads.get("photo")!.resolve(hd);
    await settle();
    images.thumbnails.get("photo")!.resolve(thumbnail);
    await settle();
    expect(sources.current).toBe(hd);
    expect(thumbnail.closed).toBe(true);
  });

  it("reports a failed HD load and ignores results for a photo that is no longer shown", async () => {
    const { host, images, sources, viewer, connect, change } = createViewer();
    vi.spyOn(console, "error").mockImplementation(() => {});
    host.path = "first";
    connect();
    change({ path: "second" });
    expect(images.cancelledThumbnails).toEqual(["first"]);
    images.hdLoads.get("first")!.resolve(fakeBitmap(1920, 1280));
    await settle();
    expect(sources.current).toBeNull();

    images.hdLoads.get("second")!.reject(new Error("decode failed"));
    await settle();
    expect(viewer.status).toBe("error");
    expect(viewer.errorMessage).toBe("Error: decode failed");
    expect(host.eventTypes()).toEqual(["image-error"]);
  });

  it("turning full resolution on loads the current photo and turning it off cancels the upgrade", async () => {
    const { host, images, sources, viewer, connect, change } = createViewer();
    images.hdCache.set("photo", fakeBitmap(1920, 1280));
    host.path = "photo";
    host.enableFullRes = false;
    connect();
    change({ enableFullRes: false });
    expect(vi.getTimerCount()).toBe(0);
    change({ enableFullRes: true });
    vi.advanceTimersByTime(FULL_IMAGE_DELAY_MS);
    expect(images.fullRequests).toHaveLength(1);
    expect(images.fullRequests[0].path).toBe("photo");
    change({ enableFullRes: false });
    expect(images.fullRequests[0].signal!.aborted).toBe(true);
    images.fullRequests[0].resolve(fakeBitmap(6000, 4000));
    await settle();
    expect(sources.full).toBeNull();
    expect(viewer.upgradingToFullResolution).toBe(false);
    change({ enableFullRes: true });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("navigating after an edit clears its preview state and upgrades the next photo", () => {
    const { host, images, edits, scene, sources, viewer, connect, change } = createViewer();
    const hd = fakeBitmap(1920, 1280);
    const full = fakeBitmap(6000, 4000);
    for (const path of ["first", "second"]) {
      images.hdCache.set(path, hd);
      images.fullCache.set(path, full);
    }
    host.path = "first";
    host.editing = true;
    connect();
    edits.listener!.onEffects();
    expect(scene.quality.reduced).toBe(true);
    change({ path: "second" });
    expect(scene.quality.reduced).toBe(false);
    const runPendingWarmups = () => vi.advanceTimersByTime(0);
    runPendingWarmups();
    expect(vi.getTimerCount()).toBe(1);
    expect(sources.current).toBe(hd);
    vi.advanceTimersByTime(FULL_IMAGE_DELAY_MS);
    expect(sources.current).toBe(full);
    expect(sources.fullPath).toBe("second");
    expect(viewer.upgradingToFullResolution).toBe(false);
  });

  it("navigation clears gesture timers and releases the previous photo's GPU textures", () => {
    const { scene, pipeline, connect, change } = createViewer();
    connect();
    scene.quality.editChanged();
    scene.quality.viewportChanged(false);
    expect(vi.getTimerCount()).toBe(2);
    const releases = pipeline.releases;
    change({ path: null });
    expect(vi.getTimerCount()).toBe(0);
    expect(scene.quality.reduced).toBe(false);
    expect(pipeline.releases).toBe(releases + 1);
  });

  it("a full-resolution image arriving while zoomed keeps the image at its on-screen size", () => {
    const { host, images, scene, connect } = createViewer();
    images.hdCache.set("photo", fakeBitmap(1200, 800));
    images.fullCache.set("photo", fakeBitmap(2400, 1600));
    host.path = "photo";
    connect();
    scene.viewport.userInteracted = true;
    scene.viewport.scale = 2;
    vi.advanceTimersByTime(FULL_IMAGE_DELAY_MS);
    expect(scene.viewport.scale).toBe(1);
    expect(scene.viewport.fitScale).toBe(0.5);
  });

  it("disconnecting stops loading and disposes the pipeline", async () => {
    const { host, images, sources, pipeline, viewer, edits, connect } = createViewer();
    host.path = "photo";
    connect();
    viewer.disconnect();
    expect(images.cancelledThumbnails).toEqual(["photo"]);
    expect(vi.getTimerCount()).toBe(0);
    expect(pipeline.disposed).toBe(true);
    expect(edits.listener).toBeNull();
    images.hdLoads.get("photo")!.resolve(fakeBitmap(1920, 1280));
    await settle();
    expect(sources.current).toBeNull();
  });
});

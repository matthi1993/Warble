import { describe, expect, it, vi } from "vitest";
import { TaskTracker } from "@warble/core";
import { ImageRequests, ThumbnailService } from "../src";
import { FakeImageBackend } from "./support/fakes";

function thumbnailService() {
  const backend = new FakeImageBackend();
  const thumbnails = new ThumbnailService(backend, new ImageRequests(backend), new TaskTracker());
  return { backend, thumbnails };
}

describe("ThumbnailService", () => {
  it("shared thumbnails follow the highest live consumer priority", async () => {
    const { backend, thumbnails } = thumbnailService();
    const requested = () => backend.priorities.map((change) => change.priority);
    const latest = () => requested()[backend.priorities.length - 1];
    const prefetch = thumbnails.request("photo.jpg", "normal");
    const visible = thumbnails.request("photo.jpg");
    const opened = thumbnails.request("photo.jpg", "urgent");
    expect(backend.fetches.map((fetch) => fetch.priority)).toEqual(["normal"]);
    expect(requested()).toEqual(["high", "urgent"]);

    visible.setPriority("normal");
    expect(requested()).toEqual(["high", "urgent"]);
    opened.cancel();
    expect(latest()).toBe("normal");
    visible.setPriority("high");
    expect(latest()).toBe("high");
    visible.cancel();
    expect(latest()).toBe("normal");
    expect(backend.cancelled).toEqual([]);

    backend.fetches[0].resolve(new ArrayBuffer(8));
    await prefetch.promise;
    const changes = backend.priorities.length;
    prefetch.cancel();
    expect(backend.priorities.length).toBe(changes);
    expect(backend.cancelled).toEqual([]);
    await thumbnails.request("photo.jpg").promise;
    expect(backend.fetches.length).toBe(1);
  });

  it("cancelled thumbnails cannot overwrite a replacement request's cache", async () => {
    const { backend, thumbnails } = thumbnailService();
    const stale = thumbnails.request("photo.jpg");
    stale.cancel();
    stale.cancel();
    expect(backend.cancelled).toEqual([backend.fetches[0].requestId]);

    const replacement = thumbnails.request("photo.jpg");
    const freshBytes = new ArrayBuffer(12);
    backend.fetches[1].resolve(freshBytes);
    await replacement.promise;
    backend.fetches[0].resolve(new ArrayBuffer(4));
    await stale.promise;
    expect(await thumbnails.request("photo.jpg").promise).toBe(freshBytes);
  });

  it("cached thumbnail URLs survive card reuse and stay alive until the last card releases them", async () => {
    const { backend, thumbnails } = thumbnailService();
    const request = thumbnails.request("photo.jpg");
    const bytes = new ArrayBuffer(8);
    backend.fetches[0].resolve(bytes);
    await request.promise;
    expect(thumbnails.cached("photo.jpg")).toBe(bytes);

    const first = thumbnails.acquireImage(bytes);
    first.release();
    const second = thumbnails.acquireImage(bytes);
    expect(second.url).toBe(first.url);
    const third = thumbnails.acquireImage(bytes);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      thumbnails.clear();
      expect(thumbnails.cached("photo.jpg")).toBeNull();
      second.release();
      expect(revoke).not.toHaveBeenCalled();
      third.release();
      third.release();
      expect(revoke.mock.calls).toEqual([[first.url]]);
    } finally {
      revoke.mockRestore();
    }
  });

  it("thumbnail warmup skips videos and stops without cancelling visible consumers", async () => {
    const { backend, thumbnails } = thumbnailService();
    const stop = thumbnails.prefetch(["clip.mov", "photo.jpg", "other.jpg"]);
    const visible = thumbnails.request("photo.jpg");
    stop();
    expect(backend.cancelled).toEqual([]);
    backend.fetches[0].resolve(new ArrayBuffer(4));
    await visible.promise;
    await Promise.resolve();
    expect(backend.fetches.map((fetch) => fetch.path)).toEqual(["photo.jpg"]);
  });

  it("invalidating a path drops its bytes and cancels the request in flight", async () => {
    const { backend, thumbnails } = thumbnailService();
    const cachedRequest = thumbnails.request("cached.jpg");
    backend.fetches[0].resolve(new ArrayBuffer(8));
    await cachedRequest.promise;
    const loading = thumbnails.request("loading.jpg");

    thumbnails.invalidate(["cached.jpg", "loading.jpg"]);
    expect(thumbnails.cached("cached.jpg")).toBeNull();
    expect(backend.cancelled).toEqual([backend.fetches[1].requestId]);

    backend.fetches[1].resolve(new ArrayBuffer(8));
    await loading.promise;
    expect(thumbnails.cached("loading.jpg")).toBeNull();
  });
});

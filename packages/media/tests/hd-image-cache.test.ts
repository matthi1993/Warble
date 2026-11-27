import { describe, expect, it } from "vitest";
import { TaskTracker } from "@warble/core";
import { HdImageCache, ImageRequests } from "../src";
import { FakeBitmap, FakeImageBackend, FakeImageDecoder } from "./support/fakes";

function hdImageCache() {
  const backend = new FakeImageBackend();
  const decoder = new FakeImageDecoder();
  const cache = new HdImageCache(backend, new ImageRequests(backend), new TaskTracker(), decoder);
  return { backend, decoder, cache };
}

describe("HdImageCache", () => {
  it("HD requests for separate viewers do not cancel each other", async () => {
    const { backend, decoder, cache } = hdImageCache();
    const first = cache.load("first");
    const second = cache.load("second");
    const firstBitmap = new FakeBitmap();
    const secondBitmap = new FakeBitmap();
    backend.fetches[0].resolve(decoder.encode(firstBitmap));
    backend.fetches[1].resolve(decoder.encode(secondBitmap));
    expect(await Promise.all([first, second])).toEqual([firstBitmap, secondBitmap]);
    expect(backend.cancelled).toEqual([]);
  });

  it("cancelling visible or background HD consumers preserves shared work at the remaining priority", async () => {
    const { backend, decoder, cache } = hdImageCache();
    const backgroundAbort = new AbortController();
    const visibleAbort = new AbortController();
    const background = cache.load("first", { priority: "background", signal: backgroundAbort.signal });
    const visible = cache.load("first", { signal: visibleAbort.signal });
    visibleAbort.abort();
    await expect(visible).rejects.toMatchObject({ name: "AbortError" });
    expect(backend.priorities.map((change) => change.priority)).toEqual(["urgent", "background"]);
    expect(backend.cancelled).toEqual([]);

    const replacement = cache.load("first");
    backgroundAbort.abort();
    await expect(background).rejects.toMatchObject({ name: "AbortError" });
    expect(backend.cancelled).toEqual([]);

    const bitmap = new FakeBitmap();
    backend.fetches[0].resolve(decoder.encode(bitmap));
    expect(await replacement).toBe(bitmap);
    expect(backend.fetches.length).toBe(1);
  });

  it("clearing the HD disk cache drops bitmaps and rejects loads in flight", async () => {
    const { backend, decoder, cache } = hdImageCache();
    const cachedBitmap = new FakeBitmap();
    const cachedLoad = cache.load("cached");
    backend.fetches[0].resolve(decoder.encode(cachedBitmap));
    await cachedLoad;
    const loading = cache.load("loading");

    backend.clearCache("thumbnail_disk");
    expect(cache.get("cached")).toBe(cachedBitmap);

    backend.clearCache("hd_image_disk");
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(cachedBitmap.closed).toBe(true);
    expect(cache.get("cached")).toBeNull();
    expect(backend.cancelled).toEqual([backend.fetches[1].requestId]);

    cache.dispose();
    const reloaded = cache.load("cached");
    backend.fetches[2].resolve(decoder.encode(new FakeBitmap()));
    await reloaded;
    backend.clearCache("hd_image_disk");
    expect(cache.get("cached")).not.toBeNull();
  });
});

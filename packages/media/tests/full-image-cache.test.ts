import { describe, expect, it } from "vitest";
import { TaskTracker } from "@warble/core";
import { FullImageCache, ImageRequests } from "../src";
import { FakeBitmap, FakeImageBackend, FakeImageDecoder, nextMacrotask } from "./support/fakes";

function fullImageCache() {
  const backend = new FakeImageBackend();
  const decoder = new FakeImageDecoder();
  const cache = new FullImageCache(backend, new ImageRequests(backend), new TaskTracker(), decoder);
  return { backend, decoder, cache };
}

describe("FullImageCache", () => {
  it("a cancelled full-resolution decode cannot evict the active photo or replace a newer result", async () => {
    const { backend, decoder, cache } = fullImageCache();
    let finishStaleDecode!: (bitmap: FakeBitmap) => void;
    const staleDecode = new Promise<FakeBitmap>((resolve) => { finishStaleDecode = resolve; });
    const abort = new AbortController();
    const stale = cache.load("first", { signal: abort.signal });
    backend.fetches[0].resolve(decoder.encode(staleDecode));
    await Promise.resolve();
    abort.abort();
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect(backend.cancelled).toEqual([backend.fetches[0].requestId]);

    const activeBitmap = new FakeBitmap();
    const active = cache.load("second");
    backend.fetches[1].resolve(decoder.encode(activeBitmap));
    await active;
    const staleBitmap = new FakeBitmap();
    finishStaleDecode(staleBitmap);
    await nextMacrotask();

    expect(staleBitmap.closed).toBe(true);
    expect(activeBitmap.closed).toBe(false);
    expect(cache.get("second")).toBe(activeBitmap);
    expect(cache.get("first")).toBeNull();
  });

  it("keeps a shared load alive until its last caller aborts", async () => {
    const { backend, decoder, cache } = fullImageCache();
    const firstAbort = new AbortController();
    const first = cache.load("photo", { signal: firstAbort.signal });
    const second = cache.load("photo");
    firstAbort.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(backend.cancelled).toEqual([]);

    const bitmap = new FakeBitmap();
    backend.fetches[0].resolve(decoder.encode(bitmap));
    expect(await second).toBe(bitmap);
    expect(backend.fetches.length).toBe(1);
  });

  it("closes the least recently used bitmaps beyond the configured capacity", async () => {
    const { backend, decoder, cache } = fullImageCache();
    cache.setCapacity(2);
    const bitmaps = [new FakeBitmap(), new FakeBitmap(), new FakeBitmap()];
    for (const [index, bitmap] of bitmaps.entries()) {
      const load = cache.load(`photo-${index}`);
      backend.fetches[index].resolve(decoder.encode(bitmap));
      await load;
    }
    expect(bitmaps.map((bitmap) => bitmap.closed)).toEqual([true, false, false]);

    cache.setCapacity(0);
    cache.invalidate(["photo-2"]);
    expect(bitmaps.map((bitmap) => bitmap.closed)).toEqual([true, false, true]);
    expect(cache.get("photo-1")).toBe(bitmaps[1]);
  });
});

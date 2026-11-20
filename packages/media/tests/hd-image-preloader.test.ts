import { describe, expect, it } from "vitest";
import { TaskTracker } from "@warble/core";
import { HdImageCache, HdImagePreloader, ImageRequests } from "../src";
import { FakeBitmap, FakeImageBackend, FakeImageDecoder, nextMacrotask } from "./support/fakes";

function hdPreloader() {
  const backend = new FakeImageBackend();
  const decoder = new FakeImageDecoder();
  const cache = new HdImageCache(backend, new ImageRequests(backend), new TaskTracker(), decoder);
  const preloader = new HdImagePreloader(cache);
  const deliver = (index: number, bitmap = new FakeBitmap()): FakeBitmap => {
    backend.fetches[index].resolve(decoder.encode(bitmap));
    return bitmap;
  };
  return { backend, cache, preloader, deliver };
}

describe("HdImagePreloader", () => {
  it("HD lookahead waits for the open photo and prepares only the next three distinct images sequentially", async () => {
    const { backend, cache, preloader, deliver } = hdPreloader();
    const upcoming = ["current", "first", "first", "clip.mov", "second", "third", "fourth"];
    preloader.update("current", upcoming, false);
    expect(backend.fetches.length).toBe(0);

    preloader.update("current", upcoming, true);
    for (const [index, path] of ["first", "second", "third"].entries()) {
      expect(backend.fetches.length).toBe(index + 1);
      expect(backend.fetches[index]).toMatchObject({ path, priority: "background" });
      deliver(index);
      await nextMacrotask();
    }
    expect(backend.fetches.length).toBe(3);
    for (const path of ["first", "second", "third"]) expect(cache.get(path)).not.toBeNull();
    expect(cache.get("fourth")).toBeNull();

    preloader.update("third", [], true);
    expect(backend.fetches.length).toBe(3);
    preloader.stop();
  });

  it("opening a prefetched photo shares its request and promotes it to urgent priority", async () => {
    const { backend, cache, preloader, deliver } = hdPreloader();
    preloader.update("current", ["first", "second", "third"], true);
    preloader.update("first", ["second", "third", "fourth"], false);
    const visible = cache.load("first");
    expect(backend.fetches.length).toBe(1);
    expect(backend.priorities).toEqual([{ requestId: backend.fetches[0].requestId, priority: "urgent" }]);
    expect(backend.cancelled).toEqual([]);

    const bitmap = deliver(0);
    expect(await visible).toBe(bitmap);
    await nextMacrotask();
    expect(backend.fetches.length).toBe(1);

    preloader.update("first", ["second", "third", "fourth"], true);
    expect(backend.fetches.length).toBe(2);
    expect(backend.fetches[1].path).toBe("second");
    preloader.stop();
    await nextMacrotask();
  });

  it("HD lookahead cancels obsolete work on a jump or close and discards late results", async () => {
    const { backend, cache, preloader, deliver } = hdPreloader();
    preloader.update("current", ["first", "second", "third"], true);
    preloader.update("far", ["next", "last"], false);
    await nextMacrotask();
    expect(backend.cancelled).toEqual([backend.fetches[0].requestId]);
    deliver(0);
    await nextMacrotask();
    expect(cache.get("first")).toBeNull();
    expect(backend.fetches.length).toBe(1);

    preloader.update("far", ["next", "last"], true);
    expect(backend.fetches.length).toBe(2);
    expect(backend.fetches[1].path).toBe("next");
    preloader.stop();
    deliver(1);
    await nextMacrotask();
    expect(cache.get("next")).toBeNull();
    expect(backend.fetches.length).toBe(2);
  });

  it("HD lookahead keeps all three upcoming previews and protects the open bitmap from eviction", async () => {
    const { backend, cache, preloader, deliver } = hdPreloader();
    const loadExtra = async (index: number): Promise<void> => {
      const extra = cache.load(`extra-${index}`, { priority: "background" });
      deliver(backend.fetches.length - 1);
      await extra;
    };
    const currentLoad = cache.load("current");
    const current = deliver(0);
    await currentLoad;

    preloader.update("current", ["first", "second", "third"], true);
    for (let index = 1; index <= 3; index++) {
      deliver(index);
      await nextMacrotask();
    }
    for (let index = 0; index < 4; index++) await loadExtra(index);
    expect(current.closed).toBe(false);
    expect(cache.get("current")).toBe(current);

    preloader.stop();
    for (let index = 4; index < 9; index++) await loadExtra(index);
    expect(current.closed).toBe(true);
  });
});

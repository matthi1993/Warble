import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskPriority } from "@warble/core";
import { ThumbnailLoadingController } from "../src/views/grid/thumbnail-loading-controller";

interface ObservedEntry {
  isIntersecting: boolean;
}

function loadingHarness(path: string) {
  const observers: { margin: string | undefined; disconnected: boolean; report(visible: boolean): void }[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: ObservedEntry[]) => void, options?: { rootMargin?: string }) {
        const observer = {
          margin: options?.rootMargin,
          disconnected: false,
          report: (visible: boolean) => callback([{ isIntersecting: visible }]),
        };
        observers.push(observer);
        this.disconnect = () => { observer.disconnected = true; };
      }
      observe(): void {}
      disconnect: () => void;
    },
  );
  const requests: { priorities: TaskPriority[]; cancelled: boolean; resolve(bytes: ArrayBuffer): void }[] = [];
  const cache = new Map<string, ArrayBuffer>();
  const released: string[] = [];
  const events: string[] = [];
  const host = {
    path,
    isConnected: true,
    requestUpdate() {},
    dispatchEvent: (event: Event) => events.push(event.type) > 0,
  };
  const thumbnails = {
    cached: (cachedPath: string) => cache.get(cachedPath) ?? null,
    acquireImage: () => ({ url: "blob:thumbnail", release: () => { released.push("blob:thumbnail"); } }),
    request(_path: string, priority: TaskPriority = "high") {
      let resolve: (bytes: ArrayBuffer) => void = () => {};
      const promise = new Promise<ArrayBuffer>((done) => { resolve = done; });
      const request = { priorities: [priority], cancelled: false, resolve };
      requests.push(request);
      return {
        promise,
        setPriority: (next: TaskPriority) => { request.priorities.push(next); },
        cancel: () => { request.cancelled = true; },
      };
    },
  };
  const videos = { sourceFor: async (videoPath: string) => `video:${videoPath}` };
  const loading = new ThumbnailLoadingController(host as typeof host & Element, thumbnails, videos);
  const settle = () => new Promise((resolve) => setTimeout(resolve));
  return { loading, observers, requests, cache, released, events, settle };
}

describe("ThumbnailLoadingController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests with the priority of the card's visibility and cancels when the card scrolls away", async () => {
    const { loading, observers, requests, released, events, settle } = loadingHarness("a.jpg");
    loading.connect();
    const [onScreen, nearby] = observers;
    expect([onScreen.margin, nearby.margin]).toEqual([undefined, "200px"]);

    nearby.report(true);
    onScreen.report(true);
    onScreen.report(false);
    expect(requests).toHaveLength(1);
    expect(requests[0].priorities).toEqual(["normal", "high", "normal"]);
    nearby.report(false);
    expect(requests[0].cancelled).toBe(true);

    onScreen.report(true);
    expect(requests[1].priorities).toEqual(["high"]);
    requests[1].resolve(new ArrayBuffer(1));
    await settle();
    expect(loading.thumbnailUrl).toBe("blob:thumbnail");
    expect(events).toEqual(["thumbnail-load"]);
    expect(observers.every((observer) => observer.disconnected)).toBe(true);

    loading.disconnect();
    expect(loading.thumbnailUrl).toBeNull();
    expect(released).toEqual(["blob:thumbnail"]);
  });

  it("shows a cached thumbnail at once and reloads it on request", () => {
    const { loading, observers, requests, cache, released, events } = loadingHarness("a.jpg");
    cache.set("a.jpg", new ArrayBuffer(1));
    loading.connect();
    expect(loading.thumbnailUrl).toBe("blob:thumbnail");
    expect(observers).toHaveLength(0);

    cache.clear();
    loading.reload();
    expect(loading.thumbnailUrl).toBeNull();
    expect(released).toEqual(["blob:thumbnail"]);
    expect(observers).toHaveLength(2);
    expect(requests).toHaveLength(0);
    expect(events).toEqual(["thumbnail-load"]);
  });

  it("shows videos through their source instead of a thumbnail", async () => {
    const { loading, observers, requests, events, settle } = loadingHarness("clip.MOV");
    loading.connect();
    observers[0].report(true);
    await settle();
    expect(loading.videoUrl).toBe("video:clip.MOV");
    expect(requests).toHaveLength(0);
    expect(events).toEqual(["thumbnail-load"]);
  });
});

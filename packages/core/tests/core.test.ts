import { describe, expect, it, vi } from "vitest";
import { BusyState, Debouncer, DisposableBag, Emitter, LruCache, Store, TaskTracker, isCancellation } from "../src";

describe("Emitter and Store", () => {
  it("notifies subscribers until they unsubscribe", () => {
    const emitter = new Emitter<number>();
    const seen: number[] = [];
    const stop = emitter.subscribe((value) => seen.push(value));
    emitter.emit(1);
    stop();
    emitter.emit(2);
    expect(seen).toEqual([1]);
  });

  it("publishes only real changes and can replay the current value", () => {
    const store = new Store(1);
    const seen: number[] = [];
    store.watch((value) => seen.push(value));
    store.set(1);
    store.update((value) => value + 1);
    expect(seen).toEqual([1, 2]);
  });
});

describe("LruCache", () => {
  it("evicts the least recently used entry and skips pinned keys", () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>({
      capacity: 2,
      onEvict: (_value, key) => evicted.push(key),
      isPinned: (key) => key === "a",
    });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(evicted).toEqual(["b"]);
    cache.get("a");
    cache.resize(1);
    expect(cache.keys()).toEqual(["a"]);
  });
});

describe("Debouncer", () => {
  it("runs once after the delay and immediately on flush", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const debouncer = new Debouncer(100, action);
    debouncer.schedule();
    debouncer.schedule();
    vi.advanceTimersByTime(100);
    expect(action).toHaveBeenCalledTimes(1);
    debouncer.schedule();
    debouncer.flush();
    vi.advanceTimersByTime(100);
    expect(action).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("DisposableBag", () => {
  it("disposes in reverse order exactly once", () => {
    const order: string[] = [];
    const bag = new DisposableBag();
    bag.add(() => order.push("first"));
    bag.add({ dispose: () => order.push("second") });
    bag.dispose();
    bag.dispose();
    expect(order).toEqual(["second", "first"]);
  });
});

describe("TaskTracker", () => {
  it("publishes one snapshot per microtask", async () => {
    const tracker = new TaskTracker();
    const snapshots: number[] = [];
    tracker.subscribe((active) => snapshots.push(active.length));
    const first = tracker.begin({ kind: "thumbnail", label: "a", priority: "normal" });
    tracker.begin({ kind: "thumbnail", label: "b", priority: "urgent" });
    first.update({ completed: 1 });
    await Promise.resolve();
    expect(snapshots).toEqual([0, 2]);
  });

  it("orders active tasks by priority and keeps finished tasks as recent", async () => {
    const tracker = new TaskTracker();
    const low = tracker.begin({ kind: "exif", label: "low", priority: "background" });
    tracker.begin({ kind: "hd-image", label: "high", priority: "urgent" });
    low.finish("cancelled");
    let active: string[] = [];
    let recent: string[] = [];
    tracker.subscribe((a, r) => {
      active = a.map((task) => task.label);
      recent = r.map((task) => `${task.label}:${task.status}`);
    });
    expect(active).toEqual(["high"]);
    expect(recent).toEqual(["high:running", "low:cancelled"]);
  });
});

describe("BusyState", () => {
  it("reports the newest label until every operation ends", () => {
    const busy = new BusyState(new TaskTracker());
    const labels: Array<string | null> = [];
    busy.subscribe((label) => labels.push(label));
    const endFirst = busy.begin("Syncing…");
    const endSecond = busy.begin("Saving…");
    endSecond();
    endFirst();
    endFirst();
    expect(labels).toEqual([null, "Syncing…", "Saving…", "Syncing…", null]);
  });
});

describe("isCancellation", () => {
  it("recognises abort errors and cancellation messages", () => {
    expect(isCancellation(new DOMException("stop", "AbortError"))).toBe(true);
    expect(isCancellation("request cancelled")).toBe(true);
    expect(isCancellation(new Error("disk full"))).toBe(false);
  });
});

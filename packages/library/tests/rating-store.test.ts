import { describe, expect, it, vi } from "vitest";
import { type ColorLabel, type PersistedPhotoRating, type RatingBackend, RatingStore } from "../src";

interface RatingWrite {
  path: string;
  rating: number;
  label: ColorLabel;
}

function fakeBackend(rows: PersistedPhotoRating[] = []) {
  const writes: RatingWrite[] = [];
  const backend: RatingBackend = {
    getPhotoRatings: async () => rows,
    setPhotoRating: async (path, rating, label) => {
      writes.push({ path, rating, label });
      return 123;
    },
  };
  return { backend, writes };
}

describe("RatingStore", () => {
  it("bulk ratings and labels preserve other values, publish a complete selection, and persist every target", async () => {
    const { backend, writes } = fakeBackend();
    const store = new RatingStore(backend);
    store.setLabel(["first"], "red");
    store.setStars(["second"], 2);
    await store.flush();

    const snapshots: { path: string; first: number; second: number }[] = [];
    const unsubscribe = store.subscribe((path) => {
      snapshots.push({ path, first: store.get("first").rating, second: store.get("second").rating });
    });
    store.setStars(["first", "second", "first"], 4);
    expect(snapshots).toEqual([{ path: "", first: 4, second: 4 }]);
    expect(store.get("first").label).toBe("red");

    store.setLabel(["first", "second"], "blue");
    expect(store.get("first").rating).toBe(4);
    expect(store.get("second").rating).toBe(4);
    unsubscribe();
    await store.flush();
    expect(writes.slice(2)).toEqual([
      { path: "first", rating: 4, label: "red" },
      { path: "second", rating: 4, label: "" },
      { path: "first", rating: 4, label: "blue" },
      { path: "second", rating: 4, label: "blue" },
    ]);

    store.setLabel(["first"], "green");
    store.applyShortcut(["first", "second"], "6");
    expect(store.get("first").label).toBe("green");
    expect(store.get("second").label).toBe("green");
    store.applyShortcut(["first", "second"], "6");
    expect(store.get("first").label).toBe("");
    expect(store.get("second").label).toBe("");

    store.setStars(["first", "second"], 0);
    await store.flush();
    expect(store.get("first").rating).toBe(0);
    expect(store.get("second").rating).toBe(0);
    expect(writes[writes.length - 1].label).toBe("");
  });

  it("publishes the path of a single change and adopts the persisted timestamp", async () => {
    const { backend } = fakeBackend();
    const store = new RatingStore(backend);
    const published: string[] = [];
    store.subscribe((path) => published.push(path));

    store.setStars(["only"], 3);
    await store.flush();

    expect(published).toEqual(["only", "only"]);
    expect(store.get("only")).toEqual({ rating: 3, label: "", ratedAt: 123 });
  });

  it("loads once, sanitizes persisted rows, and drops empty ratings", async () => {
    const { backend } = fakeBackend([
      { path: "clamped", rating: 9, label: "purple", ratedAt: 7 },
      { path: "labelled", rating: 0, label: "red", ratedAt: 8 },
      { path: "empty", rating: 0, label: "", ratedAt: 9 },
    ]);
    const getPhotoRatings = vi.spyOn(backend, "getPhotoRatings");
    const store = new RatingStore(backend);
    const published: string[] = [];
    store.subscribe((path) => published.push(path));

    await Promise.all([store.load(), store.load()]);
    await store.load();

    expect(getPhotoRatings).toHaveBeenCalledTimes(1);
    expect(published).toEqual([""]);
    expect(store.get("clamped")).toEqual({ rating: 5, label: "", ratedAt: 7 });
    expect(store.get("labelled")).toEqual({ rating: 0, label: "red", ratedAt: 8 });
    expect(store.get("empty")).toEqual({ rating: 0, label: "", ratedAt: 0 });
  });

  it("reports failed writes on flush until a later write for that photo succeeds", async () => {
    const { backend } = fakeBackend();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(backend, "setPhotoRating").mockRejectedValueOnce(new Error("disk full"));
    const store = new RatingStore(backend);

    store.setStars(["photo"], 1);
    await expect(store.flush()).rejects.toThrow("Could not save ratings for 1 photo(s) to XMP");

    store.setStars(["photo"], 2);
    await expect(store.flush()).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

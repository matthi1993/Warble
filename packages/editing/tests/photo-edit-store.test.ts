import {
  defaultAnalog,
  defaultClarity,
  defaultColor,
  defaultGrain,
  defaultSharpen,
  defaultTone,
  type ToneEdit,
} from "@warble/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EffectCatalog, PhotoEditStore, type CropEdit, type PersistedPhotoEdit, type PhotoEditChange } from "../src";
import { FakeEditRepository, MemoryStorage, settle } from "./support/fakes";

const catalog = EffectCatalog.standard();
const crop: CropEdit = { x: 0.1, y: 0.2, width: 0.5, height: 0.5, aspectRatio: "3:2", orientation: "landscape", rotation: 0 };

function exposure(value: number): ToneEdit {
  return { ...defaultTone(), exposure: value };
}

function storedEffects(repository: FakeEditRepository): Record<string, Record<string, unknown>> {
  return JSON.parse(repository.effectsJson ?? "{}");
}

interface PendingRequest {
  command: "set" | "clear";
  edit?: PersistedPhotoEdit;
  resolve(): void;
}

class SlowEditRepository extends FakeEditRepository {
  readonly requests: PendingRequest[] = [];

  setPhotoEdit(edit: PersistedPhotoEdit): Promise<void> {
    return new Promise((resolve) => this.requests.push({ command: "set", edit, resolve }));
  }

  clearPhotoEdit(): Promise<void> {
    return new Promise((resolve) => this.requests.push({ command: "clear", resolve }));
  }
}

describe("PhotoEditStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Analog effects persist per photo, preserve other effects, and can be cleared independently", async () => {
    const repository = new FakeEditRepository();
    repository.effectsJson = JSON.stringify({
      first: { analog: { vignette: 35 }, clarity: { clarity: 20, scale: 90 } },
    });
    const store = new PhotoEditStore(repository, catalog);
    await store.load();
    expect(store.effect("first", "clarity")).toEqual({ clarity: 20, structure: 0 });
    expect(store.effect("first", "analog")).toEqual({ ...defaultAnalog(), vignette: 35 });

    const value = { ...defaultAnalog(), halation: 40, chromaticAberration: 60 };
    store.setEffect("second", "analog", value);
    value.halation = 99;
    expect(store.effect("second", "analog")?.halation).toBe(40);

    await store.flushAll();
    await store.reload();
    expect(store.hasEdits("second")).toBe(true);
    expect(store.effect("second", "analog")?.chromaticAberration).toBe(60);

    store.setEffect("first", "analog", null);
    expect(store.effect("first", "clarity")?.clarity).toBe(20);
    store.setEffect("second", "analog", null);
    expect(store.hasEdits("second")).toBe(false);
    await store.flushAll();
    expect(storedEffects(repository).second).toBeUndefined();
  });

  it("clarity-only photo effects persist, survive other effect resets and reload with defaults for older data", async () => {
    const repository = new FakeEditRepository();
    repository.effectsJson = JSON.stringify({ old: { grain: { amount: 20 } }, photo: { clarity: { clarity: 40 } } });
    const store = new PhotoEditStore(repository, catalog);
    await store.load();
    expect(store.effect("old", "clarity")).toBeNull();
    expect(store.effect("old", "grain")).toEqual({ ...defaultGrain(), amount: 20 });
    expect(store.effect("photo", "clarity")).toEqual({ ...defaultClarity(), clarity: 40 });

    store.setEffect("new", "clarity", { ...defaultClarity(), structure: -25 });
    store.setEffect("new", "sharpen", defaultSharpen());
    store.setEffect("new", "sharpen", null);
    expect(store.hasEdits("new")).toBe(true);
    await store.flushAll();
    expect(storedEffects(repository).new).toEqual({
      sharpen: null,
      grain: null,
      clarity: { clarity: 0, structure: -25 },
      analog: null,
    });

    await store.reload();
    expect(store.effect("new", "clarity")?.structure).toBe(-25);
    store.setEffect("new", "clarity", null);
    expect(store.hasEdits("new")).toBe(false);
    expect(store.hasEffect("new", "clarity")).toBe(false);

    store.setEffect("old", "clarity", defaultClarity());
    store.setEffect("old", "clarity", null);
    expect(store.effect("old", "grain")?.amount).toBe(20);
    await store.flushAll();
    expect(storedEffects(repository).new).toBeUndefined();
  });

  it("slow photo saves stay ordered, update the preview immediately, and preserve a final revert", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const repository = new SlowEditRepository();
    const store = new PhotoEditStore(repository, catalog);
    const previews: number[] = [];
    store.subscribe(({ path }) => previews.push(store.effect(path!, "tone")?.exposure ?? 0));

    store.setEffect("photo", "tone", exposure(10));
    expect(previews).toEqual([10]);
    expect(repository.requests).toHaveLength(0);
    const first = store.flush("photo");
    await settle();
    store.setEffect("photo", "tone", exposure(20));
    const second = store.flush("photo");
    await settle();
    expect(repository.requests).toHaveLength(1);
    expect(previews).toEqual([10, 20]);

    repository.requests[0].resolve();
    await settle();
    expect(repository.requests[1].edit?.tone?.exposure).toBe(20);

    store.setEffect("photo", "tone", null);
    const revert = store.flush("photo");
    expect(previews).toEqual([10, 20, 0]);
    await settle();
    expect(repository.requests).toHaveLength(2);
    repository.requests[1].resolve();
    await settle();
    expect(repository.requests[2].command).toBe("clear");
    repository.requests[2].resolve();
    await Promise.all([first, second, revert]);
    expect(store.hasEdits("photo")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("saves crop, tone, curve and color as one row per photo and drops neutral values", async () => {
    const repository = new FakeEditRepository();
    repository.rows.set("loaded", { path: "loaded", crop, tone: null, curve: null, color: { saturation: 30 } as never });
    const store = new PhotoEditStore(repository, catalog);
    const changes: PhotoEditChange[] = [];
    store.subscribe((change) => changes.push(change));
    await store.load();
    expect(changes).toContainEqual({ path: null, payload: "edits" });
    expect(store.crop("loaded")).toEqual(crop);
    expect(store.effect("loaded", "color")).toEqual({ ...defaultColor(), saturation: 30 });

    store.setEffect("photo", "tone", exposure(15));
    store.setEffect("photo", "color", defaultColor());
    store.setCrop("photo", crop);
    await store.flush("photo");
    expect(repository.rows.get("photo")).toEqual({ path: "photo", crop, tone: exposure(15), curve: null, color: null });

    store.setEffect("photo", "tone", defaultTone());
    store.setCrop("photo", null);
    expect(store.hasEdits("photo")).toBe(false);
    await store.flush("photo");
    expect(repository.rows.has("photo")).toBe(false);
  });

  it("keeps bloom out of per-photo edits", () => {
    const store = new PhotoEditStore(new FakeEditRepository(), catalog);
    expect(store.effectIds).toEqual(["tone", "clarity", "color", "curve", "sharpen", "grain", "analog"]);
    expect(store.effect("photo", "bloom")).toBeNull();
    expect(() => store.setEffect("photo", "bloom", catalog.defaults("bloom"))).toThrow(/per photo/);
  });

  it("moves effects from the old browser storage into the library once", async () => {
    const repository = new FakeEditRepository();
    const storage = new MemoryStorage({ "warble.effects.v1": { photo: { grain: { amount: 12 } } } });
    const store = new PhotoEditStore(repository, catalog, storage);
    expect(store.effect("photo", "grain")?.amount).toBe(12);
    await store.load();
    expect(storedEffects(repository).photo.grain).toEqual({ ...defaultGrain(), amount: 12 });
    expect(storage.getItem("warble.effects.v1")).toBeNull();
  });

  it("forgets the effects of a removed media root", async () => {
    const repository = new FakeEditRepository();
    const store = new PhotoEditStore(repository, catalog);
    store.setEffect("root/a.jpg", "grain", { ...defaultGrain(), amount: 5 });
    store.setEffect("rooted/b.jpg", "grain", { ...defaultGrain(), amount: 5 });
    store.removeEffectsUnderRoot("root");
    await store.flushAll();
    expect(Object.keys(storedEffects(repository))).toEqual(["rooted/b.jpg"]);
  });
});

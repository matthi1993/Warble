import { describe, expect, it, vi } from "vitest";
import {
  type PersistedVariantPref,
  type Photo,
  VariantStore,
  availableFormats,
  availableVariants,
  fileForSelection,
  photoMediaTypes,
  primarySelection,
  variantCount,
} from "../src";

const photo: Photo = {
  path: "/a/Foo (edit).jpg",
  filename: "Foo",
  extensions: ["jpg", "raf"],
  files: [
    { path: "/a/Foo (10).jpg", extension: "jpg", variant: "10" },
    { path: "/a/Foo (edit).jpg", extension: "jpg", variant: "edit" },
    { path: "/a/Foo (Edit 2).jpeg", extension: "JPEG", variant: "Edit 2" },
    { path: "/a/Foo (2).jpg", extension: "jpg", variant: "2" },
    { path: "/a/Foo.jpg", extension: "jpg", variant: "base" },
    { path: "/a/Foo.raf", extension: "raf", variant: "base" },
  ],
};

describe("variants", () => {
  it("lists JPEG variants with base first, numeric order, and readable labels", () => {
    expect(availableFormats(photo)).toEqual(["jpg"]);
    expect(availableVariants(photo, "jpg")).toEqual([
      { key: "base", label: "Base" },
      { key: "2", label: "Variant 2" },
      { key: "10", label: "Variant 10" },
      { key: "edit", label: "Edit" },
      { key: "Edit 2", label: "Edit 2" },
    ]);
  });

  it("resolves selections to files and defaults to the photo's own file", () => {
    expect(fileForSelection(photo, "jpg", "2")).toBe("/a/Foo (2).jpg");
    expect(fileForSelection(photo, "jpg", "missing")).toBeNull();
    expect(primarySelection(photo)).toEqual({ format: "jpg", variant: "edit" });
    expect(primarySelection({ ...photo, path: "/a/Foo.raf" })).toEqual({ format: "jpg", variant: "base" });
    expect(primarySelection({ path: "/a/Bar.raf", filename: "Bar" })).toBeNull();
  });

  it("classifies media types from extensions, files, and the path, and counts distinct variants", () => {
    expect(photoMediaTypes(photo)).toEqual(new Set(["image", "raw"]));
    expect(photoMediaTypes({ path: "/a/clip.MOV", filename: "clip" })).toEqual(new Set(["movie"]));
    expect(variantCount(photo)).toBe(5);
    expect(variantCount({ path: "/a/solo.jpg", filename: "solo" })).toBe(1);
  });
});

describe("VariantStore", () => {
  function fixture(rows: PersistedVariantPref[] = []) {
    const backend = {
      getPhotoVariants: vi.fn(async () => rows),
      setPhotoVariant: vi.fn(async () => {}),
    };
    return { backend, store: new VariantStore(backend) };
  }

  it("loads persisted preferences once and ignores unknown formats", async () => {
    const { backend, store } = fixture([
      { path: "a.jpg", format: "jpg", variant: "edit" },
      { path: "b.jpg", format: "raw", variant: "base" },
    ]);
    const notified = vi.fn();
    store.subscribe(notified);

    await Promise.all([store.load(), store.load()]);

    expect(backend.getPhotoVariants).toHaveBeenCalledTimes(1);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(store.get("a.jpg")).toEqual({ format: "jpg", variant: "edit" });
    expect(store.get("b.jpg")).toBeNull();
  });

  it("publishes and persists a changed preference, and skips an unchanged one", () => {
    const { backend, store } = fixture();
    const notified = vi.fn();
    const unsubscribe = store.subscribe(notified);

    store.set("a.jpg", { format: "jpg", variant: "Edit" });
    store.set("a.jpg", { format: "jpg", variant: "Edit" });
    unsubscribe();
    store.set("a.jpg", { format: "jpg", variant: "base" });

    expect(notified).toHaveBeenCalledTimes(1);
    expect(backend.setPhotoVariant.mock.calls).toEqual([
      ["a.jpg", "jpg", "Edit"],
      ["a.jpg", "jpg", "base"],
    ]);
    expect(store.get("a.jpg")).toEqual({ format: "jpg", variant: "base" });
  });

  it("re-reads preferences on reload", async () => {
    const rows: PersistedVariantPref[] = [{ path: "a.jpg", format: "jpg", variant: "1" }];
    const { store } = fixture(rows);
    await store.load();
    rows[0] = { path: "b.jpg", format: "jpg", variant: "2" };

    await store.reload();

    expect(store.get("a.jpg")).toBeNull();
    expect(store.get("b.jpg")).toEqual({ format: "jpg", variant: "2" });
  });
});

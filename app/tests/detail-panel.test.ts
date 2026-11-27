import { describe, expect, it } from "vitest";
import { RatingStore, type ExifMetadata, type PersistedPhotoRating, type Photo } from "@warble/library";
import { DetailPanelController } from "../src/views/detail/detail-panel-controller";
import { MetadataEditorController } from "../src/views/detail/metadata-editor-controller";
import { SelectionRatingController } from "../src/views/detail/selection-rating-controller";

async function ratingStore(rows: PersistedPhotoRating[]): Promise<RatingStore> {
  const store = new RatingStore({ getPhotoRatings: async () => rows, setPhotoRating: async () => 1 });
  await store.load();
  return store;
}

function photo(path: string, files: Photo["files"] = []): Photo {
  return { path, filename: path, files };
}

describe("SelectionRatingController", () => {
  it("right panel applies mixed ratings and labels to the selection, clears shared values, and isolates full view", async () => {
    const ratings = await ratingStore([
      { path: "first", rating: 4, label: "green", ratedAt: 0 },
      { path: "second", rating: 2, label: "red", ratedAt: 0 },
      { path: "unselected", rating: 5, label: "blue", ratedAt: 0 },
    ]);
    const host = {
      photo: photo("first"),
      selectionPaths: ["first", "second"],
      fullViewOpen: false,
      updates: 0,
      requestUpdate: () => { host.updates++; },
    };
    const panel = new SelectionRatingController(host, ratings);
    panel.connect();
    expect(panel.commonRating).toBeNull();
    expect(panel.commonLabel).toBeNull();

    panel.toggleStars(4);
    expect([ratings.get("first").rating, ratings.get("second").rating]).toEqual([4, 4]);
    expect(panel.commonRating).toBe(4);
    expect(host.updates).toBeGreaterThan(0);
    panel.toggleStars(4);
    expect([ratings.get("first").rating, ratings.get("second").rating]).toEqual([0, 0]);

    panel.toggleLabel("green");
    expect([ratings.get("first").label, ratings.get("second").label]).toEqual(["green", "green"]);
    panel.toggleLabel("green");
    expect([ratings.get("first").label, ratings.get("second").label]).toEqual(["", ""]);

    host.fullViewOpen = true;
    expect(panel.targets).toEqual(["first"]);
    panel.toggleStars(5);
    expect(ratings.get("first").rating).toBe(5);
    expect(ratings.get("second").rating).toBe(0);
    expect(ratings.get("unselected")).toMatchObject({ rating: 5, label: "blue" });

    host.fullViewOpen = false;
    host.photo = photo("unselected");
    expect(panel.targets).toEqual(["unselected"]);
    panel.disconnect();
    const updates = host.updates;
    ratings.setStars(["first"], 1);
    expect(host.updates).toBe(updates);
  });
});

describe("DetailPanelController", () => {
  function panelHarness(read: (path: string) => Promise<ExifMetadata>) {
    const host = { photo: null as Photo | null, fullViewOpen: false, requestUpdate() {} };
    const selections = new Map<string, { format: "jpg"; variant: string }>();
    const panel = new DetailPanelController(host, {
      exif: { read },
      variants: { subscribe: () => () => {} },
      currentSelection: (shown) => selections.get(shown.path) ?? null,
    });
    return { host, panel, selections };
  }

  it("shows the EXIF data of the latest photo only and reloads it on request", async () => {
    const pending = new Map<string, (exif: ExifMetadata) => void>();
    const reads: string[] = [];
    const { host, panel } = panelHarness((path) => {
      reads.push(path);
      return new Promise((resolve) => pending.set(path, resolve));
    });

    host.photo = photo("a.jpg");
    panel.photoChanged(null);
    host.photo = photo("b.jpg");
    panel.photoChanged(photo("a.jpg"));
    pending.get("a.jpg")?.({ iso: "100" });
    await Promise.resolve();
    expect(panel.exif).toBeNull();
    pending.get("b.jpg")?.({ iso: "400" });
    await Promise.resolve();
    expect(panel.exif).toEqual({ iso: "400" });

    panel.photoChanged(photo("b.jpg"));
    expect(reads).toEqual(["a.jpg", "b.jpg"]);
    panel.refreshMetadata();
    expect(panel.exif).toBeNull();
    expect(reads).toEqual(["a.jpg", "b.jpg", "b.jpg"]);
  });

  it("falls back to empty EXIF data when reading fails and previews the selected variant", async () => {
    const { host, panel, selections } = panelHarness(() => Promise.reject(new Error("unreadable")));
    const shown = photo("shot.jpg", [
      { path: "shot.jpg", extension: "jpg", variant: "" },
      { path: "shot (edit).jpg", extension: "jpg", variant: "edit" },
    ]);
    host.photo = shown;
    panel.photoChanged(null);
    await new Promise((resolve) => setTimeout(resolve));
    expect(panel.exif).toEqual({});

    expect(panel.currentPath(shown)).toBe("shot.jpg");
    selections.set("shot.jpg", { format: "jpg", variant: "edit" });
    expect(panel.currentPath(shown)).toBe("shot (edit).jpg");
  });
});

describe("MetadataEditorController", () => {
  function editorHarness(paths: string[], original: ExifMetadata = {}) {
    const events: Event[] = [];
    const saved: { paths: readonly string[]; changes: object }[] = [];
    const host = { paths, requestUpdate() {}, dispatchEvent: (event: Event) => events.push(event) > 0 };
    const editor = new MetadataEditorController(
      host,
      { read: async () => original },
      { setPhotoMetadata: async (photoPaths, changes) => { saved.push({ paths: photoPaths, changes }); } },
    );
    return { editor, events, saved };
  }

  it("shows the stored values of one photo and saves only the changed fields", async () => {
    const { editor, events, saved } = editorHarness(["a.jpg"], { dateTaken: "2024:05:06 07:08", artist: "Ada" });
    editor.load();
    await new Promise((resolve) => setTimeout(resolve));
    expect(editor.loading).toBe(false);
    expect(editor.fieldValue("dateTaken")).toBe("2024-05-06T07:08:00");
    expect(editor.fieldValue("artist")).toBe("Ada");

    editor.setField("dateTaken", "2024-05-07T01:02:03");
    editor.setField("artist", "");
    expect(editor.fieldValue("artist")).toBe("");
    await editor.save();
    expect(saved).toEqual([{ paths: ["a.jpg"], changes: { dateTaken: "2024-05-07 01:02:03", artist: "" } }]);
    expect(events.map((event) => event.type)).toEqual(["metadata-saved", "close"]);
    expect((events[0] as CustomEvent).detail).toEqual({
      paths: ["a.jpg"],
      dateTaken: "2024-05-07 01:02:03",
      artist: "",
    });
  });

  it("starts several photos with empty fields and closes without saving when nothing changed", async () => {
    const { editor, events, saved } = editorHarness(["a.jpg", "b.jpg"], { artist: "Ada" });
    editor.load();
    expect(editor.loading).toBe(false);
    expect(editor.fieldValue("artist")).toBe("");
    await editor.save();
    expect(saved).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(["close"]);
  });
});

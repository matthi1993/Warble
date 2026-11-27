import { describe, expect, it, vi } from "vitest";
import {
  DatePhotoIndex,
  DateTreeIndex,
  type DateTreeNode,
  type Photo,
  captureDay,
  matchesDateSelection,
  sortPhotosOldestFirst,
} from "../src";

function photo(filename: string, dateTaken?: string | null, captureTime?: string): Photo {
  return { path: `/lib/${filename}.jpg`, filename, filterInfo: { dateTaken, captureTime } };
}

function outline(nodes: DateTreeNode[]): unknown[] {
  return nodes.map((node) =>
    node.children.length ? [node.key, node.count, outline(node.children)] : [node.key, node.count],
  );
}

describe("capture dates", () => {
  it("accepts only real calendar days", () => {
    expect(captureDay(photo("a", "2026-02-28"))).toBe("2026-02-28");
    expect(captureDay(photo("a", "2026-02-30"))).toBeNull();
    expect(captureDay(photo("a", "2026:02:28"))).toBeNull();
    expect(captureDay({ path: "x", filename: "x" })).toBeNull();
  });

  it("matches year, month, day, and undated selections", () => {
    const dated = photo("a", "2026-10-07");
    expect(matchesDateSelection(dated, null)).toBe(true);
    expect(matchesDateSelection(dated, "2026")).toBe(true);
    expect(matchesDateSelection(dated, "2026-10")).toBe(true);
    expect(matchesDateSelection(dated, "2026-10-08")).toBe(false);
    expect(matchesDateSelection(dated, "undated")).toBe(false);
    expect(matchesDateSelection(photo("b"), "undated")).toBe(true);
  });
});

describe("sortPhotosOldestFirst", () => {
  it("orders by day, capture time, then natural filename, with undated photos last", () => {
    const sorted = sortPhotosOldestFirst([
      photo("undated"),
      photo("IMG_10", "2026-10-07"),
      photo("img_9", "2026-10-07"),
      photo("late", "2026-10-07", "2026-10-07 18:00:00"),
      photo("early", "2026-10-07", "2026-10-07 06:00:00"),
      photo("older", "2025-01-01"),
    ]);
    expect(sorted.map((item) => item.filename)).toEqual([
      "older",
      "early",
      "late",
      "img_9",
      "IMG_10",
      "undated",
    ]);
  });
});

describe("DateTreeIndex", () => {
  it("builds a newest-first year, month, day tree with an undated node and follows metadata updates", () => {
    const index = new DateTreeIndex();
    index.replacePhotos([
      photo("a", "2026-10-07"),
      photo("b", "2026-10-07"),
      photo("c", "2026-09-30"),
      photo("d", "2025-12-24"),
      photo("e"),
    ]);
    expect(outline(index.getTree())).toEqual([
      ["2026", 3, [["2026-10", 2, [["2026-10-07", 2]]], ["2026-09", 1, [["2026-09-30", 1]]]]],
      ["2025", 1, [["2025-12", 1, [["2025-12-24", 1]]]]],
      ["undated", 1],
    ]);
    expect(index.getTree()).toBe(index.getTree());

    index.updateMetadata([
      { path: "/lib/e.jpg", dateTaken: "2026-10-07" },
      { path: "/lib/d.jpg", dateTaken: null },
      { path: "/lib/unknown.jpg", dateTaken: "1999-01-01" },
    ]);
    expect(outline(index.getTree())).toEqual([
      ["2026", 4, [["2026-10", 3, [["2026-10-07", 3]]], ["2026-09", 1, [["2026-09-30", 1]]]]],
      ["undated", 1],
    ]);
  });
});

describe("DatePhotoIndex", () => {
  it("serves sorted, enriched photos per date and rebuilds only for a new library array or after invalidation", () => {
    const library = [photo("b", "2026-10-08"), photo("a", "2026-10-07"), photo("c")];
    const enrich = vi.fn((photos: Photo[]) => photos);
    const index = new DatePhotoIndex({ enrich });

    expect(index.photosFor(library, null).map((item) => item.filename)).toEqual(["a", "b", "c"]);
    expect(index.photosFor(library, "2026-10-07").map((item) => item.filename)).toEqual(["a"]);
    expect(index.photosFor(library, "undated").map((item) => item.filename)).toEqual(["c"]);
    expect(index.photosFor(library, "2026-10-07")).toBe(index.photosFor(library, "2026-10-07"));
    expect(enrich).toHaveBeenCalledTimes(1);

    index.invalidatePhotos();
    index.photosFor(library, null);
    expect(enrich).toHaveBeenCalledTimes(2);

    expect(outline(index.nodes(library))).toEqual([
      ["2026", 2, [["2026-10", 2, [["2026-10-08", 1], ["2026-10-07", 1]]]]],
      ["undated", 1],
    ]);
    index.updateMetadata(library, [{ path: "/lib/c.jpg", dateTaken: "2026-10-08" }]);
    expect(outline(index.nodes(library))).toEqual([
      ["2026", 3, [["2026-10", 3, [["2026-10-08", 2], ["2026-10-07", 1]]]]],
    ]);
    expect(enrich).toHaveBeenCalledTimes(3);
  });
});

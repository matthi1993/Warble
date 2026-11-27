import { describe, expect, it } from "vitest";
import { RatingStore, type Photo } from "@warble/library";
import { PhotoGridController } from "../src/views/grid/photo-grid-controller";

function photo(name: string, day: string | null = "2024-01-01"): Photo {
  return { path: name, filename: `${name}.jpg`, filterInfo: day ? { dateTaken: day } : undefined };
}

function photosOnDay(count: number, day: string): Photo[] {
  return Array.from({ length: count }, (_, index) => photo(`${day}-${index}`, day));
}

function gridHarness(photos: Photo[]) {
  const events: CustomEvent[] = [];
  const revealed: (string | null)[] = [];
  const stored = new Map<string, string>();
  const ratings = new RatingStore({ getPhotoRatings: async () => [], setPhotoRating: async () => 1 });
  const host = {
    photos,
    selectedPath: null as string | null,
    filterMetadataLoading: false,
    requestUpdate() {},
    // Stands in for the app shell, which makes the announced photo the primary selection.
    dispatchEvent(event: Event): boolean {
      events.push(event as CustomEvent);
      if (event.type === "photo-selected") {
        host.selectedPath = (event as CustomEvent).detail.path;
        grid.hostUpdated({ photos: false, selectedPath: true, fullViewClosed: false });
      }
      return true;
    },
  };
  const layout = {
    columns: 3,
    columnCount: () => layout.columns,
    scrollToPhotoSoon: (path: () => string | null) => { revealed.push(path()); },
  };
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
  };
  const grid = new PhotoGridController(host, { ratings, storage, layout });
  const showPhotos = (next: Photo[]) => {
    host.photos = next;
    grid.hostUpdated({ photos: true, selectedPath: false, fullViewClosed: false });
  };
  showPhotos(photos);
  const eventsOf = (type: string) => events.filter((event) => event.type === type).map((event) => event.detail);
  return { grid, host, layout, ratings, stored, revealed, events, eventsOf, showPhotos };
}

describe("PhotoGridController selection", () => {
  it("selects ranges in display order, toggles single cards and publishes only real changes", () => {
    const later = [photo("d", "2024-01-02"), photo("e", "2024-01-02")];
    const earlier = [photo("a"), photo("b"), photo("c")];
    const { grid, host, eventsOf } = gridHarness([...later, ...earlier, photo("undated", null)]);
    const { selection } = grid;

    selection.selectCard({ path: "b" });
    expect(host.selectedPath).toBe("b");
    selection.selectCard({ path: "d", shiftKey: true });
    expect(selection.getSelectionPaths()).toEqual(["b", "c", "d"]);
    expect(host.selectedPath).toBe("d");

    selection.selectCard({ path: "d", toggle: true });
    expect(selection.getSelectionPaths()).toEqual(["b", "c"]);
    expect(host.selectedPath).toBe("b");

    selection.publishSelection();
    selection.publishSelection();
    expect(eventsOf("photo-selection-change")).toEqual([{ paths: ["b", "c"] }]);

    selection.startPointerDrag({ path: "c", pointerId: 7, x: 1, y: 2 });
    selection.startPointerDrag({ path: "e", pointerId: 8, x: 3, y: 4 });
    expect(eventsOf("photo-grid-pointer-drag-start")).toEqual([
      { paths: ["b", "c"], pointerId: 7, x: 1, y: 2 },
      { paths: ["e"], pointerId: 8, x: 3, y: 4 },
    ]);
  });

  it("selects all, moves by cells and rows with the keyboard and opens the primary photo", () => {
    const { grid, host, layout, revealed, eventsOf } = gridHarness(photosOnDay(8, "2024-01-01"));
    const { selection } = grid;

    selection.selectAll();
    expect(selection.getSelectionPaths()).toHaveLength(8);
    expect(host.selectedPath).toBe("2024-01-01-0");

    expect(selection.moveSelection(1, 0)).toBe(true);
    expect(host.selectedPath).toBe("2024-01-01-1");
    expect(selection.getSelectionPaths()).toEqual(["2024-01-01-1"]);
    expect(selection.moveSelection(0, 1)).toBe(true);
    expect(host.selectedPath).toBe("2024-01-01-4");
    expect(selection.moveSelection(0, 5)).toBe(true);
    expect(host.selectedPath).toBe("2024-01-01-7");
    expect(revealed[revealed.length - 1]).toBe("2024-01-01-7");

    selection.openSelected();
    expect(eventsOf("photo-open")).toEqual([{ path: "2024-01-01-7", filename: "2024-01-01-7.jpg" }]);

    layout.columns = 0;
    expect(selection.moveSelection(1, 0)).toBe(false);
  });

  it("scrolls to a selection made elsewhere but not to a clicked card", () => {
    const { grid, host, revealed } = gridHarness([photo("a"), photo("b"), photo("c")]);

    grid.selection.selectCard({ path: "b" });
    expect(revealed).toEqual([]);

    host.selectedPath = "c";
    grid.hostUpdated({ photos: false, selectedPath: true, fullViewClosed: false });
    expect(revealed).toEqual(["c"]);
    expect(grid.selection.getSelectionPaths()).toEqual(["c"]);

    grid.hostUpdated({ photos: false, selectedPath: false, fullViewClosed: true });
    expect(revealed).toEqual(["c", "c"]);
  });

  it("enters touch selection after a long press and keeps the selection for the same photos only", () => {
    const photos = [photo("a"), photo("b"), photo("c")];
    const { grid, host, showPhotos } = gridHarness(photos);
    const { selection } = grid;

    selection.selectCard({ path: "a", touch: true });
    selection.selectCard({ path: "b", touch: true });
    expect(selection.getSelectionPaths()).toEqual(["b"]);

    selection.selectForContextMenu({ path: "b", longPress: true });
    selection.selectCard({ path: "c", touch: true });
    expect(selection.getSelectionPaths()).toEqual(["b", "c"]);

    showPhotos([...photos].reverse());
    expect(selection.getSelectionPaths()).toEqual(["c", "b"]);

    showPhotos([...photos, photo("z")]);
    expect(host.selectedPath).toBe("c");
    expect(selection.getSelectionPaths()).toEqual(["c"]);
    selection.selectCard({ path: "z", touch: true });
    expect(selection.getSelectionPaths()).toEqual(["z"]);
  });
});

describe("PhotoGridController paging and filtering", () => {
  it("renders days and photos page by page and reveals the page of a photo reached by keyboard", () => {
    const days = Array.from({ length: 10 }, (_, index) => `2024-02-${String(index + 1).padStart(2, "0")}`);
    const photos = days.flatMap((day, index) => photosOnDay(index === 0 ? 120 : 2, day));
    const { grid, host } = gridHarness(photos);
    const { days: paging, selection } = grid;
    const [firstDay] = paging.dayGroups;

    expect(paging.dayGroups).toHaveLength(10);
    expect(paging.visibleGroups).toHaveLength(8);
    expect(paging.hasMoreGroups).toBe(true);
    expect(paging.visiblePhotos(firstDay)).toHaveLength(48);
    expect(paging.hasMorePhotos(firstDay)).toBe(true);

    paging.showMoreForDay("2024-02-01");
    expect(paging.visiblePhotos(firstDay)).toHaveLength(96);
    paging.showMoreGroups();
    expect(paging.visibleGroups).toHaveLength(10);
    expect(paging.hasMoreGroups).toBe(false);

    grid.filters.setCamera("none");
    grid.filters.clearFilters();
    expect(paging.visiblePhotos(paging.dayGroups[0])).toHaveLength(48);

    host.selectedPath = "2024-02-01-47";
    expect(selection.moveSelection(0, 20)).toBe(true);
    expect(host.selectedPath).toBe("2024-02-01-107");
    expect(paging.visiblePhotos(paging.dayGroups[0])).toHaveLength(120);

    paging.toggleDay(paging.dayGroups[0]);
    expect(paging.expandedPhotos).toHaveLength(18);
    expect(selection.moveSelection(1, 0)).toBe(true);
    expect(host.selectedPath).toBe("2024-02-02-0");
  });

  it("starts a different set of photos on the first page with every day expanded", () => {
    const { grid, showPhotos } = gridHarness(photosOnDay(100, "2024-03-01"));
    const paging = grid.days;
    paging.showMoreForDay("2024-03-01");
    paging.toggleDay(paging.dayGroups[0]);

    showPhotos(photosOnDay(100, "2024-03-01").reverse());
    expect(paging.isExpanded(paging.dayGroups[0])).toBe(false);

    showPhotos(photosOnDay(60, "2024-03-01"));
    expect(paging.isExpanded(paging.dayGroups[0])).toBe(true);
    expect(paging.visiblePhotos(paging.dayGroups[0])).toHaveLength(48);
    expect(paging.formatDay(null)).toBe("Date unknown");
  });

  it("filters by rating, follows rating changes and reuses the result until an input changes", () => {
    const { grid, ratings } = gridHarness([photo("a"), photo("b"), photo("c")]);
    grid.connect();
    const unfiltered = grid.filteredPhotos;
    expect(grid.filters.filtersActive).toBe(false);

    ratings.setStars(["a", "b"], 3);
    grid.filters.setMinStars(3);
    expect(grid.filters.filtersActive).toBe(true);
    const filtered = grid.filteredPhotos;
    expect(filtered.map((item) => item.path)).toEqual(["a", "b"]);
    expect(grid.filteredPhotos).toBe(filtered);

    grid.selection.selectAll();
    expect(grid.selection.getSelectionPaths()).toEqual(["a", "b"]);
    ratings.setStars(["b"], 1);
    expect(grid.filteredPhotos.map((item) => item.path)).toEqual(["a"]);
    expect(grid.selection.getSelectionPaths()).toEqual(["a"]);

    grid.filters.setMinStars(3);
    expect(grid.filteredPhotos).toBe(unfiltered);
    grid.disconnect();
  });

  it("remembers the column count and maps the inverted size slider", () => {
    const { grid, stored } = gridHarness([]);
    expect(grid.columns.count).toBe(6);
    grid.columns.setFromSlider(8);
    expect(grid.columns.count).toBe(1);
    expect(grid.columns.sliderValue).toBe(8);
    grid.columns.setColumns(40);
    expect(stored.get("pf-grid-columns")).toBe("8");
  });
});

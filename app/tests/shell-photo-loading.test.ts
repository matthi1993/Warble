import { describe, expect, it } from "vitest";
import type { Photo, PhotoFilterMetadata } from "@warble/library";
import { FolderSelectionController } from "@app/shell/folder-selection-controller";
import { LibraryNavigationController } from "@app/shell/library-navigation-controller";
import { LibraryPhotosController } from "@app/shell/library-photos-controller";
import { createShellFixture, Deferred, folder, paths, photo, settle } from "./support/shell-fakes";

function libraryFixture() {
  const fixture = createShellFixture();
  const allPhotos: Deferred<Photo[]>[] = [];
  const cachedRequests: string[][] = [];
  const cached = new Map<string, PhotoFilterMetadata>();
  const albumCalls: string[] = [];
  const backend = {
    getAllPhotos: () => {
      const answer = new Deferred<Photo[]>();
      allPhotos.push(answer);
      return answer.promise;
    },
    getCachedPhotoFilterMetadata: async (requested: readonly string[]) => {
      cachedRequests.push([...requested]);
      return requested.flatMap((path) => cached.get(path) ?? []);
    },
  };
  const albums = {
    load: async () => void albumCalls.push("load"),
    refreshPhotos: async () => void albumCalls.push("refreshPhotos"),
  };
  const libraryPhotos = new LibraryPhotosController(
    fixture.state, backend, fixture.pipeline, fixture.dates, fixture.photoList, albums,
  );
  const navigation = new LibraryNavigationController(fixture.state, fixture.photoList, libraryPhotos, fixture.sections);
  return { ...fixture, allPhotos, cachedRequests, cached, albumCalls, libraryPhotos, navigation };
}

describe("PhotoListController", () => {
  it("lists only rated photos as favorites and follows rating changes", () => {
    const { state, ratings, photoList } = createShellFixture();
    state.change({ mode: "favorites", libraryPhotos: [photo("/a.jpg"), photo("/b.jpg"), photo("/c.jpg")] });
    ratings.stars.set("/b.jpg", 3);
    photoList.showLibraryPhotos();
    expect(paths(state.photos)).toEqual(["/b.jpg"]);

    ratings.stars.set("/c.jpg", 1);
    photoList.ratingChanged("/c.jpg");
    expect(paths(state.photos)).toEqual(["/b.jpg", "/c.jpg"]);

    ratings.stars.set("/b.jpg", 5);
    const unchanged = state.photos;
    photoList.ratingChanged("/b.jpg");
    expect(state.photos).toBe(unchanged);
  });

  it("keeps the open photo when it stays in the list and moves to its neighbour when it leaves", () => {
    const { state, ratings, photoList } = createShellFixture();
    const library = [photo("/a.jpg"), photo("/b.jpg"), photo("/c.jpg")];
    for (const item of library) ratings.stars.set(item.path, 1);
    state.change({ mode: "favorites", libraryPhotos: library });
    photoList.showLibraryPhotos();
    state.change({ selectedPhoto: state.photos[1], fullViewIndex: 1 });

    ratings.stars.set("/a.jpg", 0);
    photoList.ratingChanged("/a.jpg");
    expect(state.selectedPhoto?.path).toBe("/b.jpg");
    expect(state.fullViewIndex).toBe(0);

    ratings.stars.set("/b.jpg", 0);
    photoList.ratingChanged("/b.jpg");
    expect(state.selectedPhoto?.path).toBe("/c.jpg");
    expect(state.fullViewIndex).toBe(0);
  });

  it("drops the selection in the grid when the selected photo leaves the list", () => {
    const { state, ratings, photoList } = createShellFixture();
    ratings.stars.set("/a.jpg", 1);
    state.change({ mode: "favorites", libraryPhotos: [photo("/a.jpg")] });
    photoList.showLibraryPhotos();
    state.change({ selectedPhoto: state.photos[0] });
    ratings.stars.set("/a.jpg", 0);
    photoList.ratingChanged("");
    expect(state.photos).toEqual([]);
    expect(state.selectedPhoto).toBeNull();
  });

  it("re-sorts the folder and follows the open photo once capture dates were read", () => {
    const { state, pipeline, photoList } = createShellFixture();
    photoList.setPhotos([photo("/a.jpg"), photo("/b.jpg")]);
    state.change({ selectedPhoto: state.photos[0], fullViewIndex: 0 });
    pipeline.deliver([{ path: "/a.jpg", dateTaken: "2024-05-02" }, { path: "/b.jpg", dateTaken: "2024-05-01" }]);
    expect(paths(state.photos)).toEqual(["/b.jpg", "/a.jpg"]);
    expect(state.selectedPhoto).toBe(state.photos[1]);
    expect(state.fullViewIndex).toBe(1);
    expect(state.filterMetadataLoading).toBe(false);
  });
});

describe("LibraryPhotosController", () => {
  it("shows all photos, restores cached capture dates in batches and then starts the metadata work", async () => {
    const { state, pipeline, allPhotos, cachedRequests, cached, albumCalls, navigation } = libraryFixture();
    const library = Array.from({ length: 300 }, (_, index) => photo(`/p${String(index).padStart(3, "0")}.jpg`));
    cached.set("/p299.jpg", { path: "/p299.jpg", dateTaken: "2020-01-01" });
    navigation.selectAllPhotos();
    expect(state.mode).toBe("allPhotos");
    allPhotos[0].resolve(library);
    await Promise.resolve();
    expect(state.restoringCachedDates).toBe(true);
    expect(state.photos).toHaveLength(300);
    await settle();
    expect(cachedRequests.map((batch) => batch.length)).toEqual([256, 44]);
    expect(state.restoringCachedDates).toBe(false);
    expect(state.filterMetadataLoading).toBe(false);
    expect(state.photos[0].path).toBe("/p299.jpg");
    expect(albumCalls).toEqual(["load"]);
    expect(pipeline.starts).toBeGreaterThan(0);
  });

  it("ignores the answer of a refresh that was superseded", async () => {
    const { state, allPhotos, libraryPhotos } = libraryFixture();
    state.change({ mode: "allPhotos" });
    void libraryPhotos.refresh();
    void libraryPhotos.refresh();
    allPhotos[1].resolve([photo("/new.jpg")]);
    await settle();
    allPhotos[0].resolve([photo("/old.jpg")]);
    await settle();
    expect(paths(state.libraryPhotos)).toEqual(["/new.jpg"]);
    expect(paths(state.photos)).toEqual(["/new.jpg"]);
  });

  it("lists the photos of the selected capture date and loads the library when it is still empty", async () => {
    const { state, allPhotos, navigation } = libraryFixture();
    state.change({ imports: [folder("/root")] });
    navigation.selectDate("2024-05");
    expect(state.expandedSections.has("days")).toBe(true);
    allPhotos[0].resolve([photo("/a.jpg", "2024-05-01"), photo("/b.jpg", "2024-06-01"), photo("/c.jpg", "2024-05-09")]);
    await settle();
    expect(paths(state.photos)).toEqual(["/a.jpg", "/c.jpg"]);
    navigation.selectDate("2024-06");
    expect(paths(state.photos)).toEqual(["/b.jpg"]);
    expect(allPhotos).toHaveLength(1);
  });
});

describe("FolderSelectionController", () => {
  function folderFixture() {
    const fixture = createShellFixture();
    const answers = new Map<string, Deferred<Photo[]>>();
    const calls: string[] = [];
    const backend = {
      getPhotosInFolder: (path: string, recursive: boolean) => {
        calls.push(`photos ${path} ${recursive}`);
        const answer = new Deferred<Photo[]>();
        answers.set(path, answer);
        return answer.promise;
      },
      indexFolderImages: async (path: string, recursive: boolean) => void calls.push(`index ${path} ${recursive}`),
      getLastFolder: async () => null,
      setLastFolder: async (path: string) => void calls.push(`last ${path}`),
    };
    const folderSelection = new FolderSelectionController(fixture.state, backend, fixture.photoList, fixture.sections);
    return { ...fixture, answers, calls, folderSelection };
  }

  it("opens a folder, jumps the full view to its first photo and remembers it", async () => {
    const { state, answers, calls, folderSelection } = folderFixture();
    state.change({ photos: [photo("/old/x.jpg")], fullViewIndex: 0, includeSubfolders: true });
    const selecting = folderSelection.select("/root/trip", "/root/trip");
    expect(state.selectedFolderName).toBe("trip");
    answers.get("/root/trip")!.resolve([photo("/root/trip/b.jpg"), photo("/root/trip/a.jpg")]);
    await selecting;
    expect(paths(state.photos)).toEqual(["/root/trip/a.jpg", "/root/trip/b.jpg"]);
    expect(state.selectedPhoto?.path).toBe("/root/trip/a.jpg");
    expect(state.fullViewIndex).toBe(0);
    expect(calls).toEqual(["index /root/trip true", "photos /root/trip true", "last /root/trip"]);
  });

  it("never shows a folder that answers after the user moved on", async () => {
    const { state, answers, calls, folderSelection } = folderFixture();
    const first = folderSelection.select("/a", "/a");
    const second = folderSelection.select("/b", "/b");
    answers.get("/b")!.resolve([photo("/b/1.jpg")]);
    await second;
    answers.get("/a")!.resolve([photo("/a/1.jpg")]);
    await first;
    expect(paths(state.photos)).toEqual(["/b/1.jpg"]);

    const third = folderSelection.select("/c", "/c");
    state.change({ mode: "albums", selectedFolderId: null, photos: [] });
    answers.get("/c")!.resolve([photo("/c/1.jpg")]);
    await third;
    expect(state.photos).toEqual([]);
    expect(calls).not.toContain("last /c");
  });

  it("clears the selection and forgets the last folder", () => {
    const { state, calls, folderSelection } = folderFixture();
    folderSelection.clear();
    expect(calls).toEqual([]);
    state.change({ selectedFolderId: "/a", selectedFolderName: "a", photos: [photo("/a/1.jpg")] });
    folderSelection.clear();
    expect(state.selectedFolderId).toBeNull();
    expect(state.photos).toEqual([]);
    expect(calls).toEqual(["last "]);
  });
});

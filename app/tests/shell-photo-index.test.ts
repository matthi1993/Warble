import { describe, expect, it, vi } from "vitest";
import type { PhotoIndexUpdate } from "@warble/library";
import { PhotoIndexController } from "@app/shell/photo-index-controller";
import { createShellFixture, photo } from "./support/shell-fakes";

function indexFixture(flushFails = false) {
  const fixture = createShellFixture();
  const calls: string[] = [];
  const record = (name: string) => (paths: readonly string[]) => void calls.push(`${name} ${paths.join(",")}`);
  const controller = new PhotoIndexController(
    fixture.state,
    { onPhotoIndexSynced: async () => () => {} },
    { thumbnails: { invalidate: record("thumbnails") }, hdImages: { invalidate: record("hd") }, fullImages: { invalidate: record("full") } },
    fixture.pipeline,
    fixture.dates,
    {
      fullView: () => ({
        presentationActive: false,
        toggleVideoPlayback: () => false,
        startPresentation: () => {},
        stopPresentation: () => {},
        refreshPhotoSource: (path: string) => void calls.push(`fullView ${path}`),
      }),
      reloadThumbnails: (paths?: ReadonlySet<string>) => void calls.push(`cards ${[...(paths ?? [])].join(",")}`),
    },
    {
      flushPendingWrites: async () => {
        calls.push("flush");
        if (flushFails) throw new Error("sidecar is read-only");
      },
      reloadEditsAndRatings: async () => void calls.push("reload"),
    },
    { refresh: async () => void calls.push("counts") },
    { refresh: async () => void calls.push("library") },
    { refreshFromIndex: async () => void calls.push("folder") },
  );
  const dated = [photo("/root/trip/a.jpg", "2024-05-01"), photo("/root/trip/b.jpg", "2024-05-02"), photo("/other/c.jpg", "2024-05-03")];
  fixture.state.change({ photos: dated, libraryPhotos: dated, selectedPhoto: dated[0], selectedFolderId: "/root/trip" });
  return { ...fixture, calls, controller };
}

function update(changes: Partial<PhotoIndexUpdate>): PhotoIndexUpdate {
  return { folderKey: "/root/trip", changedImages: [], metadataChanged: false, ...changes };
}

describe("PhotoIndexController", () => {
  it("forgets metadata and cached images of changed files and reloads what is on screen", async () => {
    const { state, pipeline, calls, controller } = indexFixture();
    await controller.synced(update({ changedImages: ["/root/trip/a.jpg"] }));
    expect(pipeline.invalidated).toEqual(["/root/trip/a.jpg"]);
    expect(state.photos.map((item) => item.filterInfo?.dateTaken)).toEqual([undefined, "2024-05-02", "2024-05-03"]);
    expect(state.selectedPhoto).toMatchObject({ path: "/root/trip/a.jpg", filterInfo: undefined });
    expect(calls).toEqual([
      "counts",
      "thumbnails /root/trip/a.jpg",
      "hd /root/trip/a.jpg",
      "full /root/trip/a.jpg",
      "fullView /root/trip/a.jpg",
      "cards /root/trip/a.jpg",
      "library",
      "folder",
    ]);
  });

  it("re-reads edits and ratings after sidecar changes, once pending local writes are saved", async () => {
    const { state, pipeline, calls, controller } = indexFixture();
    await controller.synced(update({ folderKey: "/root", metadataChanged: true }));
    expect(pipeline.invalidated).toEqual(["/root/trip/a.jpg", "/root/trip/b.jpg"]);
    expect(state.photos.map((item) => item.filterInfo?.dateTaken)).toEqual([undefined, undefined, "2024-05-03"]);
    expect(calls).toEqual(["counts", "flush", "reload", "library", "folder"]);
  });

  it("keeps local edits and skips the reload when pending writes cannot be saved", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, controller } = indexFixture(true);
    await controller.synced(update({ metadataChanged: true }));
    expect(calls).toEqual(["counts", "flush"]);
    errors.mockRestore();
  });

  it("only refreshes the counts when nothing in the open folder changed", async () => {
    const { calls, controller } = indexFixture();
    await controller.synced(update({ folderKey: "/elsewhere" }));
    expect(calls).toEqual(["counts"]);
  });
});

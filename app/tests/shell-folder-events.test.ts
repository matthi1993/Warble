import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskTracker, type TaskRecord } from "@warble/core";
import type { FolderImageUpdate, FolderScanProgress, FolderUpdate, Photo } from "@warble/library";
import { FolderEventsController } from "@app/shell/folder-events-controller";
import { FolderScanTasks } from "@app/shell/folder-scan-tasks";
import { createShellFixture, folder, paths, photo } from "./support/shell-fakes";

function eventsFixture() {
  const fixture = createShellFixture();
  const calls: string[] = [];
  const folderPhotos = new Map<string, Photo[]>();
  const emit = {
    rehydrated: () => {},
    scanProgress: (_progress: FolderScanProgress) => {},
    foldersUpdated: (_update: FolderUpdate) => {},
    imagesUpdated: (_update: FolderImageUpdate) => {},
  };
  const unsubscribe = () => void calls.push("unsubscribe");
  const backend = {
    onFoldersRehydrated: async (listener: () => void) => ((emit.rehydrated = listener), unsubscribe),
    onFolderScanProgress: async (listener: typeof emit.scanProgress) => ((emit.scanProgress = listener), unsubscribe),
    onFoldersUpdated: async (listener: typeof emit.foldersUpdated) => ((emit.foldersUpdated = listener), unsubscribe),
    onFolderImagesUpdated: async (listener: typeof emit.imagesUpdated) => ((emit.imagesUpdated = listener), unsubscribe),
    getPhotosInFolder: async (path: string, recursive: boolean) => {
      calls.push(`photos ${path} ${recursive}`);
      return folderPhotos.get(path) ?? [];
    },
  };
  const tasks = new TaskTracker();
  const controller = new FolderEventsController(
    fixture.state,
    backend,
    new FolderScanTasks(tasks),
    { rehydrated: async () => void calls.push("rehydrated") },
    {
      select: async (_id: string, path: string) => void calls.push(`select ${path}`),
      refreshFromIndex: async () => void calls.push("refreshFromIndex"),
      requestImageIndex: (path: string, recursive: boolean) => void calls.push(`index ${path} ${recursive}`),
    },
    fixture.photoList,
    { refresh: async () => void calls.push("counts") },
    { refresh: async () => void calls.push("library") },
  );
  return { ...fixture, calls, folderPhotos, emit, tasks, controller };
}

function scanned(folderKey: string, contentChanged = true): FolderUpdate {
  const root = folder("/root", [folder("/root/trip", [folder("/root/trip/day1")])]);
  return { folders: [root, folder("/other")], rootId: folderKey.startsWith("/other") ? "/other" : "/root", folderKey, contentChanged };
}

function taskSnapshot(tasks: TaskTracker): { active: readonly TaskRecord[]; recent: readonly TaskRecord[] } {
  let snapshot = { active: [] as readonly TaskRecord[], recent: [] as readonly TaskRecord[] };
  tasks.subscribe((active, recent) => (snapshot = { active, recent }))();
  return snapshot;
}

describe("FolderEventsController folder scans", () => {
  it("only replaces the folder tree when a scan found no content changes", async () => {
    const { state, calls, controller } = eventsFixture();
    state.change({ selectedFolderId: "/root/trip", pendingRestoreFolderPath: "/root/trip" });
    await controller.foldersUpdated(scanned("/root", false));
    expect(state.imports).toHaveLength(2);
    expect(calls).toEqual([]);
  });

  it("opens the folder remembered from the last session once a scan finds it", async () => {
    const { state, calls, controller } = eventsFixture();
    state.change({ pendingRestoreFolderPath: "/root/trip" });
    await controller.foldersUpdated(scanned("/root"));
    expect(state.pendingRestoreFolderPath).toBeNull();
    expect(calls).toEqual(["index /root true", "select /root/trip"]);
  });

  it("reloads the open folder when the scan covers it", async () => {
    const { state, calls, folderPhotos, controller } = eventsFixture();
    folderPhotos.set("/root/trip", [photo("/root/trip/b.jpg"), photo("/root/trip/a.jpg")]);
    state.change({ selectedFolderId: "/root/trip" });
    await controller.foldersUpdated(scanned("/root"));
    expect(calls).toEqual(["index /root true", "index /root/trip false", "photos /root/trip false"]);
    expect(paths(state.photos)).toEqual(["/root/trip/a.jpg", "/root/trip/b.jpg"]);
  });

  it("ignores scans outside the open folder unless subfolders are included", async () => {
    const { state, calls, controller } = eventsFixture();
    state.change({ selectedFolderId: "/root/trip" });
    await controller.foldersUpdated(scanned("/other"));
    await controller.foldersUpdated(scanned("/root/trip/day1"));
    expect(calls.filter((call) => call.startsWith("photos"))).toEqual([]);
    state.change({ includeSubfolders: true });
    await controller.foldersUpdated(scanned("/root/trip/day1"));
    expect(calls.filter((call) => call.startsWith("photos"))).toEqual(["photos /root/trip true"]);
  });

  it("does not show a reloaded folder after the user left it", async () => {
    const { state, folderPhotos, controller } = eventsFixture();
    folderPhotos.set("/root/trip", [photo("/root/trip/a.jpg")]);
    state.change({ selectedFolderId: "/root/trip" });
    const updating = controller.foldersUpdated(scanned("/root"));
    state.change({ selectedFolderId: "/other" });
    await updating;
    expect(state.photos).toEqual([]);
  });

  it("moves to the scanned folder when the open folder no longer exists", async () => {
    const { state, calls, controller } = eventsFixture();
    state.change({ selectedFolderId: "/root/removed" });
    await controller.foldersUpdated(scanned("/root"));
    expect(calls).toEqual(["index /root true", "index /root/removed false", "select /root"]);
  });
});

describe("FolderEventsController indexed images", () => {
  afterEach(() => vi.useRealTimers());

  it("refreshes counts and the library, and the open folder once after a burst of updates", () => {
    vi.useFakeTimers();
    const { state, calls, controller } = eventsFixture();
    state.change({ selectedFolderId: "/root/trip" });
    controller.folderImagesUpdated({ rootId: "/root", folderKey: "/root/trip" });
    vi.advanceTimersByTime(60);
    controller.folderImagesUpdated({ rootId: "/root", folderKey: "/root/trip" });
    vi.advanceTimersByTime(99);
    expect(calls).toEqual(["counts", "library", "counts", "library"]);
    vi.advanceTimersByTime(1);
    expect(calls.filter((call) => call === "refreshFromIndex")).toHaveLength(1);
  });

  it("leaves the grid alone for other folders and while the whole library is shown", () => {
    vi.useFakeTimers();
    const { state, calls, controller } = eventsFixture();
    state.change({ selectedFolderId: "/root/trip" });
    controller.folderImagesUpdated({ rootId: "/root", folderKey: "/root/trip/day1" });
    controller.folderImagesUpdated({ rootId: "/other", folderKey: "/other" });
    state.change({ mode: "allPhotos", selectedFolderId: null });
    controller.folderImagesUpdated({ rootId: "/root", folderKey: "/root/trip" });
    vi.advanceTimersByTime(200);
    expect(calls).not.toContain("refreshFromIndex");

    state.change({ mode: "folders", selectedFolderId: "/root/trip", includeSubfolders: true });
    controller.folderImagesUpdated({ rootId: "/root", folderKey: "/root/trip/day1" });
    vi.advanceTimersByTime(100);
    expect(calls).toContain("refreshFromIndex");
  });

  it("stops listening, drops a pending refresh and cancels running scan tasks when disposed", async () => {
    vi.useFakeTimers();
    const { state, calls, emit, tasks, controller } = eventsFixture();
    await controller.subscribe();
    emit.rehydrated();
    emit.scanProgress({ phase: "scanning", kind: "folderTree", rootId: "/root", folderKey: "/root", jobId: 1 });
    state.change({ selectedFolderId: "/root" });
    emit.imagesUpdated({ rootId: "/root", folderKey: "/root" });
    controller.dispose();
    vi.advanceTimersByTime(200);
    expect(calls).toEqual(["rehydrated", "counts", "library", "unsubscribe", "unsubscribe", "unsubscribe", "unsubscribe"]);
    expect(taskSnapshot(tasks).recent.map((task) => task.status)).toEqual(["cancelled"]);
  });
});

describe("FolderScanTasks", () => {
  const progress = (phase: FolderScanProgress["phase"], jobId: number, kind: FolderScanProgress["kind"] = "folderImages") =>
    ({ phase, kind, rootId: "/root", folderKey: "/root/trip", jobId }) satisfies FolderScanProgress;

  it("follows a scan job from queued to done", () => {
    const tasks = new TaskTracker();
    const scans = new FolderScanTasks(tasks);
    scans.report(progress("queued", 7));
    expect(taskSnapshot(tasks).active).toMatchObject([
      { kind: "folder", label: "Index folder images", priority: "background", status: "queued", target: "/root/trip" },
    ]);
    scans.report(progress("indexing", 7));
    expect(taskSnapshot(tasks).active[0].status).toBe("running");
    scans.report(progress("done", 7));
    expect(taskSnapshot(tasks).active).toEqual([]);
    expect(taskSnapshot(tasks).recent[0].status).toBe("completed");
  });

  it("starts a task for jobs first seen while running and reports failures", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const tasks = new TaskTracker();
    const scans = new FolderScanTasks(tasks);
    scans.report(progress("done", 1));
    expect(taskSnapshot(tasks).recent).toEqual([]);
    scans.report(progress("scanning", 2, "folderTree"));
    scans.report(progress("scanning", 3, "folderCheck"));
    expect(taskSnapshot(tasks).active.map((task) => task.label)).toEqual(["Scan folder structure", "Check for folder changes"]);
    scans.report({ ...progress("error", 2), message: "disk unplugged" });
    scans.report(progress("cancelled", 3));
    expect(taskSnapshot(tasks).recent.map((task) => task.status)).toEqual(["cancelled", "failed"]);
    expect(errors).toHaveBeenCalledWith("Failed to scan /root/trip: disk unplugged");
    errors.mockRestore();
  });
});

import { TaskTracker, type TaskRecord } from "@warble/core";
import { describe, expect, it } from "vitest";
import { type Photo, type PhotoFilterMetadata, PhotoProcessingPipeline } from "../src";

interface MetadataRequest {
  photoPaths: readonly string[];
  requestId: number;
  resolve(results: PhotoFilterMetadata[]): void;
  reject(error: unknown): void;
}

function pipelineFixture() {
  const requests: MetadataRequest[] = [];
  const cancelledRequests: number[] = [];
  const warmups: { paths: readonly string[]; stopped: boolean }[] = [];
  const tasks = new TaskTracker();
  let nextId = 1;
  const pipeline = new PhotoProcessingPipeline(
    {
      getPhotoFilterMetadata: (photoPaths, requestId) =>
        new Promise<PhotoFilterMetadata[]>((resolve, reject) => {
          requests.push({ photoPaths, requestId, resolve, reject });
        }),
    },
    {
      nextRequestId: () => nextId++,
      cancelRequest: (requestId) => cancelledRequests.push(requestId),
    },
    {
      warm: (paths) => {
        const warmup = { paths, stopped: false };
        warmups.push(warmup);
        return () => {
          warmup.stopped = true;
        };
      },
    },
    tasks,
  );
  return { pipeline, requests, cancelledRequests, warmups, tasks };
}

const nextMacrotask = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("PhotoProcessingPipeline", () => {
  it("metadata warmup starts immediately, reuses known metadata, and rejects stopped results", async () => {
    const { pipeline, requests, cancelledRequests, warmups } = pipelineFixture();
    const photos: Photo[] = [
      { path: "known.jpg", filename: "known" },
      { path: "new.jpg", filename: "new" },
    ];
    pipeline.seed([{ path: "known.jpg", dateTaken: "2026-10-07" }]);
    const results: PhotoFilterMetadata[] = [];
    const start = () =>
      pipeline.start(
        photos,
        (batch) => results.push(...batch),
        () => photos.map((photo) => photo.path),
        () => {},
      );

    start();
    expect(warmups[0].paths).toEqual(["known.jpg", "new.jpg"]);
    expect(requests[0].photoPaths).toEqual(["new.jpg"]);

    pipeline.stop();
    start();
    requests[0].resolve([{ path: "new.jpg", dateTaken: "2000-01-01" }]);
    await Promise.resolve();
    expect(cancelledRequests).toEqual([requests[0].requestId]);
    expect(results).toHaveLength(0);
    expect(requests).toHaveLength(2);

    requests[1].resolve([{ path: "new.jpg", dateTaken: "2026-10-07" }]);
    await Promise.resolve();
    expect(pipeline.missingMetadataPaths(photos)).toEqual([]);
    expect(results[0].dateTaken).toBe("2026-10-07");

    start();
    expect(requests).toHaveLength(2);

    pipeline.invalidate(["new.jpg"]);
    start();
    pipeline.invalidate(["new.jpg"]);
    requests[2].resolve([{ path: "new.jpg", dateTaken: "2000-01-01" }]);
    await nextMacrotask();
    expect(requests).toHaveLength(4);
    expect(results).toHaveLength(1);

    requests[3].resolve([{ path: "new.jpg", dateTaken: "2026-10-08" }]);
    await Promise.resolve();
    expect(pipeline.enrich(photos)[1].filterInfo?.dateTaken).toBe("2026-10-08");
  });

  it("thumbnail warmup covers the first 64 current photos, videos included, and stops without cancelling other requests", () => {
    const { pipeline, cancelledRequests, warmups } = pipelineFixture();
    const currentPaths = ["clip.mov", ...Array.from({ length: 80 }, (_, index) => `${index}.jpg`)];
    const start = () => pipeline.start([], () => {}, () => currentPaths, () => {});

    start();
    expect(warmups[0].paths).toEqual(currentPaths.slice(0, 64));
    expect(warmups[0].stopped).toBe(false);

    start();
    expect(warmups[0].stopped).toBe(true);
    expect(warmups[1].stopped).toBe(false);

    pipeline.stop();
    expect(warmups[1].stopped).toBe(true);
    expect(cancelledRequests).toEqual([]);
  });

  it("reports loading and tracks the metadata read as a background task", async () => {
    const { pipeline, requests, tasks } = pipelineFixture();
    const loading: boolean[] = [];
    let active: readonly TaskRecord[] = [];
    let recent: readonly TaskRecord[] = [];
    tasks.subscribe((activeTasks, recentTasks) => {
      active = activeTasks;
      recent = recentTasks;
    });
    const photos: Photo[] = [{ path: "a.jpg", filename: "a" }];

    pipeline.start(photos, () => {}, () => [], (isLoading) => loading.push(isLoading));
    await Promise.resolve();
    expect(loading).toEqual([true]);
    expect(active).toMatchObject([
      { kind: "exif", label: "Reading photo metadata", priority: "background", total: 1 },
    ]);

    requests[0].resolve([{ path: "a.jpg", camera: "X100" }]);
    await nextMacrotask();
    expect(loading).toEqual([true, false]);
    expect(active).toEqual([]);
    expect(recent).toMatchObject([{ status: "completed", completed: 1, total: 1 }]);
  });

  it("keeps running and marks the task failed when a batch cannot be read", async () => {
    const { pipeline, requests, tasks } = pipelineFixture();
    const warn = console.warn;
    console.warn = () => {};
    let recent: readonly TaskRecord[] = [];
    tasks.subscribe((_, recentTasks) => {
      recent = recentTasks;
    });
    const photos: Photo[] = Array.from({ length: 5 }, (_, index) => ({
      path: `${index}.jpg`,
      filename: String(index),
    }));
    const results: PhotoFilterMetadata[] = [];

    pipeline.start(photos, (batch) => results.push(...batch), () => [], () => {});
    expect(requests[0].photoPaths).toHaveLength(4);
    requests[0].reject(new Error("unreadable"));
    await nextMacrotask();
    expect(requests[1].photoPaths).toEqual(["4.jpg"]);
    requests[1].resolve([{ path: "4.jpg", lens: "23mm" }]);
    await nextMacrotask();
    console.warn = warn;

    expect(results).toEqual([{ path: "4.jpg", lens: "23mm" }]);
    expect(recent).toMatchObject([{ status: "failed", completed: 5 }]);
  });
});

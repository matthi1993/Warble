import { invoke } from "@tauri-apps/api/core";
import type { Photo, PhotoFilterInfo } from "@domain/photo";
import { prefetchThumbnails } from "@services/images/thumbnail-service";
import { beginTask, cancelTaskRequest, nextRequestId } from "@services/tasks/task-manager";

const METADATA_BATCH_SIZE = 16;
const THUMBNAIL_WARM_LIMIT = 64;

interface FilterMetadataResult extends PhotoFilterInfo {
  path: string;
}

export class PhotoProcessingPipeline {
  private readonly metadata = new Map<string, PhotoFilterInfo>();
  private generation = 0;
  private metadataRequestId: number | null = null;
  private cancelThumbnailWarmup: (() => void) | null = null;
  private onLoadingChange: ((loading: boolean) => void) | null = null;
  private onMetadata: ((results: readonly FilterMetadataResult[]) => void) | null = null;
  private readonly pending = new Set<string>();
  private readonly inFlight = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  private running = false;
  private activeGeneration = 0;

  seed(results: readonly FilterMetadataResult[]): void {
    for (const { path, ...info } of results) this.metadata.set(path, info);
  }

  invalidate(paths: readonly string[]): void {
    for (const path of paths) {
      this.metadata.delete(path);
      this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
      if (this.inFlight.has(path)) this.pending.add(path);
    }
  }

  missingMetadataPaths(photos: readonly Photo[]): string[] {
    return photos.filter((photo) => !photo.filterInfo && !this.metadata.has(photo.path))
      .map((photo) => photo.path);
  }

  enrich(photos: Photo[]): Photo[] {
    return photos.map((photo) => {
      const filterInfo = this.metadata.get(photo.path) ?? photo.filterInfo;
      return filterInfo && filterInfo !== photo.filterInfo ? { ...photo, filterInfo } : photo;
    });
  }

  start(
    photos: readonly Photo[],
    onMetadata: (results: readonly FilterMetadataResult[]) => void,
    currentPhotoPaths: () => readonly string[],
    onLoadingChange: (loading: boolean) => void,
  ): void {
    this.onLoadingChange = onLoadingChange;
    this.onMetadata = onMetadata;
    this.cancelThumbnailWarmup?.();
    this.cancelThumbnailWarmup = prefetchThumbnails(currentPhotoPaths().slice(0, THUMBNAIL_WARM_LIMIT));
    this.pending.clear();
    for (const photo of photos) {
      if (!photo.filterInfo && !this.metadata.has(photo.path) &&
        (this.inFlight.get(photo.path) !== (this.revisions.get(photo.path) ?? 0) ||
          this.activeGeneration !== this.generation)) {
        this.pending.add(photo.path);
      }
    }
    if (this.running) return;
    if (this.pending.size === 0) {
      this.onLoadingChange(false);
      return;
    }
    this.running = true;
    const generation = this.generation;
    void this.run(generation);
  }

  stop(): void {
    this.generation++;
    this.pending.clear();
    if (this.metadataRequestId !== null) {
      cancelTaskRequest(this.metadataRequestId);
      this.metadataRequestId = null;
    }
    this.cancelThumbnailWarmup?.();
    this.cancelThumbnailWarmup = null;
    this.onLoadingChange?.(false);
    this.onLoadingChange = null;
    this.onMetadata = null;
  }

  private async run(generation: number): Promise<void> {
    this.activeGeneration = generation;
    this.onLoadingChange?.(true);
    const task = beginTask({
      kind: "exif",
      label: "Reading photo metadata",
      priority: "background",
      target: "Photo library",
      completed: 0,
      total: this.pending.size,
    });
    let failed = false;
    let completed = 0;
    try {
      while (this.pending.size > 0) {
        if (generation !== this.generation) return;
        const batch: string[] = [];
        for (const path of this.pending.keys()) {
          batch.push(path);
          if (batch.length === (completed === 0 ? 4 : METADATA_BATCH_SIZE)) break;
        }
        const revisions = new Map<string, number>();
        for (const path of batch) {
          this.pending.delete(path);
          const revision = this.revisions.get(path) ?? 0;
          revisions.set(path, revision);
          this.inFlight.set(path, revision);
        }
        const missing = batch.filter((path) => !this.metadata.has(path));
        const requestId = nextRequestId();
        this.metadataRequestId = requestId;
        try {
          const results = missing.length ? await invoke<FilterMetadataResult[]>("get_photo_filter_metadata", {
            photoPaths: missing,
            requestId,
          }) : [];
          if (generation !== this.generation) return;
          const current = results.filter(({ path }) => revisions.get(path) === (this.revisions.get(path) ?? 0));
          this.seed(current);
          if (current.length) this.onMetadata?.(current);
        } catch (error) {
          if (generation !== this.generation) return;
          failed = true;
          console.warn("Failed to read photo metadata batch", error);
        } finally {
          if (this.metadataRequestId === requestId) this.metadataRequestId = null;
          for (const path of batch) this.inFlight.delete(path);
        }
        completed += batch.length;
        task.update({ completed, total: completed + this.pending.size });
        if (this.pending.size > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
    } finally {
      task.finish(generation !== this.generation ? "cancelled" : failed ? "failed" : "completed");
      this.running = false;
      if (generation === this.generation) {
        this.onLoadingChange?.(false);
      } else if (this.pending.size && this.onLoadingChange) {
        this.running = true;
        void this.run(this.generation);
      }
    }
  }
}

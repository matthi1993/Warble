import { invoke } from "@tauri-apps/api/core";
import type { Photo, PhotoFilterInfo } from "@domain/photo";
import { prefetchThumbnails } from "./thumbnail-service";
import { beginTask, cancelTaskRequest, nextRequestId } from "./task-manager";

const METADATA_BATCH_SIZE = 4;
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

  enrich(photos: Photo[]): Photo[] {
    return photos.map((photo) => {
      const filterInfo = photo.filterInfo ?? this.metadata.get(photo.path);
      return filterInfo ? { ...photo, filterInfo } : photo;
    });
  }

  start(
    photos: readonly Photo[],
    onMetadata: () => void,
    currentPhotoPaths: () => readonly string[],
    onLoadingChange: (loading: boolean) => void,
  ): void {
    this.stop();
    if (photos.length === 0) return;
    this.onLoadingChange = onLoadingChange;
    const generation = this.generation;
    void this.run(photos, generation, onMetadata, currentPhotoPaths);
  }

  stop(): void {
    this.generation++;
    if (this.metadataRequestId !== null) {
      cancelTaskRequest(this.metadataRequestId);
      this.metadataRequestId = null;
    }
    this.cancelThumbnailWarmup?.();
    this.cancelThumbnailWarmup = null;
    this.onLoadingChange?.(false);
    this.onLoadingChange = null;
  }

  private async run(
    photos: readonly Photo[],
    generation: number,
    onMetadata: () => void,
    currentPhotoPaths: () => readonly string[],
  ): Promise<void> {
    const missing = photos.filter((photo) => !photo.filterInfo && !this.metadata.has(photo.path));
    if (missing.length > 0) {
      this.onLoadingChange?.(true);
      const task = beginTask({
        kind: "exif",
        label: "Reading photo metadata",
        priority: "background",
        target: `${missing.length} photos`,
        completed: 0,
        total: missing.length,
      });
      let failed = false;
      try {
        for (let start = 0; start < missing.length; start += METADATA_BATCH_SIZE) {
          if (generation !== this.generation) return;
          const batch = missing.slice(start, start + METADATA_BATCH_SIZE);
          const requestId = nextRequestId();
          this.metadataRequestId = requestId;
          try {
            const results = await invoke<FilterMetadataResult[]>("get_photo_filter_metadata", {
              photoPaths: batch.map((photo) => photo.path),
              requestId,
            });
            if (generation !== this.generation) return;
            for (const result of results) this.metadata.set(result.path, result);
            onMetadata();
          } catch (error) {
            if (generation !== this.generation) return;
            failed = true;
            console.warn("Failed to read photo metadata batch", error);
          } finally {
            if (this.metadataRequestId === requestId) this.metadataRequestId = null;
          }
          task.update({ completed: Math.min(start + batch.length, missing.length) });
          if (start + METADATA_BATCH_SIZE < missing.length) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
      } finally {
        task.finish(generation !== this.generation ? "cancelled" : failed ? "failed" : "completed");
        if (generation === this.generation) this.onLoadingChange?.(false);
      }
    }
    if (generation === this.generation) {
      this.cancelThumbnailWarmup = prefetchThumbnails(
        currentPhotoPaths().slice(0, THUMBNAIL_WARM_LIMIT),
      );
    }
  }
}
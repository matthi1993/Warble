import type { TaskTracker } from "@warble/core";
import type { Photo, PhotoFilterInfo, PhotoFilterMetadata } from "../photo/photo";
import type { BackendRequests } from "../ports/backend-requests";
import type { MetadataBackend } from "../ports/metadata-backend";
import type { ThumbnailWarmer } from "../ports/thumbnail-warmer";

const METADATA_BATCH_SIZE = 16;
// A small first batch gets the first results on screen quickly.
const FIRST_METADATA_BATCH_SIZE = 4;
const THUMBNAIL_WARM_LIMIT = 64;

type MetadataListener = (results: readonly PhotoFilterMetadata[]) => void;
type LoadingListener = (loading: boolean) => void;

export class PhotoProcessingPipeline {
  private readonly metadata = new Map<string, PhotoFilterInfo>();
  private readonly pending = new Set<string>();
  private readonly inFlight = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  private generation = 0;
  private activeGeneration = 0;
  private running = false;
  private metadataRequestId: number | null = null;
  private cancelThumbnailWarmup: (() => void) | null = null;
  private onLoadingChange: LoadingListener | null = null;
  private onMetadata: MetadataListener | null = null;

  constructor(
    private readonly backend: Pick<MetadataBackend, "getPhotoFilterMetadata">,
    private readonly requests: BackendRequests,
    private readonly thumbnails: ThumbnailWarmer,
    private readonly tasks: Pick<TaskTracker, "begin">,
  ) {}

  seed(results: readonly PhotoFilterMetadata[]): void {
    for (const { path, ...info } of results) this.metadata.set(path, info);
  }

  invalidate(paths: readonly string[]): void {
    for (const path of paths) {
      this.metadata.delete(path);
      this.revisions.set(path, this.revisionOf(path) + 1);
      if (this.inFlight.has(path)) this.pending.add(path);
    }
  }

  missingMetadataPaths(photos: readonly Photo[]): string[] {
    return photos.filter((photo) => this.lacksMetadata(photo)).map((photo) => photo.path);
  }

  enrich(photos: Photo[]): Photo[] {
    return photos.map((photo) => {
      const filterInfo = this.metadata.get(photo.path) ?? photo.filterInfo;
      return filterInfo && filterInfo !== photo.filterInfo ? { ...photo, filterInfo } : photo;
    });
  }

  start(
    photos: readonly Photo[],
    onMetadata: MetadataListener,
    currentPhotoPaths: () => readonly string[],
    onLoadingChange: LoadingListener,
  ): void {
    this.onLoadingChange = onLoadingChange;
    this.onMetadata = onMetadata;
    this.cancelThumbnailWarmup?.();
    this.cancelThumbnailWarmup = this.thumbnails.warm(
      currentPhotoPaths().slice(0, THUMBNAIL_WARM_LIMIT),
    );
    this.pending.clear();
    for (const photo of photos) {
      if (this.lacksMetadata(photo) && !this.isBeingRead(photo.path)) this.pending.add(photo.path);
    }
    if (this.running) return;
    if (this.pending.size === 0) {
      this.onLoadingChange(false);
      return;
    }
    this.running = true;
    void this.run(this.generation);
  }

  stop(): void {
    this.generation++;
    this.pending.clear();
    if (this.metadataRequestId !== null) {
      this.requests.cancelRequest(this.metadataRequestId);
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
    const task = this.tasks.begin({
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
        const batch = this.takeBatch(
          completed === 0 ? FIRST_METADATA_BATCH_SIZE : METADATA_BATCH_SIZE,
        );
        const missing = [...batch.keys()].filter((path) => !this.metadata.has(path));
        const requestId = this.requests.nextRequestId();
        this.metadataRequestId = requestId;
        try {
          const results = missing.length
            ? await this.backend.getPhotoFilterMetadata(missing, requestId)
            : [];
          if (generation !== this.generation) return;
          const current = results.filter(({ path }) => batch.get(path) === this.revisionOf(path));
          this.seed(current);
          if (current.length) this.onMetadata?.(current);
        } catch (error) {
          if (generation !== this.generation) return;
          failed = true;
          console.warn("Failed to read photo metadata batch", error);
        } finally {
          if (this.metadataRequestId === requestId) this.metadataRequestId = null;
          for (const path of batch.keys()) this.inFlight.delete(path);
        }
        completed += batch.size;
        task.update({ completed, total: completed + this.pending.size });
        if (this.pending.size > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
    } finally {
      const stopped = generation !== this.generation;
      task.finish(stopped ? "cancelled" : failed ? "failed" : "completed");
      this.running = false;
      if (!stopped) {
        this.onLoadingChange?.(false);
      } else if (this.pending.size && this.onLoadingChange) {
        this.running = true;
        void this.run(this.generation);
      }
    }
  }

  /** Moves up to `size` pending paths in flight and returns each with the revision being read. */
  private takeBatch(size: number): Map<string, number> {
    const batch = new Map<string, number>();
    for (const path of this.pending) {
      batch.set(path, this.revisionOf(path));
      if (batch.size === size) break;
    }
    for (const [path, revision] of batch) {
      this.pending.delete(path);
      this.inFlight.set(path, revision);
    }
    return batch;
  }

  private lacksMetadata(photo: Photo): boolean {
    return !photo.filterInfo && !this.metadata.has(photo.path);
  }

  private isBeingRead(path: string): boolean {
    return (
      this.inFlight.get(path) === this.revisionOf(path) &&
      this.activeGeneration === this.generation
    );
  }

  private revisionOf(path: string): number {
    return this.revisions.get(path) ?? 0;
  }
}

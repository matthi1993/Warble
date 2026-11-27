import { DatePhotoIndex, type Folder, type Photo, type PhotoFilterMetadata } from "@warble/library";
import { PhotoListController, type PhotoPipeline } from "@app/shell/photo-list-controller";
import { ShellState } from "@app/shell/shell-state";
import { SidebarSectionsController } from "@app/shell/sidebar-sections-controller";

export function photo(path: string, dateTaken?: string): Photo {
  const filename = path.split("/").pop() ?? path;
  return dateTaken ? { path, filename, filterInfo: { dateTaken } } : { path, filename };
}

export function folder(path: string, children: Folder[] = [], available = true): Folder {
  return { id: path, path, name: path.split("/").pop() ?? path, children, available };
}

export function paths(photos: readonly Photo[]): string[] {
  return photos.map((item) => item.path);
}

export class CountingHost {
  updates = 0;

  requestUpdate(): void {
    this.updates++;
  }
}

/** Resolves when the test calls `resolve`, to control the order of backend answers. */
export class Deferred<T> {
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;
  readonly promise = new Promise<T>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
}

export class FakePipeline implements PhotoPipeline {
  readonly metadata = new Map<string, PhotoFilterMetadata>();
  readonly invalidated: string[] = [];
  starts = 0;
  stops = 0;
  private reportLoading: (loading: boolean) => void = () => {};
  private reportMetadata: (results: readonly PhotoFilterMetadata[]) => void = () => {};

  seed(results: readonly PhotoFilterMetadata[]): void {
    for (const result of results) this.metadata.set(result.path, result);
  }

  invalidate(invalidPaths: readonly string[]): void {
    this.invalidated.push(...invalidPaths);
    for (const path of invalidPaths) this.metadata.delete(path);
  }

  missingMetadataPaths(photos: readonly Photo[]): string[] {
    return photos.filter((item) => !item.filterInfo && !this.metadata.has(item.path)).map((item) => item.path);
  }

  enrich(photos: Photo[]): Photo[] {
    return photos.map((item) => {
      const known = this.metadata.get(item.path);
      return known && !item.filterInfo ? { ...item, filterInfo: { dateTaken: known.dateTaken } } : item;
    });
  }

  start(
    _photos: readonly Photo[],
    onMetadata: (results: readonly PhotoFilterMetadata[]) => void,
    _currentPaths: () => readonly string[],
    onLoadingChange: (loading: boolean) => void,
  ): void {
    this.starts++;
    this.reportMetadata = onMetadata;
    this.reportLoading = onLoadingChange;
  }

  stop(): void {
    this.stops++;
  }

  /** Plays one background read: loading starts, the results arrive, loading ends. */
  deliver(results: PhotoFilterMetadata[]): void {
    this.reportLoading(true);
    this.seed(results);
    this.reportMetadata(results);
    this.reportLoading(false);
  }
}

export class FakeRatings {
  readonly stars = new Map<string, number>();

  get(path: string) {
    return { rating: this.stars.get(path) ?? 0, label: "" as const, ratedAt: 0 };
  }
}

export function createShellFixture() {
  const host = new CountingHost();
  const state = new ShellState(host);
  state.takeChanges();
  const pipeline = new FakePipeline();
  const dates = new DatePhotoIndex(pipeline);
  const ratings = new FakeRatings();
  const sections = new SidebarSectionsController(state);
  const photoList = new PhotoListController(state, pipeline, dates, ratings);
  return { host, state, pipeline, dates, ratings, sections, photoList };
}

/** Lets every promise chain that is ready to continue run to its next backend call. */
export async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve));
}

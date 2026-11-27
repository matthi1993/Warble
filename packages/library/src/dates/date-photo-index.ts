import type { Photo } from "../photo/photo";
import { sortPhotosOldestFirst } from "../photo/photo-sort";
import { matchesDateSelection } from "./date-selection";
import { DateTreeIndex, type DateTreeNode } from "./date-tree-index";

export interface PhotoEnricher {
  enrich(photos: Photo[]): Photo[];
}

/**
 * Date tree and per-date photo lists for the whole library. Both are rebuilt
 * lazily whenever a different `libraryPhotos` array instance is passed in.
 */
export class DatePhotoIndex {
  private readonly tree = new DateTreeIndex();
  private treeSource: Photo[] | null = null;
  private photosSource: Photo[] | null = null;
  private sortedPhotos: Photo[] = [];
  private readonly selections = new Map<string | null, Photo[]>();

  constructor(private readonly enricher: PhotoEnricher) {}

  photosFor(libraryPhotos: Photo[], key: string | null): Photo[] {
    if (this.photosSource !== libraryPhotos) {
      this.photosSource = libraryPhotos;
      this.sortedPhotos = sortPhotosOldestFirst(this.enricher.enrich(libraryPhotos));
      this.selections.clear();
    }
    let photos = this.selections.get(key);
    if (!photos) {
      photos =
        key === null
          ? this.sortedPhotos
          : this.sortedPhotos.filter((photo) => matchesDateSelection(photo, key));
      this.selections.set(key, photos);
    }
    return photos;
  }

  invalidatePhotos(): void {
    this.photosSource = null;
    this.selections.clear();
  }

  nodes(libraryPhotos: Photo[]): DateTreeNode[] {
    this.syncTree(libraryPhotos);
    return this.tree.getTree();
  }

  syncTree(libraryPhotos: Photo[]): void {
    if (this.treeSource === libraryPhotos) return;
    this.treeSource = libraryPhotos;
    this.tree.replacePhotos(this.enricher.enrich(libraryPhotos));
  }

  updateMetadata(
    libraryPhotos: Photo[],
    results: readonly { path: string; dateTaken?: string | null }[],
  ): void {
    this.syncTree(libraryPhotos);
    this.tree.updateMetadata(results);
  }
}

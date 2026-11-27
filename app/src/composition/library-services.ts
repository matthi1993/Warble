import type { TaskTracker } from "@warble/core";
import {
  DatePhotoIndex,
  ExifReader,
  PhotoProcessingPipeline,
  RatingStore,
  VariantStore,
  type LibraryBackend,
} from "@warble/library";
import type { MediaServices } from "./media-services";

export class LibraryServices {
  readonly ratings: RatingStore;
  readonly variants: VariantStore;
  readonly exif: ExifReader;
  readonly processing: PhotoProcessingPipeline;
  readonly dates: DatePhotoIndex;

  constructor(
    readonly backend: LibraryBackend,
    tasks: TaskTracker,
    media: MediaServices,
  ) {
    this.ratings = new RatingStore(backend);
    this.variants = new VariantStore(backend);
    this.exif = new ExifReader(backend);
    const thumbnailWarmer = { warm: (paths: readonly string[]) => media.thumbnails.prefetch(paths) };
    this.processing = new PhotoProcessingPipeline(backend, media.requests, thumbnailWarmer, tasks);
    this.dates = new DatePhotoIndex(this.processing);
  }
}

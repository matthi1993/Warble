import type { TaskTracker } from "@warble/core";
import {
  FullImageCache,
  HdImageCache,
  HdImagePreloader,
  ImageRequests,
  OrientedBitmapDecoder,
  ThumbnailService,
  VideoSources,
  WorkerImageDecoder,
  type ImageBackend,
} from "@warble/media";
import type { CacheSettings, CacheSettingsStore } from "../state/cache-settings-store";

export class MediaServices {
  readonly requests: ImageRequests;
  readonly thumbnails: ThumbnailService;
  readonly hdImages: HdImageCache;
  readonly fullImages: FullImageCache;
  readonly videos: VideoSources;
  readonly jpegDecoder = new OrientedBitmapDecoder("image/jpeg");

  constructor(
    readonly backend: ImageBackend,
    tasks: TaskTracker,
    private readonly cacheSettings: CacheSettingsStore,
  ) {
    const decoder = new WorkerImageDecoder();
    this.requests = new ImageRequests(backend);
    this.thumbnails = new ThumbnailService(backend, this.requests, tasks);
    this.hdImages = new HdImageCache(backend, this.requests, tasks, decoder);
    this.fullImages = new FullImageCache(backend, this.requests, tasks, decoder);
    this.videos = new VideoSources(backend);
  }

  createHdPreloader(): HdImagePreloader {
    return new HdImagePreloader(this.hdImages);
  }

  async start(): Promise<void> {
    this.cacheSettings.subscribe((settings) => this.applyCacheSettings(settings));
    this.applyCacheSettings(await this.cacheSettings.load());
  }

  private applyCacheSettings(settings: CacheSettings): void {
    this.hdImages.setCapacity(settings.full_image_bitmap_max_entries);
    this.fullImages.setCapacity(settings.full_image_bitmap_max_entries);
  }
}

import type { EffectLayer, ImageSource, LayerId, RenderRequest, RenderedImage } from "@warble/render";
import type { EditStateListener, EditStatePort, SavedCrop } from "@viewer/edit-state-port";
import type { ImageLoadingPort, ThumbnailRequest } from "@viewer/image-loading-port";
import type { ViewerPipeline } from "@viewer/viewer-scene";
import type { ViewerCursor, ViewerHost } from "@viewer/viewer-settings";

export function fakeBitmap(width: number, height: number): ImageBitmap & { closed: boolean } {
  const bitmap = { width, height, closed: false, close: () => void (bitmap.closed = true) };
  return bitmap as unknown as ImageBitmap & { closed: boolean };
}

export class Deferred<T> {
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;
  readonly promise = new Promise<T>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
}

export class FakeHost implements ViewerHost {
  path: string | null = null;
  presenting = false;
  frameSize = 0;
  proofingSize = 0;
  frameColor = "#fff";
  frameRadius = 0;
  sizing: ViewerHost["sizing"] = "fit";
  autoRotate = false;
  smoothingQuality: ViewerHost["smoothingQuality"] = "high";
  background = "transparent";
  cropMode = false;
  editing = false;
  enableFullRes = true;
  cropAspect: number | null = null;
  rotation = 0;
  horizonMode = false;
  previewOriginal = false;
  cursor: ViewerCursor = "";
  updates = 0;
  readonly events: CustomEvent[] = [];
  readonly style = { setProperty: () => {} };

  dispatchEvent(event: Event): boolean {
    this.events.push(event as CustomEvent);
    return !event.defaultPrevented;
  }

  requestUpdate(): void {
    this.updates++;
  }

  eventTypes(): string[] {
    return this.events.map((event) => event.type);
  }
}

export class FakePipeline implements ViewerPipeline {
  readonly requests: RenderRequest[] = [];
  readonly warmups: ImageSource[] = [];
  changes = true;
  releases = 0;
  disposed = false;

  changesImage(): boolean {
    return this.changes;
  }

  render(request: RenderRequest): RenderedImage {
    this.requests.push(request);
    return { width: request.outputWidth, height: request.outputHeight } as RenderedImage;
  }

  get lastRender(): RenderRequest {
    return this.requests[this.requests.length - 1];
  }

  warmup(source: ImageSource): void {
    this.warmups.push(source);
  }

  releaseSources(): void {
    this.releases++;
  }

  dispose(): void {
    this.disposed = true;
  }
}

export interface FullImageRequest extends Deferred<ImageBitmap> {
  readonly path: string;
  readonly signal: AbortSignal | undefined;
}

export class FakeImages implements ImageLoadingPort {
  readonly hdCache = new Map<string, ImageBitmap>();
  readonly fullCache = new Map<string, ImageBitmap>();
  readonly thumbnails = new Map<string, Deferred<ImageBitmap>>();
  readonly hdLoads = new Map<string, Deferred<ImageBitmap>>();
  readonly fullRequests: FullImageRequest[] = [];
  readonly cancelledThumbnails: string[] = [];

  loadThumbnail(path: string): ThumbnailRequest {
    const thumbnail = new Deferred<ImageBitmap>();
    this.thumbnails.set(path, thumbnail);
    return { promise: thumbnail.promise, cancel: () => this.cancelledThumbnails.push(path) };
  }

  isCancellation(error: unknown): boolean {
    return error === "cancelled";
  }

  cachedHd(path: string): ImageBitmap | null {
    return this.hdCache.get(path) ?? null;
  }

  loadHd(path: string): Promise<ImageBitmap> {
    const load = new Deferred<ImageBitmap>();
    this.hdLoads.set(path, load);
    return load.promise;
  }

  cachedFull(path: string): ImageBitmap | null {
    return this.fullCache.get(path) ?? null;
  }

  loadFull(path: string, signal?: AbortSignal): Promise<ImageBitmap> {
    const request = Object.assign(new Deferred<ImageBitmap>(), { path, signal });
    this.fullRequests.push(request);
    return request.promise;
  }
}

export class FakeEdits implements EditStatePort {
  savedCrop: SavedCrop | null = null;
  cropIsEnabled = false;
  postIsEnabled = true;
  layers: Record<LayerId, EffectLayer> = { photo: {}, post: {} };
  listener: EditStateListener | null = null;

  crop(path: string | null): SavedCrop | null {
    return path ? this.savedCrop : null;
  }

  cropEnabled(): boolean {
    return this.cropIsEnabled;
  }

  postEnabled(): boolean {
    return this.postIsEnabled;
  }

  layer(layer: LayerId): EffectLayer {
    return this.layers[layer];
  }

  subscribe(listener: EditStateListener): () => void {
    this.listener = listener;
    return () => (this.listener = null);
  }
}

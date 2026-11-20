import type { Photo } from "@warble/library";
import { VideoSources } from "@warble/media";
import type { VariantResolver } from "./variant-resolver";

export interface PhotoSequence {
  readonly photos: Photo[];
  readonly index: number;
}

export class StageModel {
  presenting = false;
  playLivePhoto = false;

  constructor(
    private readonly sequence: PhotoSequence,
    private readonly variants: VariantResolver,
  ) {}

  get photos(): Photo[] {
    return this.sequence.photos;
  }

  get index(): number {
    return this.sequence.index;
  }

  get currentPhoto(): Photo | null {
    const { photos, index } = this.sequence;
    if (index < 0 || index >= photos.length) return null;
    return photos[index] ?? null;
  }

  get displayPath(): string | null {
    const photo = this.currentPhoto;
    return photo ? this.variants.resolvedPath(photo) : null;
  }

  get liveVideoPath(): string | null {
    return this.videoFile(this.currentPhoto);
  }

  slidePath(photo: Photo): string {
    return this.videoFile(photo) ?? this.variants.resolvedPath(photo);
  }

  get activeVideoPath(): string | null {
    const photo = this.currentPhoto;
    if (this.presenting && photo) {
      const slidePath = this.slidePath(photo);
      return VideoSources.isVideo(slidePath) ? slidePath : null;
    }
    const path = this.displayPath;
    if (path && VideoSources.isVideo(path)) return path;
    return this.playLivePhoto ? this.liveVideoPath : null;
  }

  /** The displayed image file; edits, the canvas and the image caches all key on it. */
  get editTarget(): string | null {
    if (this.activeVideoPath) return null;
    return this.displayPath;
  }

  get editable(): boolean {
    return !this.activeVideoPath && this.variants.isEditable(this.currentPhoto);
  }

  private videoFile(photo: Photo | null): string | null {
    return photo?.files?.find((file) => VideoSources.isVideo(file.path))?.path ?? null;
  }
}

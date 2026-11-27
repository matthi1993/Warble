import type { Unsubscribe } from "@warble/core";
import {
  buildExifSections,
  fileForSelection,
  type ExifMetadata,
  type ExifSection,
  type Photo,
  type PhotoFormat,
} from "@warble/library";

export interface DetailPanelHost {
  readonly photo: Photo | null;
  readonly fullViewOpen: boolean;
  requestUpdate(): void;
}

export interface DetailPanelDependencies {
  readonly exif: { read(photoPath: string): Promise<ExifMetadata> };
  readonly variants: { subscribe(listener: () => void): Unsubscribe };
  readonly currentSelection: (photo: Photo) => { format: PhotoFormat; variant: string } | null;
}

/** Which file of the selected photo the panel previews, and that photo's EXIF data. */
export class DetailPanelController {
  exif: ExifMetadata | null = null;
  private exifRequest = 0;
  private unsubscribeVariants: Unsubscribe | null = null;

  constructor(
    private readonly host: DetailPanelHost,
    private readonly dependencies: DetailPanelDependencies,
  ) {}

  connect(): void {
    this.unsubscribeVariants = this.dependencies.variants.subscribe(() => this.host.requestUpdate());
  }

  disconnect(): void {
    this.unsubscribeVariants?.();
    this.unsubscribeVariants = null;
    this.exifRequest++;
  }

  photoChanged(previous: Photo | null | undefined): void {
    if (previous?.path === this.host.photo?.path) return;
    this.refreshMetadata();
  }

  refreshMetadata(): void {
    const photo = this.host.photo;
    const request = ++this.exifRequest;
    this.showExif(null);
    if (!photo) return;
    void this.dependencies.exif
      .read(photo.path)
      .then((exif) => {
        if (request === this.exifRequest) this.showExif(exif);
      })
      .catch(() => {
        if (request === this.exifRequest) this.showExif({});
      });
  }

  get exifSections(): ExifSection[] {
    return buildExifSections(this.exif);
  }

  currentPath(photo: Photo): string {
    const selection = this.dependencies.currentSelection(photo);
    if (!selection) return photo.path;
    return fileForSelection(photo, selection.format, selection.variant) ?? photo.path;
  }

  /** Whether the buttons for the full view and for window fullscreen are offered. */
  get offersWindowControls(): boolean {
    return !this.host.fullViewOpen && !this.isIPad();
  }

  private showExif(exif: ExifMetadata | null): void {
    this.exif = exif;
    this.host.requestUpdate();
  }

  private isIPad(): boolean {
    const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent ?? "";
    return /iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && (navigator.maxTouchPoints ?? 0) > 1);
  }
}

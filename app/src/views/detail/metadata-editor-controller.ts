import type {
  EditableMetadataField,
  ExifMetadata,
  MetadataBackend,
  PhotoMetadataChanges,
} from "@warble/library";

const EXIF_DATE = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

export interface MetadataEditorHost {
  readonly paths: string[];
  requestUpdate(): void;
  dispatchEvent(event: Event): boolean;
}

/** Edits the writable metadata fields of one photo, or applies the changed fields to several. */
export class MetadataEditorController {
  loading = true;
  saving = false;
  error = "";
  private original: ExifMetadata = {};
  private changes: PhotoMetadataChanges = {};

  constructor(
    private readonly host: MetadataEditorHost,
    private readonly exif: { read(photoPath: string): Promise<ExifMetadata> },
    private readonly backend: Pick<MetadataBackend, "setPhotoMetadata">,
  ) {}

  get multiple(): boolean {
    return this.host.paths.length > 1;
  }

  /** Several photos start with empty fields, because only changed fields are applied to them. */
  load(): void {
    if (this.host.paths.length !== 1) {
      this.loading = false;
      this.host.requestUpdate();
      return;
    }
    void this.exif
      .read(this.host.paths[0])
      .then((metadata) => {
        this.original = metadata;
      })
      .catch((error) => {
        this.error = String(error);
      })
      .finally(() => {
        this.loading = false;
        this.host.requestUpdate();
      });
  }

  fieldValue(key: EditableMetadataField): string {
    const changed = this.changes[key];
    if (changed !== undefined) return changed;
    if (this.multiple) return "";
    return key === "dateTaken" ? this.captureDate() : this.original[key] ?? "";
  }

  setField(key: EditableMetadataField, value: string): void {
    this.changes = { ...this.changes, [key]: value };
    this.host.requestUpdate();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopImmediatePropagation();
    this.closeUnlessSaving();
  }

  closeUnlessSaving(): void {
    if (!this.saving) this.close();
  }

  close(): void {
    this.host.dispatchEvent(new Event("close"));
  }

  async save(): Promise<void> {
    if (!Object.keys(this.changes).length) {
      this.close();
      return;
    }
    this.saving = true;
    this.error = "";
    this.host.requestUpdate();
    const changes = { ...this.changes };
    if (changes.dateTaken) changes.dateTaken = changes.dateTaken.replace("T", " ");
    try {
      await this.backend.setPhotoMetadata(this.host.paths, changes);
      this.host.dispatchEvent(
        new CustomEvent("metadata-saved", {
          detail: { paths: this.host.paths, ...changes },
          bubbles: true,
          composed: true,
        }),
      );
      this.close();
    } catch (error) {
      this.error = `Could not save metadata: ${String(error)}`;
    } finally {
      this.saving = false;
      this.host.requestUpdate();
    }
  }

  /** The stored capture date in the format of a `datetime-local` input. */
  private captureDate(): string {
    const match = EXIF_DATE.exec(this.original.dateTaken ?? "");
    if (!match) return "";
    const [, year, month, day, hours = "00", minutes = "00", seconds = "00"] = match;
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }
}

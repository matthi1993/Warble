import type { PhotoEditStore } from "@warble/editing";
import {
  availableVariants,
  fileForSelection,
  type LibraryBackend,
  type Photo,
  type PhotoFormat,
  type VariantStore,
} from "@warble/library";
import type { Dialogs } from "@app/platform/desktop";
import type { FullViewCanvas } from "./full-view-canvas";
import type { CatalogChangeKind, FullViewEvents } from "./full-view-events";
import type { MenuController } from "./menu-controller";
import type { StageModel } from "./stage-model";
import type { UpdateHost } from "./update-host";
import type { VariantResolver, VariantSelection } from "./variant-resolver";

type VariantCommands = "photoVariantExists" | "savePhotoVariant" | "trashPhotoVariant" | "trashPhotoGroup";

export interface VariantActionServices {
  readonly library: Pick<LibraryBackend, VariantCommands>;
  readonly dialogs: Pick<Dialogs, "ask" | "message">;
  readonly preferences: Pick<VariantStore, "set" | "reload">;
  readonly photoEdits: Pick<PhotoEditStore, "flush" | "flushAll" | "reload" | "hasEdits">;
  readonly resolver: VariantResolver;
}

export interface VariantActionsView extends UpdateHost {
  readonly events: Pick<FullViewEvents, "catalogChanged">;
  canvas(): Pick<FullViewCanvas, "exportJpeg"> | null;
  /** Resolves once the pending render has reached the DOM. */
  rendered(): Promise<unknown>;
}

export class VariantActionsController {
  private saving = false;
  private deletingCurrent = false;
  private deletingAll = false;

  constructor(
    private readonly view: VariantActionsView,
    private readonly stage: StageModel,
    private readonly menus: Pick<MenuController, "close">,
    private readonly services: VariantActionServices,
  ) {}

  get savingVariant(): boolean {
    return this.saving;
  }

  get deletingVariant(): boolean {
    return this.deletingCurrent;
  }

  get deletingPhoto(): boolean {
    return this.deletingAll;
  }

  get busy(): boolean {
    return this.saving || this.deletingCurrent || this.deletingAll;
  }

  hasEdits(photo: Photo, format: PhotoFormat, variant: string): boolean {
    const path = fileForSelection(photo, format, variant);
    return path != null && this.services.photoEdits.hasEdits(path);
  }

  select(variant: string): void {
    const photo = this.stage.currentPhoto;
    const selection = photo ? this.services.resolver.currentSelection(photo) : null;
    if (!photo || !selection) return;
    this.services.preferences.set(photo.path, { format: selection.format, variant });
    this.menus.close();
  }

  async save(): Promise<void> {
    if (this.busy) return;
    const photo = this.stage.currentPhoto;
    const sourcePath = this.stage.editTarget;
    const canvas = this.view.canvas();
    if (!photo || !sourcePath || !canvas || !this.services.resolver.currentSelection(photo)) return;

    this.saving = true;
    this.view.requestUpdate();
    try {
      await this.paintBusyState();
      const { variant, overwrite } = await this.chooseVariantName(sourcePath);
      await this.services.photoEdits.flush(sourcePath);
      const jpegBytes = await canvas.exportJpeg();
      await this.services.library.savePhotoVariant({ photoPath: sourcePath, variant, overwrite, jpegBytes });
      this.services.preferences.set(photo.path, { format: "jpg", variant });
      await this.catalogChanged("save", photo);
    } catch (error) {
      this.report("Failed to save photo variant", "Failed to save variant", "Save Variant", error);
    } finally {
      this.saving = false;
      this.view.requestUpdate();
    }
  }

  async deleteVariant(): Promise<void> {
    if (this.busy) return;
    const photo = this.stage.currentPhoto;
    const selection = photo ? this.services.resolver.currentSelection(photo) : null;
    const sourcePath = this.stage.editTarget;
    if (!photo || !selection || !sourcePath) return;
    const confirmed = await this.services.dialogs.ask(
      `Move the current image (${selection.format.toUpperCase()}, ${selection.variant}) to the Bin?`,
      { title: "Delete Variant", kind: "warning" },
    );
    if (!confirmed) return;

    this.deletingCurrent = true;
    this.view.requestUpdate();
    try {
      await this.paintBusyState();
      await this.services.photoEdits.flushAll();
      await this.services.library.trashPhotoVariant(sourcePath);
      await this.reloadStores();
      const fallback = this.preferredRemainingSelection(photo, selection);
      if (fallback && photo.path !== sourcePath) this.services.preferences.set(photo.path, fallback);
      const hasRemainingFiles = photo.files?.some((file) => file.path !== sourcePath) ?? false;
      await this.catalogChanged(hasRemainingFiles ? "variant-delete" : "photo-delete", photo);
    } catch (error) {
      this.report("Failed to delete photo variant", "Failed to delete variant", "Delete Variant", error);
    } finally {
      this.deletingCurrent = false;
      this.view.requestUpdate();
    }
  }

  async deletePhoto(): Promise<void> {
    if (this.busy) return;
    const photo = this.stage.currentPhoto;
    if (!photo) return;
    const confirmed = await this.services.dialogs.ask(
      `Move ${photo.filename} and all its variants to the Bin?`,
      { title: "Delete Photo", kind: "warning" },
    );
    if (!confirmed) return;

    this.deletingAll = true;
    this.menus.close();
    this.view.requestUpdate();
    try {
      await this.paintBusyState();
      await this.services.photoEdits.flushAll();
      await this.services.library.trashPhotoGroup(photo.path);
      await this.reloadStores();
      await this.catalogChanged("photo-delete", photo);
    } catch (error) {
      this.report("Failed to delete photo", "Failed to delete photo", "Delete Photo", error);
    } finally {
      this.deletingAll = false;
      this.view.requestUpdate();
    }
  }

  /** Offers "Edit", then "Edit 2", "Edit 3", …: the first free name, or an existing one the user agrees to overwrite. */
  private async chooseVariantName(sourcePath: string): Promise<{ variant: string; overwrite: boolean }> {
    let number = 1;
    let variant = "Edit";
    while (await this.services.library.photoVariantExists(sourcePath, variant)) {
      const overwrite = await this.services.dialogs.ask(
        `${variant}.jpg already exists. Overwrite it? Choose No to save as Edit ${number + 1}.`,
        { title: "Save Variant", kind: "warning" },
      );
      if (overwrite) return { variant, overwrite };
      number += 1;
      variant = `Edit ${number}`;
    }
    return { variant, overwrite: false };
  }

  /** After a deletion the newest remaining "Edit N" is shown, otherwise the first remaining JPEG. */
  private preferredRemainingSelection(photo: Photo, removed: VariantSelection): VariantSelection | null {
    const remaining = availableVariants(photo, "jpg").filter(
      (variant) => removed.format !== "jpg" || variant.key !== removed.variant,
    );
    if (remaining.length === 0) return null;
    const editNumber = (key: string) => (key.toLowerCase() === "edit" ? 1 : Number(key.slice(5)));
    const edits = remaining
      .filter((variant) => /^edit(?: \d+)?$/i.test(variant.key))
      .sort((a, b) => editNumber(b.key) - editNumber(a.key));
    return { format: "jpg", variant: edits[0]?.key ?? remaining[0].key };
  }

  private async reloadStores(): Promise<void> {
    await Promise.all([this.services.photoEdits.reload(), this.services.preferences.reload()]);
  }

  private catalogChanged(kind: CatalogChangeKind, photo: Photo): Promise<void> {
    return this.view.events.catalogChanged(kind, photo, this.stage.index);
  }

  /** The busy state has to reach the screen before rendering, encoding or file work blocks the main thread. */
  private async paintBusyState(): Promise<void> {
    await this.view.rendered();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  private report(logMessage: string, userMessage: string, title: string, error: unknown): void {
    console.error(logMessage, error);
    void this.services.dialogs.message(`${userMessage}: ${error}`, { title, kind: "error" });
  }
}

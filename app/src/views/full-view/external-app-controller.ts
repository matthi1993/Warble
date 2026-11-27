import type { LibraryBackend } from "@warble/library";
import type { Dialogs } from "@app/platform/desktop";
import type { MenuController } from "./menu-controller";
import type { StageModel } from "./stage-model";
import type { UpdateHost } from "./update-host";

export interface ExternalAppServices {
  readonly library: Pick<LibraryBackend, "openPhotoInApp" | "openRawInDefaultApp">;
  readonly dialogs: Pick<Dialogs, "message">;
}

export class ExternalAppController {
  private openingPhoto = false;
  private openingRawFile = false;

  constructor(
    private readonly host: UpdateHost,
    private readonly stage: Pick<StageModel, "editTarget">,
    private readonly menus: Pick<MenuController, "close">,
    private readonly services: ExternalAppServices,
  ) {}

  get openingIn(): boolean {
    return this.openingPhoto;
  }

  get openingRaw(): boolean {
    return this.openingRawFile;
  }

  async openDisplayedImage(): Promise<void> {
    const path = this.stage.editTarget;
    if (this.openingPhoto || !path) return;
    this.openingPhoto = true;
    this.menus.close();
    this.host.requestUpdate();
    try {
      await this.services.library.openPhotoInApp(path);
    } catch (error) {
      console.error("Failed to open photo in another app", error);
      void this.services.dialogs.message(`Failed to open photo: ${error}`, { title: "Open In", kind: "error" });
    } finally {
      this.openingPhoto = false;
      this.host.requestUpdate();
    }
  }

  async openRaw(path: string): Promise<void> {
    if (this.openingRawFile) return;
    this.openingRawFile = true;
    this.menus.close();
    this.host.requestUpdate();
    try {
      await this.services.library.openRawInDefaultApp(path);
    } catch (error) {
      console.error("Failed to open RAW photo", error);
      void this.services.dialogs.message(`Failed to open RAW photo: ${error}`, { title: "Open RAW", kind: "error" });
    } finally {
      this.openingRawFile = false;
      this.host.requestUpdate();
    }
  }
}

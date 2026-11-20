import type { LibraryMode } from "./shell-fields";
import type { LibraryPhotosController } from "./library-photos-controller";
import type { PhotoListController } from "./photo-list-controller";
import type { ShellState } from "./shell-state";
import type { SidebarSectionsController } from "./sidebar-sections-controller";

export class LibraryNavigationController {
  constructor(
    private readonly state: ShellState,
    private readonly photoList: Pick<PhotoListController, "showLibraryPhotos">,
    private readonly libraryPhotos: Pick<LibraryPhotosController, "refresh">,
    private readonly sections: SidebarSectionsController,
  ) {}

  selectAllPhotos(): void {
    this.showWholeLibrary("allPhotos");
  }

  selectFavorites(): void {
    this.showWholeLibrary("favorites");
  }

  selectDate(key: string): void {
    const state = this.state;
    if (state.mode === "days" && state.selectedDateKey === key) return;
    this.sections.expand("days");
    state.change({ pendingRestoreFolderPath: null, selectedDateKey: key });
    this.leaveCurrentView("days");
    this.photoList.showLibraryPhotos(false);
    if (!state.libraryPhotos.length && state.imports.length) void this.libraryPhotos.refresh();
  }

  private showWholeLibrary(mode: LibraryMode): void {
    this.leaveCurrentView(mode);
    this.photoList.showLibraryPhotos();
    void this.libraryPhotos.refresh();
  }

  private leaveCurrentView(mode: LibraryMode): void {
    this.state.change({
      mode,
      selectedFolderId: null,
      selectedFolderName: null,
      selectedPhoto: null,
      fullViewIndex: null,
      mobileSidebarOpen: false,
      detailOpen: false,
    });
  }
}

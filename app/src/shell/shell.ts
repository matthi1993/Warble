import type { Unsubscribe } from "@warble/core";
import type { AppContext } from "@app/composition/app-context";
import { AlbumsController } from "./albums-controller";
import { AppViewController } from "./app-view-controller";
import { BrowserEnvironment } from "./browser-environment";
import { ContextMenusController } from "./context-menus-controller";
import { FolderCountsController } from "./folder-counts-controller";
import { FolderEventsController } from "./folder-events-controller";
import { FolderScanTasks } from "./folder-scan-tasks";
import { FolderSelectionController } from "./folder-selection-controller";
import { FoldersController } from "./folders-controller";
import { LibraryNavigationController } from "./library-navigation-controller";
import { LibraryPhotosController } from "./library-photos-controller";
import { LibraryViewModel } from "./library-view-model";
import { PanelsController } from "./panels-controller";
import { PhotoChangesController } from "./photo-changes-controller";
import { PhotoDataSync } from "./photo-data-sync";
import { PhotoDragController } from "./photo-drag-controller";
import { PhotoIndexController } from "./photo-index-controller";
import { PhotoListController } from "./photo-list-controller";
import { PhotoViewController } from "./photo-view-controller";
import { ShellState, type ShellChanges, type UpdateHost } from "./shell-state";
import type { ShellViews } from "./shell-views";
import { ShortcutsController } from "./shortcuts-controller";
import { SidebarSectionsController } from "./sidebar-sections-controller";
import { ThumbnailCacheController } from "./thumbnail-cache-controller";
import { WindowController } from "./window-controller";

export type ShellServices = Pick<AppContext, "platform" | "library" | "editing" | "media" | "tasks" | "busy">;

export class Shell {
  readonly environment = new BrowserEnvironment();
  readonly state: ShellState;
  readonly viewModel: LibraryViewModel;
  readonly sections: SidebarSectionsController;
  readonly panels: PanelsController;
  readonly photoList: PhotoListController;
  readonly photoView: PhotoViewController;
  readonly albums: AlbumsController;
  readonly libraryPhotos: LibraryPhotosController;
  readonly navigation: LibraryNavigationController;
  readonly folderSelection: FolderSelectionController;
  readonly folders: FoldersController;
  readonly photoChanges: PhotoChangesController;
  readonly menus: ContextMenusController;
  readonly drag: PhotoDragController;
  readonly windowControl: WindowController;
  readonly shortcuts: ShortcutsController;
  private readonly counts: FolderCountsController;
  private readonly folderEvents: FolderEventsController;
  private readonly photoIndex: PhotoIndexController;
  private readonly thumbnailCache: ThumbnailCacheController;
  private readonly appView: AppViewController;
  private stopRatingUpdates: Unsubscribe | null = null;

  constructor(views: ShellViews, host: UpdateHost, private readonly services: ShellServices) {
    const { platform, library, editing, media, tasks, busy } = services;
    const backend = platform.library;
    const { processing: pipeline, dates, ratings } = library;
    const environment = this.environment;
    const state = (this.state = new ShellState(host));
    const photoData = new PhotoDataSync(editing.photoEdits, ratings, library.variants);

    this.viewModel = new LibraryViewModel(state, dates, ratings);
    this.sections = new SidebarSectionsController(state);
    this.panels = new PanelsController(state, environment);
    this.photoList = new PhotoListController(state, pipeline, dates, ratings);
    this.photoView = new PhotoViewController(state);
    this.albums = new AlbumsController(state, backend, platform.dialogs, this.photoList, this.sections);
    this.libraryPhotos = new LibraryPhotosController(state, backend, pipeline, dates, this.photoList, this.albums);
    this.navigation = new LibraryNavigationController(state, this.photoList, this.libraryPhotos, this.sections);
    this.folderSelection = new FolderSelectionController(state, backend, this.photoList, this.sections);
    this.counts = new FolderCountsController(state, backend, this.folderSelection);
    this.folders = new FoldersController(
      state,
      backend,
      platform.dialogs,
      busy,
      environment,
      photoData,
      this.folderSelection,
    );
    this.folderEvents = new FolderEventsController(
      state,
      backend,
      new FolderScanTasks(tasks),
      this.folders,
      this.folderSelection,
      this.photoList,
      this.counts,
      this.libraryPhotos,
    );
    this.photoIndex = new PhotoIndexController(
      state,
      backend,
      media,
      pipeline,
      dates,
      views,
      photoData,
      this.counts,
      this.libraryPhotos,
      this.folderSelection,
    );
    this.thumbnailCache = new ThumbnailCacheController(platform.images, media.thumbnails, views);
    this.photoChanges = new PhotoChangesController(
      state,
      backend,
      pipeline,
      this.photoList,
      this.counts,
      this.albums,
      this.libraryPhotos,
      views,
    );
    this.appView = new AppViewController(state, platform.settings, this.folderSelection);
    this.menus = new ContextMenusController(state, backend, views);
    this.drag = new PhotoDragController(state, environment, views, this.albums);
    this.windowControl = new WindowController(state, platform.window, environment, this.sections, views);
    this.shortcuts = new ShortcutsController(
      state,
      views,
      environment,
      ratings,
      this.albums,
      this.menus,
      this.photoView,
      this.windowControl,
    );
  }

  async start(): Promise<void> {
    const { ratings, variants } = this.services.library;
    void this.albums.load();
    this.stopRatingUpdates = ratings.subscribe((path) => this.photoList.ratingChanged(path));
    await this.folderEvents.subscribe();
    await this.photoIndex.subscribe();
    this.thumbnailCache.subscribe();
    await this.folders.loadImported();
    void variants.load();
    void ratings.load();
    await this.folderSelection.restoreLast();
    await this.appView.restore();
  }

  stop(): void {
    this.folderEvents.dispose();
    this.photoIndex.dispose();
    this.thumbnailCache.dispose();
    this.stopRatingUpdates?.();
    this.stopRatingUpdates = null;
    this.photoList.stopBackgroundWork();
  }

  afterUpdate(changes: ShellChanges): void {
    if (changes.has("imports")) {
      void this.counts.refresh();
      this.counts.indexNewRoots();
      void this.libraryPhotos.refresh();
    }
    const previousFullViewIndex = changes.get("fullViewIndex");
    const fullViewWasOpen = previousFullViewIndex !== undefined && previousFullViewIndex !== null;
    if (fullViewWasOpen && this.state.fullViewIndex === null) this.photoList.startBackgroundWork();
    this.appView.persistChanges(changes);
  }
}

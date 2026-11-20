import type { Unsubscribe } from "@warble/core";
import type { AppContext } from "@app/composition/app-context";
import { ControlsVisibilityController } from "./controls-visibility-controller";
import { EditingSessionController } from "./editing-session-controller";
import { ExifLoadController } from "./exif-load-controller";
import { ExternalAppController } from "./external-app-controller";
import type { CanvasAccessor } from "./full-view-canvas";
import type { FullViewEvents } from "./full-view-events";
import type { ChangedProperties, FullViewHost, FullViewParts } from "./full-view-parts";
import { HdPreloadController } from "./hd-preload-controller";
import { KeyboardShortcutsController } from "./keyboard-shortcuts-controller";
import { MenuController } from "./menu-controller";
import { OriginalPreviewController } from "./original-preview-controller";
import { PhotoNavigationController } from "./photo-navigation-controller";
import { SidePanelController } from "./side-panel-controller";
import { SlideshowController } from "./slideshow-controller";
import { StageModel } from "./stage-model";
import { VariantActionsController } from "./variant-actions-controller";
import { VariantResolver } from "./variant-resolver";
import { ViewStateController } from "./view-state-controller";

export class FullViewController {
  readonly host: FullViewHost;
  readonly events: FullViewEvents;
  readonly resolver: VariantResolver;
  readonly stage: StageModel;
  readonly menus: MenuController;
  readonly controls: ControlsVisibilityController;
  readonly viewState: ViewStateController;
  readonly panel: SidePanelController;
  readonly editing: EditingSessionController;
  readonly compare: OriginalPreviewController;
  readonly slideshow: SlideshowController;
  readonly navigation: PhotoNavigationController;
  readonly variants: VariantActionsController;
  readonly externalApps: ExternalAppController;
  readonly keyboard: KeyboardShortcutsController;
  readonly exif: ExifLoadController;
  readonly canvas: CanvasAccessor;
  private readonly hdPreload: HdPreloadController;
  private subscriptions: Unsubscribe[] = [];
  private shownPhotoPath: string | undefined;
  private photoShownBefore = false;

  constructor(
    private readonly parts: FullViewParts,
    private readonly app: AppContext,
  ) {
    const { host, events, overlay, clipboard, canvas } = parts;
    const { editing, recipes, tools, library, media, platform } = app;
    const requestUpdate = () => host.requestUpdate();
    this.host = host;
    this.events = events;
    this.canvas = canvas;
    this.resolver = new VariantResolver(library.variants);
    this.stage = new StageModel(host, this.resolver);
    this.menus = new MenuController(host);
    this.controls = new ControlsVisibilityController(host, this.menus, events);
    this.viewState = new ViewStateController(host, app.viewState, this.menus, canvas);
    this.panel = new SidePanelController(host, this.stage);
    this.editing = new EditingSessionController(
      { requestUpdate, canvas, revealEditPanel: () => this.panel.openTab("edit") },
      this.stage,
      { editing, tools, clipboard },
    );
    this.compare = new OriginalPreviewController(host, this.stage, recipes);
    this.slideshow = new SlideshowController(
      { requestUpdate, overlay, events, imageReady: () => !!canvas()?.imageReady },
      this.stage,
      this.controls,
      { settings: app.slideshow, hdImages: media.hdImages },
    );
    this.navigation = new PhotoNavigationController(this.stage, this.slideshow, events);
    this.variants = new VariantActionsController(
      { requestUpdate, rendered: () => host.updateComplete, events, canvas },
      this.stage,
      this.menus,
      {
        library: platform.library,
        dialogs: platform.dialogs,
        preferences: library.variants,
        photoEdits: editing.photoEdits,
        resolver: this.resolver,
      },
    );
    this.externalApps = new ExternalAppController(host, this.stage, this.menus, {
      library: platform.library,
      dialogs: platform.dialogs,
    });
    this.keyboard = new KeyboardShortcutsController({
      stage: this.stage,
      editing: this.editing,
      navigation: this.navigation,
      panel: this.panel,
      variants: this.variants,
      ratings: library.ratings,
    });
    this.exif = new ExifLoadController(host, { exif: library.exif, requests: media.requests, tasks: app.tasks });
    this.hdPreload = new HdPreloadController(this.stage, this.resolver, media.createHdPreloader(), canvas);
  }

  get fullResolutionEnabled(): boolean {
    return this.app.cacheSettings.value.full_resolution_enabled;
  }

  /** Only JPEG selections can be edited, and only while the Edit or Post tab is open. */
  get canvasEditing(): boolean {
    return this.stage.editable && this.panel.showsEditingTab;
  }

  connect(): void {
    this.subscriptions = [
      this.app.library.variants.subscribe(() => {
        this.hdPreload.variantsChanged();
        this.host.requestUpdate();
      }),
      this.app.cacheSettings.subscribe(() => this.host.requestUpdate()),
    ];
    this.editing.connect();
    void this.viewState.hydrate();
  }

  disconnect(): void {
    this.hdPreload.stop();
    this.slideshow.stop();
    this.exif.syncToPath(null);
    void this.editing.flushTarget();
    this.editing.disconnect();
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
  }

  /** Runs before every render, also when none of these properties changed. */
  propertiesChanged(changed: ChangedProperties): void {
    if (changed.immersive) this.immersiveChanged();
    if (changed.photos || changed.index) this.photoChanged(changed);
    this.editing.syncFromStore();
    this.exif.syncToPath(this.stage.editTarget);
  }

  rendered(): void {
    this.hdPreload.syncIfInputsChanged();
  }

  toggleLivePhoto(): void {
    this.stage.playLivePhoto = !this.stage.playLivePhoto;
    if (this.stage.playLivePhoto) {
      this.editing.deactivateActiveTool();
      this.panel.closeEditingTabs();
    }
    this.host.requestUpdate();
  }

  toggleVideoPlayback(): boolean {
    if (!this.stage.activeVideoPath) return false;
    return this.parts.videoView()?.togglePlayback() ?? false;
  }

  refreshPhotoSource(path: string): void {
    if (this.stage.currentPhoto?.path === path) this.canvas()?.reloadSource();
  }

  stageActivated(): void {
    if (this.slideshow.interrupt() || !this.host.immersive) return;
    this.controls.toggle();
  }

  stageDoubleActivated(event: Pick<Event, "preventDefault">): void {
    if (this.slideshow.interrupt()) return;
    event.preventDefault();
    this.events.toggleImmersiveView();
  }

  imageReady(path: string): void {
    if (path === this.stage.editTarget) this.hdPreload.sync();
    this.slideshow.imageReady(path);
  }

  private immersiveChanged(): void {
    if (this.host.immersive) {
      this.controls.hide();
    } else {
      this.slideshow.stop();
      this.controls.show();
    }
    requestAnimationFrame(() => this.canvas()?.resetView());
  }

  private photoChanged(changed: ChangedProperties): void {
    const path = this.stage.currentPhoto?.path;
    const differentPhoto = this.photoShownBefore && path !== this.shownPhotoPath;
    this.shownPhotoPath = path;
    this.photoShownBefore = true;
    this.slideshow.photosChanged(changed.photos, changed.index);
    void this.editing.flushTarget();
    this.editing.deactivateActiveTool();
    this.compare.show(false);
    this.stage.playLivePhoto = false;
    if (differentPhoto && !this.stage.editable) this.panel.closeEditingTabs();
  }
}

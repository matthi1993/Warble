import { RATING_LABEL_KEYS, type RatingStore } from "@warble/library";
import type { AlbumsController } from "./albums-controller";
import type { BrowserEnvironment } from "./browser-environment";
import type { ContextMenusController } from "./context-menus-controller";
import type { PhotoViewController } from "./photo-view-controller";
import type { ShellState } from "./shell-state";
import type { ShellViews } from "./shell-views";
import type { WindowController } from "./window-controller";

/**
 * App-wide keyboard shortcuts. The full view handles its own keys in the capture phase;
 * this runs afterwards in the bubble phase.
 */
export class ShortcutsController {
  constructor(
    private readonly state: ShellState,
    private readonly views: Pick<ShellViews, "updateComplete" | "grid" | "fullView" | "detailPanel">,
    private readonly environment: Pick<BrowserEnvironment, "isIPad">,
    private readonly ratings: Pick<RatingStore, "applyShortcut">,
    private readonly albums: Pick<AlbumsController, "closeDialog">,
    private readonly menus: Pick<ContextMenusController, "closePhotoMenu" | "closeFolderMenu" | "closeAlbumMenu">,
    private readonly photoView: PhotoViewController,
    private readonly windowControl: Pick<WindowController, "toggleFullscreen" | "setFullscreen" | "startSlideshow">,
  ) {}

  handle(event: KeyboardEvent): void {
    const state = this.state;
    if (state.metadataPaths.length) return;
    if (state.albumDialog) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.albums.closeDialog();
      }
      return;
    }
    // Events crossing shadow roots are retargeted to the host, so the original node decides.
    if (this.isTextEntry(event.composedPath()[0])) return;
    const modified = event.metaKey || event.ctrlKey || event.altKey;
    const key = event.key.toLowerCase();
    if (event.code === "Space" && !event.repeat && !modified && !event.shiftKey) this.toggleVideoPlayback(event);
    else if (key === "p" && !event.repeat && !modified) this.togglePresentation(event);
    else if (key === "f") this.toggleFullscreen(event);
    else if (event.key === "Escape") this.leaveInnermostLayer(event);
    else if (key === "g") this.toggleFullView(event);
    else if (state.fullViewIndex === null) this.handleGridKey(event);
  }

  private isTextEntry(target: EventTarget | undefined): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  private toggleVideoPlayback(event: KeyboardEvent): void {
    const viewer = this.views.fullView();
    if (viewer?.toggleVideoPlayback()) {
      event.preventDefault();
      return;
    }
    if (viewer || !this.state.detailOpen) return;
    if (this.views.detailPanel()?.toggleVideoPlayback()) event.preventDefault();
  }

  private togglePresentation(event: KeyboardEvent): void {
    const state = this.state;
    const viewer = this.views.fullView();
    if (viewer?.presentationActive) {
      event.preventDefault();
      viewer.stopPresentation();
      return;
    }
    if (!state.photos.length) return;
    event.preventDefault();
    if (state.fullViewIndex !== null) {
      void this.windowControl.startSlideshow();
      return;
    }
    this.photoView.openForPresentation();
    void this.views.updateComplete.then(() => this.windowControl.startSlideshow());
  }

  private toggleFullscreen(event: KeyboardEvent): void {
    if (this.environment.isIPad) return;
    event.preventDefault();
    void this.windowControl.toggleFullscreen();
  }

  private leaveInnermostLayer(event: KeyboardEvent): void {
    const state = this.state;
    const viewer = this.views.fullView();
    if (viewer?.presentationActive) {
      event.preventDefault();
      viewer.stopPresentation();
    } else if (state.photoMenu) {
      this.consume(event, () => this.menus.closePhotoMenu());
    } else if (state.folderMenu) {
      this.consume(event, () => this.menus.closeFolderMenu());
    } else if (state.albumMenu) {
      event.preventDefault();
      this.menus.closeAlbumMenu();
    } else if (state.immersiveView) {
      this.consume(event, () => state.change({ immersiveView: false }));
    } else if (state.windowFullscreen) {
      this.consume(event, () => void this.windowControl.setFullscreen(false));
    } else if (state.fullViewIndex !== null) {
      this.consume(event, () => this.photoView.closeFullView());
    }
  }

  private consume(event: KeyboardEvent, action: () => void): void {
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  private toggleFullView(event: KeyboardEvent): void {
    if (this.state.fullViewIndex !== null) {
      event.preventDefault();
      this.photoView.closeFullView();
    } else if (this.state.photos.length) {
      event.preventDefault();
      this.photoView.openSelected();
    }
  }

  private handleGridKey(event: KeyboardEvent): void {
    const state = this.state;
    const grid = this.views.grid();
    const commandKey = event.metaKey || event.ctrlKey;
    if (commandKey && !event.altKey && event.key.toLowerCase() === "a") {
      if (!grid) return;
      event.preventDefault();
      grid.selectAll();
    } else if (!commandKey && !event.altKey && RATING_LABEL_KEYS.has(event.key)) {
      const target = state.selectedPhoto ?? (state.photos.length > 0 ? state.photos[0] : null);
      if (!target) return;
      event.preventDefault();
      const paths = grid?.getSelectionPaths() ?? [];
      this.ratings.applyShortcut(paths.length ? paths : [target.path], event.key);
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (grid?.moveSelection(dx, dy)) event.preventDefault();
    } else if (event.key === "Enter" && grid && state.selectedPhoto) {
      event.preventDefault();
      grid.openSelected();
    }
  }
}

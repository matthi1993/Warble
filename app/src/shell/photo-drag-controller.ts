import type { AlbumsController } from "./albums-controller";
import type { BrowserEnvironment } from "./browser-environment";
import type { ShellState } from "./shell-state";
import type { ShellViews } from "./shell-views";

export interface PhotoDragStart {
  paths: string[];
  pointerId: number;
  x: number;
  y: number;
}

export class PhotoDragController {
  private drag: { pointerId: number; paths: string[] } | null = null;
  private openedSidebar = false;

  constructor(
    private readonly state: ShellState,
    private readonly environment: Pick<BrowserEnvironment, "isNarrowScreen">,
    private readonly views: Pick<ShellViews, "updateComplete" | "albumDropTarget" | "moveDragPreview">,
    private readonly albums: Pick<AlbumsController, "addPhotos">,
  ) {}

  start({ paths, pointerId, x, y }: PhotoDragStart): void {
    const state = this.state;
    this.drag = { paths, pointerId };
    state.change({
      photoDragLabel: paths.length === 1 ? paths[0].split("/").pop() ?? "Photo" : `${paths.length} photos`,
      albumDropMode: true,
      sidebarCollapsed: false,
    });
    this.openedSidebar = this.environment.isNarrowScreen && !state.mobileSidebarOpen;
    if (this.openedSidebar) state.change({ mobileSidebarOpen: true });
    void this.views.updateComplete.then(() => this.position(x, y));
  }

  /** Returns whether the pointer belongs to the running drag. */
  move(pointerId: number, x: number, y: number): boolean {
    if (pointerId !== this.drag?.pointerId) return false;
    this.position(x, y);
    return true;
  }

  end(pointerId: number, x: number, y: number): void {
    const drag = this.drag;
    if (!drag || pointerId !== drag.pointerId) return;
    const album = this.views.albumDropTarget()?.albumAt(x, y);
    this.clear();
    if (album) void this.albums.addPhotos(album, drag.paths);
  }

  cancel(pointerId: number): void {
    if (pointerId === this.drag?.pointerId) this.clear();
  }

  private position(x: number, y: number): void {
    this.views.moveDragPreview(x, y);
    const target = this.views.albumDropTarget();
    target?.highlightAlbum(target.albumAt(x, y));
  }

  private clear(): void {
    this.views.albumDropTarget()?.highlightAlbum(null);
    this.drag = null;
    this.state.change({ photoDragLabel: null, albumDropMode: false });
    if (this.openedSidebar) this.state.change({ mobileSidebarOpen: false });
    this.openedSidebar = false;
  }
}

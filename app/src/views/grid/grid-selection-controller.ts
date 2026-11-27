import type { Photo } from "@warble/library";

export interface GridSelectionHost {
  readonly photos: Photo[];
  readonly selectedPath: string | null;
  requestUpdate(): void;
  dispatchEvent(event: Event): boolean;
}

export interface SelectablePhotos {
  readonly filtered: Photo[];
  readonly ordered: Photo[];
  readonly expandedPhotos: Photo[];
  ensurePhotoIsRendered(path: string): void;
}

export interface SelectionLayout {
  columnCount(): number;
  scrollToPhotoSoon(path: () => string | null): void;
}

export interface CardSelection {
  path: string;
  shiftKey?: boolean;
  toggle?: boolean;
  touch?: boolean;
}

export interface CardDragStart {
  path: string;
  pointerId: number;
  x: number;
  y: number;
}

/** Which photos are selected next to the primary one the host shows in the detail panel. */
export class GridSelectionController {
  private selectedPaths: ReadonlySet<string> = new Set();
  private selectionAnchor: string | null = null;
  private touchSelectionMode = false;
  private selectionFromClick = false;
  private publishedSelection: string[] = [];
  private publishedPhotos: Photo[] | null = null;
  private publishedSelectedPaths: ReadonlySet<string> | null = null;

  constructor(
    private readonly host: GridSelectionHost,
    private readonly photos: SelectablePhotos,
    private readonly layout: SelectionLayout,
  ) {}

  isSelected(path: string): boolean {
    return this.selectedPaths.has(path);
  }

  getSelectionPaths(): string[] {
    return this.photos.ordered.filter((photo) => this.isSelected(photo.path)).map((photo) => photo.path);
  }

  selectAll(): void {
    const photos = this.photos.ordered;
    if (!photos.length) return;
    this.selectedPaths = new Set(photos.map((photo) => photo.path));
    this.selectionAnchor = this.host.selectedPath ?? photos[0].path;
    this.host.requestUpdate();
    if (!this.host.selectedPath) this.selectPrimary(photos[0]);
  }

  selectCard(card: CardSelection): void {
    const photos = this.photos.ordered;
    const index = photos.findIndex((photo) => photo.path === card.path);
    if (index < 0) return;
    if (card.shiftKey && this.selectionAnchor) {
      this.selectRange(photos, index, card.path);
    } else if (card.toggle || (card.touch && this.touchSelectionMode)) {
      this.toggle(card.path);
    } else {
      this.selectOnly(card.path);
    }
    const primary = this.isSelected(card.path)
      ? photos[index]
      : photos.find((photo) => this.isSelected(photo.path)) ?? null;
    if (this.selectedPaths.size === 0) this.touchSelectionMode = false;
    this.selectionFromClick = this.host.selectedPath !== primary?.path;
    this.host.requestUpdate();
    this.selectPrimary(primary);
  }

  selectForContextMenu(card: { path: string; longPress?: boolean }): void {
    if (card.longPress) this.touchSelectionMode = true;
    if (this.isSelected(card.path)) return;
    const photo = this.host.photos.find((item) => item.path === card.path);
    if (!photo) return;
    this.selectOnly(photo.path);
    this.selectionFromClick = this.host.selectedPath !== photo.path;
    this.host.requestUpdate();
    this.selectPrimary(photo);
  }

  /** Dragging a selected card drags the whole selection; any other card is dragged alone. */
  startPointerDrag(drag: CardDragStart): void {
    const paths = this.isSelected(drag.path) ? this.getSelectionPaths() : [drag.path];
    this.dispatch("photo-grid-pointer-drag-start", {
      paths,
      pointerId: drag.pointerId,
      x: drag.x,
      y: drag.y,
    });
  }

  moveSelection(dx: number, dy: number): boolean {
    const visible = this.photos.expandedPhotos;
    const columns = this.layout.columnCount();
    if (visible.length === 0 || columns === 0) return false;
    const current = visible.findIndex((photo) => photo.path === this.host.selectedPath);
    const target = current < 0 ? 0 : current + dx + dy * columns;
    const next = visible[Math.min(visible.length - 1, Math.max(0, target))];
    this.selectOnly(next.path);
    this.host.requestUpdate();
    this.selectPrimary(next);
    this.photos.ensurePhotoIsRendered(next.path);
    this.layout.scrollToPhotoSoon(() => next.path);
    return true;
  }

  openSelected(): void {
    const visible = this.photos.expandedPhotos;
    const photo = visible.find((item) => item.path === this.host.selectedPath) ?? visible[0];
    if (!photo) return;
    this.dispatch("photo-open", { path: photo.path, filename: photo.filename });
  }

  /** A different set of photos keeps only the primary photo selected. */
  resetToPrimary(): void {
    const primary = this.host.selectedPath;
    this.touchSelectionMode = false;
    this.selectedPaths = new Set(primary ? [primary] : []);
    this.selectionAnchor = primary;
    this.host.requestUpdate();
  }

  followPrimary(): void {
    const primary = this.host.selectedPath;
    if (!primary || this.isSelected(primary)) return;
    this.selectOnly(primary);
    this.host.requestUpdate();
  }

  // A clicked card is already on screen; scrolling it would move it away under a double-click.
  revealPrimaryUnlessClicked(): void {
    if (!this.selectionFromClick) this.layout.scrollToPhotoSoon(() => this.host.selectedPath);
    this.selectionFromClick = false;
  }

  publishSelection(): void {
    const filtered = this.photos.filtered;
    if (filtered === this.publishedPhotos && this.selectedPaths === this.publishedSelectedPaths) return;
    this.publishedPhotos = filtered;
    this.publishedSelectedPaths = this.selectedPaths;
    const paths = this.getSelectionPaths();
    const unchanged =
      paths.length === this.publishedSelection.length &&
      paths.every((path, index) => path === this.publishedSelection[index]);
    if (unchanged) return;
    this.publishedSelection = paths;
    this.dispatch("photo-selection-change", { paths });
  }

  private selectOnly(path: string): void {
    this.selectedPaths = new Set([path]);
    this.selectionAnchor = path;
  }

  private selectRange(photos: Photo[], index: number, path: string): void {
    const anchor = photos.findIndex((photo) => photo.path === this.selectionAnchor);
    if (anchor < 0) {
      this.selectOnly(path);
      return;
    }
    const range = photos.slice(Math.min(anchor, index), Math.max(anchor, index) + 1);
    this.selectedPaths = new Set(range.map((photo) => photo.path));
  }

  private toggle(path: string): void {
    const next = new Set(this.selectedPaths);
    if (!next.delete(path)) next.add(path);
    this.selectedPaths = next;
    this.selectionAnchor = path;
  }

  private selectPrimary(photo: Photo | null): void {
    this.dispatch("photo-selected", { path: photo?.path ?? null, filename: photo?.filename ?? "" });
  }

  private dispatch(type: string, detail: unknown): void {
    this.host.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

export interface GridView {
  selectAll(): void;
  getSelectionPaths(): string[];
  moveSelection(dx: number, dy: number): boolean;
  openSelected(): void;
}

export interface FullViewView {
  readonly presentationActive: boolean;
  toggleVideoPlayback(): boolean;
  startPresentation(): void;
  stopPresentation(): void;
  refreshPhotoSource(path: string): void;
}

export interface DetailPanelView {
  toggleVideoPlayback(): boolean;
  refreshMetadata(): void;
}

export interface AlbumDropTarget {
  albumAt(x: number, y: number): string | null;
  highlightAlbum(id: string | null): void;
}

export interface ShellViews {
  readonly updateComplete: Promise<boolean>;
  grid(): GridView | null;
  fullView(): FullViewView | null;
  detailPanel(): DetailPanelView | null;
  albumDropTarget(): AlbumDropTarget | null;
  /** Without paths every visible thumbnail reloads. */
  reloadThumbnails(paths?: ReadonlySet<string>): void;
  moveDragPreview(x: number, y: number): void;
  takeKeyboardFocus(): void;
}

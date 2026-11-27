import type { ShellState } from "./shell-state";

export class PhotoViewController {
  constructor(private readonly state: ShellState) {}

  select(path: string | null): void {
    this.state.change({ selectedPhoto: this.state.photos.find((photo) => photo.path === path) ?? null });
  }

  setGridSelection(paths: string[]): void {
    this.state.change({ gridSelectionPaths: paths });
  }

  open(path: string): void {
    const index = this.state.photos.findIndex((photo) => photo.path === path);
    if (index >= 0) this.showInFullView(index);
  }

  openSelected(): void {
    const state = this.state;
    const selected = state.selectedPhoto;
    const index = selected ? state.photos.findIndex((photo) => photo.path === selected.path) : 0;
    if (index >= 0 && index < state.photos.length) this.showInFullView(index);
  }

  openForPresentation(): void {
    const state = this.state;
    const selectedIndex = state.photos.findIndex((photo) => photo.path === state.selectedPhoto?.path);
    const index = selectedIndex >= 0 ? selectedIndex : 0;
    state.change({ selectedPhoto: state.photos[index], fullViewIndex: index });
  }

  navigate(index: number): void {
    const state = this.state;
    if (index < 0 || index >= state.photos.length) return;
    state.change({ fullViewIndex: index, selectedPhoto: state.photos[index] });
  }

  closeFullView(): void {
    this.state.change({ fullViewIndex: null, immersiveView: false });
  }

  setEditPanelOpen(open: boolean): void {
    this.state.change({ editPanelOpen: open });
  }

  private showInFullView(index: number): void {
    this.state.change({
      detailOpen: false,
      immersiveView: false,
      selectedPhoto: this.state.photos[index],
      fullViewIndex: index,
    });
  }
}

import type { Album, AlbumBackend } from "@warble/library";
import type { Dialogs } from "@app/platform/desktop";
import type { PhotoListController } from "./photo-list-controller";
import type { ShellState } from "./shell-state";
import type { SidebarSectionsController } from "./sidebar-sections-controller";

export class AlbumsController {
  private photoRequest = 0;

  constructor(
    private readonly state: ShellState,
    private readonly backend: AlbumBackend,
    private readonly dialogs: Pick<Dialogs, "confirm" | "message">,
    private readonly photoList: PhotoListController,
    private readonly sections: SidebarSectionsController,
  ) {}

  async load(): Promise<void> {
    try {
      this.state.change({ albums: await this.backend.listAlbums() });
    } catch (error) {
      console.error("Failed to load albums", error);
    }
  }

  select(id: string): void {
    this.sections.expand("albums");
    this.state.change({ mode: "albums", selectedFolderId: null, selectedFolderName: null, selectedAlbumId: id });
    this.photoList.setPhotos([], false);
    this.state.change({ selectedPhoto: null, fullViewIndex: null, detailOpen: false, mobileSidebarOpen: false });
    void this.refreshPhotos();
  }

  async refreshPhotos(): Promise<void> {
    const state = this.state;
    const id = state.selectedAlbumId;
    if (!id || state.mode !== "albums") return;
    const request = ++this.photoRequest;
    try {
      const photos = await this.backend.getAlbumPhotos(id);
      if (request !== this.photoRequest || state.mode !== "albums" || state.selectedAlbumId !== id) return;
      this.photoList.setPhotos(photos);
      if (!state.selectedPhoto) return;
      const selectedPath = state.selectedPhoto.path;
      state.change({ selectedPhoto: state.photos.find((photo) => photo.path === selectedPath) ?? null });
    } catch (error) {
      console.error("Failed to load album photos", error);
    }
  }

  openDialog(album: Album | "new"): void {
    this.state.change({ albumMenu: null, albumError: "", albumDialog: album });
  }

  closeDialog(): void {
    this.state.change({ albumDialog: null });
  }

  async save(rawName: string, rawDescription: string): Promise<void> {
    const name = rawName.trim();
    const description = rawDescription.trim();
    if (!name) {
      this.state.change({ albumError: "Enter an album name." });
      return;
    }
    try {
      const album = this.state.albumDialog;
      if (album === "new") {
        const id = await this.backend.createAlbum(name, description);
        await this.load();
        this.select(id);
      } else if (album) {
        await this.backend.updateAlbum(album.id, name, description);
        await this.load();
      }
      this.state.change({ albumDialog: null });
    } catch (error) {
      this.state.change({ albumError: String(error) });
    }
  }

  async delete(id: string): Promise<void> {
    const state = this.state;
    state.change({ albumMenu: null });
    const album = state.albums.find((item) => item.id === id);
    if (!album) return;
    const confirmed = await this.dialogs.confirm(
      `Delete album “${album.name}”? Photos will not be deleted.`,
      { title: "Delete album", kind: "warning" },
    );
    if (!confirmed) return;
    try {
      await this.backend.deleteAlbum(id);
      if (state.selectedAlbumId === id) {
        state.change({ selectedAlbumId: null, selectedPhoto: null, fullViewIndex: null });
        this.photoList.setPhotos([], false);
      }
      await this.load();
    } catch (error) {
      console.error("Failed to delete album", error);
      void this.dialogs.message(String(error), { title: "Delete album failed", kind: "error" });
    }
  }

  async addPhotos(id: string, paths: string[]): Promise<void> {
    const state = this.state;
    try {
      await this.backend.addPhotosToAlbum(id, paths);
      await this.load();
      state.change({ albumDropMode: false });
      if (state.mode === "albums" && state.selectedAlbumId === id) await this.refreshPhotos();
    } catch (error) {
      console.error("Failed to add photos to album", error);
      void this.dialogs.message(String(error), { title: "Add to album failed", kind: "error" });
    }
  }
}

import type { Album } from "../album/album";
import type { Photo } from "../photo/photo";

export interface AlbumBackend {
  listAlbums(): Promise<Album[]>;
  /** Resolves with the new album's id. */
  createAlbum(name: string, description: string): Promise<string>;
  updateAlbum(id: string, name: string, description: string): Promise<void>;
  deleteAlbum(id: string): Promise<void>;
  getAlbumPhotos(id: string): Promise<Photo[]>;
  addPhotosToAlbum(id: string, photoPaths: readonly string[]): Promise<void>;
}

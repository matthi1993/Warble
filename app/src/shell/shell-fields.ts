import type { Album, Folder, Photo } from "@warble/library";

export type LibraryMode = "folders" | "allPhotos" | "favorites" | "days" | "albums";
export type SidebarSection = "folders" | "days" | "albums";

export interface PhotoMenu {
  path: string;
  filename: string;
  paths: string[];
  x: number;
  y: number;
}

export interface FolderMenu {
  folderId: string;
  path: string;
  name: string;
  isRoot: boolean;
  available: boolean;
  x: number;
  y: number;
}

export interface AlbumMenu {
  id: string;
  x: number;
  y: number;
}

export class ShellFields {
  readonly imports: Folder[] = [];
  readonly folderPhotoCounts: Readonly<Record<string, number>> = {};
  readonly pendingRestoreFolderPath: string | null = null;

  readonly mode: LibraryMode = "folders";
  readonly selectedFolderId: string | null = null;
  readonly selectedFolderName: string | null = null;
  readonly selectedAlbumId: string | null = null;
  readonly selectedDateKey: string | null = null;
  readonly includeSubfolders: boolean = false;

  readonly photos: Photo[] = [];
  readonly libraryPhotos: Photo[] = [];
  readonly restoringCachedDates: boolean = false;
  readonly filterMetadataLoading: boolean = false;

  readonly selectedPhoto: Photo | null = null;
  readonly gridSelectionPaths: string[] = [];
  readonly fullViewIndex: number | null = null;
  readonly editPanelOpen: boolean = false;
  readonly windowFullscreen: boolean = false;
  readonly immersiveView: boolean = false;

  readonly expandedSections: ReadonlySet<SidebarSection> = new Set<SidebarSection>(["folders"]);
  readonly sidebarCollapsed: boolean = false;
  readonly mobileSidebarOpen: boolean = false;
  readonly detailOpen: boolean = false;

  readonly albums: Album[] = [];
  readonly albumDialog: Album | "new" | null = null;
  readonly albumError: string = "";
  readonly albumDropMode: boolean = false;
  readonly photoDragLabel: string | null = null;

  readonly photoMenu: PhotoMenu | null = null;
  readonly folderMenu: FolderMenu | null = null;
  readonly albumMenu: AlbumMenu | null = null;
  readonly metadataPaths: string[] = [];
}

import {
  buildFolderForest,
  dateSelectionLabel,
  type Album,
  type DateTreeNode,
  type Folder,
  type PhotoRatingLookup,
} from "@warble/library";
import type { DateIndex } from "./photo-list-controller";
import type { LibraryMode, SidebarSection } from "./shell-fields";
import type { ShellState } from "./shell-state";

export type ContentKind = "welcome" | "albumsWelcome" | "empty" | "grid";

export interface SidebarView {
  mode: LibraryMode;
  expandedSections: ReadonlySet<SidebarSection>;
  albumDropMode: boolean;
  allCount: number | null;
  favoriteCount: number | null;
  folders: Folder[];
  folderPhotoCounts: Readonly<Record<string, number>>;
  selectedFolderId: string | null;
  dateNodes: DateTreeNode[];
  selectedDateKey: string | null;
  datesLoading: boolean;
  restoringCachedDates: boolean;
  hasPhotos: boolean;
  albums: Album[];
  selectedAlbumId: string | null;
}

export class LibraryViewModel {
  constructor(
    private readonly state: ShellState,
    private readonly dates: Pick<DateIndex, "nodes">,
    private readonly ratings: PhotoRatingLookup,
  ) {}

  get contentKind(): ContentKind {
    const state = this.state;
    if (!state.hasSelection) return "welcome";
    if (state.mode === "albums" && !state.selectedAlbumId) return "albumsWelcome";
    return state.photos.length === 0 ? "empty" : "grid";
  }

  get breadcrumb(): string | null {
    const state = this.state;
    if (state.mode === "days") return "Days";
    if (state.mode === "folders") return state.selectedFolderName || null;
    return this.title;
  }

  get title(): string {
    const state = this.state;
    switch (state.mode) {
      case "favorites": return "Favorites";
      case "allPhotos": return "All Photos";
      case "days": return dateSelectionLabel(state.selectedDateKey);
      case "albums": return this.selectedAlbum?.name ?? "Albums";
      default: return state.selectedFolderName ?? "";
    }
  }

  get emptyMessage(): string {
    switch (this.state.mode) {
      case "favorites": return "No photos with at least one star yet.";
      case "allPhotos": return "No photos indexed yet.";
      case "days": return "No photos for this date.";
      case "albums": return "No photos in this album. Drag photos here to add them.";
      default: return "No photos in this folder.";
    }
  }

  get showsSubfolderToggle(): boolean {
    return this.state.mode === "folders";
  }

  get selectedAlbum(): Album | undefined {
    return this.state.albums.find((album) => album.id === this.state.selectedAlbumId);
  }

  get menuAlbum(): Album | undefined {
    return this.state.albums.find((album) => album.id === this.state.albumMenu?.id);
  }

  get sidebar(): SidebarView {
    const state = this.state;
    const allCount = this.allCount;
    return {
      mode: state.mode,
      expandedSections: state.expandedSections,
      albumDropMode: state.albumDropMode,
      allCount,
      favoriteCount: allCount === null ? null : this.favoriteCount,
      folders: buildFolderForest(state.imports),
      folderPhotoCounts: state.folderPhotoCounts,
      selectedFolderId: state.selectedFolderId,
      dateNodes: state.expandedSections.has("days") ? this.dates.nodes(state.libraryPhotos) : [],
      selectedDateKey: state.selectedDateKey,
      datesLoading: state.filterMetadataLoading,
      restoringCachedDates: state.restoringCachedDates,
      hasPhotos: state.libraryPhotos.length > 0,
      albums: state.albums,
      selectedAlbumId: state.selectedAlbumId,
    };
  }

  /** Unknown until every connected root reported its count. */
  private get allCount(): number | null {
    const counts = this.state.folderPhotoCounts;
    const roots = this.state.imports.filter((root) => root.available);
    return roots.every((root) => counts[root.id] !== undefined)
      ? roots.reduce((total, root) => total + counts[root.id], 0)
      : null;
  }

  private get favoriteCount(): number {
    return this.state.libraryPhotos.filter((photo) => this.ratings.get(photo.path).rating >= 1).length;
  }
}

import type { AlbumBackend } from "./album-backend";
import type { FolderBackend } from "./folder-backend";
import type { MetadataBackend } from "./metadata-backend";
import type { PhotoBackend } from "./photo-backend";
import type { RatingBackend } from "./rating-backend";
import type { VariantBackend } from "./variant-backend";
import type { WorkspaceBackend } from "./workspace-backend";

export interface LibraryBackend
  extends AlbumBackend,
    FolderBackend,
    MetadataBackend,
    PhotoBackend,
    RatingBackend,
    VariantBackend,
    WorkspaceBackend {}

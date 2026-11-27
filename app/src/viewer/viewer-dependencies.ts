import { app } from "@app/composition/app";
import type { EditStatePort } from "./edit-state-port";
import { EditingEditState } from "./editing-edit-state";
import type { ImageLoadingPort } from "./image-loading-port";
import { MediaImageLoading } from "./media-image-loading";

export interface ViewerDependencies {
  readonly images: ImageLoadingPort;
  readonly edits: EditStatePort;
}

export const viewerDependencies: ViewerDependencies = {
  images: new MediaImageLoading(app.media),
  edits: new EditingEditState(app.editing, app.recipes),
};

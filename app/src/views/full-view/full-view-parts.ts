import type { EditClipboard } from "./edit-clipboard";
import type { CanvasAccessor } from "./full-view-canvas";
import type { FullViewEvents } from "./full-view-events";
import type { SlideOverlay } from "./slide-overlay";
import type { PhotoSequence } from "./stage-model";
import type { UpdateHost } from "./update-host";

export interface FullViewHost extends PhotoSequence, UpdateHost {
  readonly immersive: boolean;
  readonly windowFullscreen: boolean;
  readonly updateComplete: Promise<unknown>;
}

export interface FullViewParts {
  readonly host: FullViewHost;
  readonly events: FullViewEvents;
  readonly overlay: SlideOverlay;
  readonly clipboard: EditClipboard;
  readonly canvas: CanvasAccessor;
  videoView(): { togglePlayback(): boolean } | null;
}

export interface ChangedProperties {
  readonly immersive: boolean;
  readonly photos: boolean;
  readonly index: boolean;
}

import { HD_PRELOAD_COUNT, VideoSources, type HdImagePreloader } from "@warble/media";
import type { CanvasAccessor } from "./full-view-canvas";
import type { StageModel } from "./stage-model";
import type { VariantResolver } from "./variant-resolver";

export class HdPreloadController {
  private variantRevision = 0;
  private syncedInputs: readonly unknown[] = [];

  constructor(
    private readonly stage: StageModel,
    private readonly variants: VariantResolver,
    private readonly preloader: Pick<HdImagePreloader, "update" | "stop">,
    private readonly canvas: CanvasAccessor,
  ) {}

  variantsChanged(): void {
    this.variantRevision++;
  }

  syncIfInputsChanged(): void {
    const { photos, index, presenting, playLivePhoto } = this.stage;
    const inputs = [photos, index, presenting, playLivePhoto, this.variantRevision];
    if (inputs.every((input, position) => input === this.syncedInputs[position])) return;
    this.syncedInputs = inputs;
    this.sync();
  }

  sync(): void {
    const path = this.stage.activeVideoPath ? null : this.stage.displayPath;
    const canvas = this.canvas();
    this.preloader.update(path, path ? this.upcomingPaths(path) : [], canvas?.path === path && !!canvas?.imageReady);
  }

  stop(): void {
    this.preloader.stop();
  }

  private upcomingPaths(currentPath: string): string[] {
    const { photos, index, presenting } = this.stage;
    const upcoming: string[] = [];
    for (let next = index + 1; next < photos.length && upcoming.length < HD_PRELOAD_COUNT; next++) {
      const path = presenting ? this.stage.slidePath(photos[next]) : this.variants.resolvedPath(photos[next]);
      if (path !== currentPath && !VideoSources.isVideo(path) && !upcoming.includes(path)) upcoming.push(path);
    }
    return upcoming;
  }
}

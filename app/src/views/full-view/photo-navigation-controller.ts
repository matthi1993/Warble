import type { FullViewEvents } from "./full-view-events";
import type { SlideshowController } from "./slideshow-controller";
import type { StageModel } from "./stage-model";

export class PhotoNavigationController {
  constructor(
    private readonly stage: Pick<StageModel, "photos" | "index">,
    private readonly slideshow: Pick<SlideshowController, "prepareManualAdvance">,
    private readonly events: Pick<FullViewEvents, "navigate">,
  ) {}

  go(delta: number): void {
    const next = this.stage.index + delta;
    if (next < 0 || next >= this.stage.photos.length) return;
    this.slideshow.prepareManualAdvance(this.stage.photos[next]);
    this.events.navigate(next);
  }
}

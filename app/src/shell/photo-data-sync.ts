import type { PhotoEditStore } from "@warble/editing";
import type { RatingStore, VariantStore } from "@warble/library";

export class PhotoDataSync {
  constructor(
    private readonly photoEdits: Pick<PhotoEditStore, "flushAll" | "reload" | "removeEffectsUnderRoot">,
    private readonly ratings: Pick<RatingStore, "flush" | "reload">,
    private readonly variants: Pick<VariantStore, "reload">,
  ) {}

  forgetRoot(rootId: string): void {
    this.photoEdits.removeEffectsUnderRoot(rootId);
  }

  async flushPendingWrites(): Promise<void> {
    await Promise.all([this.photoEdits.flushAll(), this.ratings.flush()]);
  }

  async reloadEditsAndRatings(): Promise<void> {
    await Promise.all([this.photoEdits.reload(), this.ratings.reload()]);
  }

  async reloadAll(): Promise<void> {
    await Promise.all([this.photoEdits.reload(), this.ratings.reload(), this.variants.reload()]);
  }
}

const SAME_ROW_TOLERANCE_PX = 2;

/** Finds the rendered thumbnail cards to measure the rows and to scroll a photo into view. */
export class GridLayoutController {
  constructor(private readonly renderRoot: () => ParentNode) {}

  /** Cards in the first rendered row; 0 while no card is rendered. */
  columnCount(): number {
    const cards = Array.from(this.renderRoot().querySelectorAll("pf-thumbnail-card"));
    if (cards.length === 0) return 0;
    const firstTop = cards[0].getBoundingClientRect().top;
    const nextRow = cards.findIndex(
      (card) => Math.abs(card.getBoundingClientRect().top - firstTop) >= SAME_ROW_TOLERANCE_PX,
    );
    return nextRow < 0 ? cards.length : nextRow;
  }

  scrollToPhoto(path: string | null): void {
    if (!path) return;
    this.renderRoot()
      .querySelector(`pf-thumbnail-card[data-path="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** Waits a frame so a card that was just rendered or revealed has its final position. */
  scrollToPhotoSoon(path: () => string | null): void {
    requestAnimationFrame(() => this.scrollToPhoto(path()));
  }
}

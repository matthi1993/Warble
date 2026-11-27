export interface LoadMoreTarget {
  showMoreGroups(): void;
  showMoreForDay(day: string): void;
}

/** Loads the next page as soon as a "show more" control scrolls near the visible area. */
export class GridLoadMoreController {
  private observer: IntersectionObserver | null = null;

  constructor(private readonly paging: LoadMoreTarget) {}

  observeLoadMoreControls(renderRoot: ParentNode): void {
    this.observer?.disconnect();
    const root = renderRoot.querySelector(".grid-scroll");
    if (!root) return;
    const observer = new IntersectionObserver((entries) => this.loadIntersecting(entries), {
      root,
      rootMargin: "400px 0px",
    });
    renderRoot
      .querySelectorAll(".group-load-more, .groups-load-more")
      .forEach((control) => observer.observe(control));
    this.observer = observer;
  }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private loadIntersecting(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const control = entry.target as HTMLElement;
      if (control.classList.contains("groups-load-more")) {
        this.paging.showMoreGroups();
        continue;
      }
      const day = control.dataset.day;
      if (day) this.paging.showMoreForDay(day);
    }
  }
}

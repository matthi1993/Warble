import { getDayGroups, UNDATED_KEY, type Photo, type PhotoDayGroup } from "@warble/library";

const PHOTO_PAGE_SIZE = 48;
const GROUP_PAGE_SIZE = 8;

export interface GridDaysHost {
  requestUpdate(): void;
}

/** The filtered photos grouped by capture day, and how much of each group is rendered. */
export class GridDaysController {
  private collapsedDays = new Set<string>();
  private visibleCountByDay = new Map<string, number>();
  private visibleGroupCount = GROUP_PAGE_SIZE;
  private groupedPhotos: Photo[] | null = null;
  private dayGroupCache: PhotoDayGroup[] = [];

  constructor(
    private readonly host: GridDaysHost,
    private readonly filteredPhotos: () => Photo[],
  ) {}

  get filtered(): Photo[] {
    return this.filteredPhotos();
  }

  get dayGroups(): PhotoDayGroup[] {
    const photos = this.filteredPhotos();
    if (photos !== this.groupedPhotos) {
      this.groupedPhotos = photos;
      this.dayGroupCache = getDayGroups(photos);
    }
    return this.dayGroupCache;
  }

  get visibleGroups(): PhotoDayGroup[] {
    return this.dayGroups.slice(0, this.visibleGroupCount);
  }

  get hasMoreGroups(): boolean {
    return this.dayGroups.length > this.visibleGroupCount;
  }

  /** Every filtered photo in display order, including collapsed and not yet rendered ones. */
  get ordered(): Photo[] {
    return this.dayGroups.flatMap((group) => group.photos);
  }

  get expandedPhotos(): Photo[] {
    return this.dayGroups.flatMap((group) => (this.isExpanded(group) ? group.photos : []));
  }

  dayKey(group: PhotoDayGroup): string {
    return group.date ?? UNDATED_KEY;
  }

  formatDay(date: string | null): string {
    if (!date) return "Date unknown";
    const parsed = new Date(`${date}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return date;
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(parsed);
  }

  isExpanded(group: PhotoDayGroup): boolean {
    return !this.collapsedDays.has(this.dayKey(group));
  }

  toggleDay(group: PhotoDayGroup): void {
    const day = this.dayKey(group);
    if (!this.collapsedDays.delete(day)) this.collapsedDays.add(day);
    this.host.requestUpdate();
  }

  visiblePhotos(group: PhotoDayGroup): Photo[] {
    return group.photos.slice(0, this.visiblePhotoCount(group));
  }

  hasMorePhotos(group: PhotoDayGroup): boolean {
    return this.visiblePhotoCount(group) < group.photos.length;
  }

  showMoreForDay(day: string): void {
    const current = this.visibleCountByDay.get(day) ?? PHOTO_PAGE_SIZE;
    this.visibleCountByDay.set(day, current + PHOTO_PAGE_SIZE);
    this.host.requestUpdate();
  }

  showMoreGroups(): void {
    this.visibleGroupCount += GROUP_PAGE_SIZE;
    this.host.requestUpdate();
  }

  resetVisiblePhotoPages(): void {
    this.visibleCountByDay.clear();
    this.host.requestUpdate();
  }

  /** Back to the first page with every day expanded, for a different set of photos. */
  reset(): void {
    this.collapsedDays.clear();
    this.visibleGroupCount = GROUP_PAGE_SIZE;
    this.resetVisiblePhotoPages();
  }

  ensurePhotoIsRendered(path: string): void {
    for (const [groupIndex, group] of this.dayGroups.entries()) {
      const index = group.photos.findIndex((photo) => photo.path === path);
      if (index < 0) continue;
      if (groupIndex >= this.visibleGroupCount) {
        this.visibleGroupCount = groupIndex + GROUP_PAGE_SIZE;
      }
      if (index >= this.visiblePhotoCount(group)) {
        this.visibleCountByDay.set(this.dayKey(group), index + PHOTO_PAGE_SIZE);
      }
      this.host.requestUpdate();
      return;
    }
  }

  private visiblePhotoCount(group: PhotoDayGroup): number {
    const count = this.visibleCountByDay.get(this.dayKey(group)) ?? PHOTO_PAGE_SIZE;
    return Math.min(count, group.photos.length);
  }
}

import type { Photo } from "@domain/photo";

export interface DateTreeNode {
  key: string;
  label: string;
  count: number;
  children: DateTreeNode[];
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long" });
const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });

export function captureDay(photo: Photo): string | null {
  return normalizeCaptureDay(photo.filterInfo?.dateTaken);
}

function normalizeCaptureDay(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function matchesDateSelection(photo: Photo, key: string | null): boolean {
  if (key === null) return true;
  const date = captureDay(photo);
  return key === "undated" ? date === null : date?.startsWith(key) ?? false;
}

export function dateSelectionLabel(key: string | null): string {
  if (key === null) return "Days";
  if (key === "undated") return "Date unknown";
  if (key.length === 4) return key;
  const date = new Date(`${key.length === 7 ? `${key}-01` : key}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, key.length === 7
    ? { month: "long", year: "numeric" }
    : { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export class DateTreeIndex {
  private readonly datesByPath = new Map<string, string | null>();
  private readonly dateCounts = new Map<string, number>();
  private undatedCount = 0;
  private cachedTree: DateTreeNode[] | null = null;

  replacePhotos(photos: readonly Photo[]): void {
    this.datesByPath.clear();
    this.dateCounts.clear();
    this.undatedCount = 0;
    for (const photo of photos) {
      this.setDate(photo.path, captureDay(photo));
    }
    this.cachedTree = null;
  }

  updateMetadata(results: readonly ({ path: string; dateTaken?: string | null })[]): void {
    for (const result of results) {
      if (!this.datesByPath.has(result.path)) continue;
      this.setDate(result.path, normalizeCaptureDay(result.dateTaken));
    }
  }

  getTree(): DateTreeNode[] {
    if (this.cachedTree) return this.cachedTree;
    const years = new Map<string, Map<string, Map<string, number>>>();
    for (const [date, count] of this.dateCounts) {
      const [year, month] = date.split("-");
      let months = years.get(year);
      if (!months) years.set(year, months = new Map());
      let days = months.get(month);
      if (!days) months.set(month, days = new Map());
      days.set(date, count);
    }
    const nodes = [...years.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, months]) => {
        const children = [...months.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([month, days]) => {
            const key = `${year}-${month}`;
            const children = [...days.entries()]
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([date, count]) => ({
                key: date,
                label: dayFormatter.format(new Date(`${date}T12:00:00`)),
                count,
                children: [],
              }));
            return {
              key,
              label: monthFormatter.format(new Date(`${key}-01T12:00:00`)),
              count: children.reduce((total, day) => total + day.count, 0),
              children,
            };
          });
        return {
          key: year,
          label: year,
          count: children.reduce((total, month) => total + month.count, 0),
          children,
        };
      });
    if (this.undatedCount) nodes.push({ key: "undated", label: "Date unknown", count: this.undatedCount, children: [] });
    return this.cachedTree = nodes;
  }

  private setDate(path: string, date: string | null): void {
    const exists = this.datesByPath.has(path);
    const previous = this.datesByPath.get(path);
    if (exists && previous === date) return;
    if (exists && previous === null) this.undatedCount--;
    else if (exists && previous) {
      const count = (this.dateCounts.get(previous) ?? 0) - 1;
      if (count > 0) this.dateCounts.set(previous, count);
      else this.dateCounts.delete(previous);
    }
    this.datesByPath.set(path, date);
    if (date === null) this.undatedCount++;
    else if (date) this.dateCounts.set(date, (this.dateCounts.get(date) ?? 0) + 1);
    this.cachedTree = null;
  }
}
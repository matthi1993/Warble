import type { Photo } from "../photo/photo";
import { captureDay, normalizeCaptureDay } from "./capture-day";
import { UNDATED_KEY } from "./date-selection";

export interface DateTreeNode {
  key: string;
  label: string;
  count: number;
  children: DateTreeNode[];
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long" });
const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });

export class DateTreeIndex {
  private readonly datesByPath = new Map<string, string | null>();
  private readonly dateCounts = new Map<string, number>();
  private undatedCount = 0;
  private cachedTree: DateTreeNode[] | null = null;

  replacePhotos(photos: readonly Photo[]): void {
    this.datesByPath.clear();
    this.dateCounts.clear();
    this.undatedCount = 0;
    for (const photo of photos) this.setDate(photo.path, captureDay(photo));
    this.cachedTree = null;
  }

  updateMetadata(results: readonly { path: string; dateTaken?: string | null }[]): void {
    for (const result of results) {
      if (!this.datesByPath.has(result.path)) continue;
      this.setDate(result.path, normalizeCaptureDay(result.dateTaken));
    }
  }

  /** Years, months and days, newest first, followed by the undated node when it has photos. */
  getTree(): DateTreeNode[] {
    if (this.cachedTree) return this.cachedTree;
    const years: DateTreeNode[] = [];
    const newestFirst = [...this.dateCounts.entries()].sort(([a], [b]) => b.localeCompare(a));
    for (const [date, count] of newestFirst) {
      const [year, month] = date.split("-");
      const monthKey = `${year}-${month}`;
      const yearNode = lastNodeOrAppend(years, year, () => year);
      const monthNode = lastNodeOrAppend(yearNode.children, monthKey, () =>
        monthFormatter.format(noon(`${monthKey}-01`)),
      );
      monthNode.children.push({
        key: date,
        label: dayFormatter.format(noon(date)),
        count,
        children: [],
      });
      monthNode.count += count;
      yearNode.count += count;
    }
    if (this.undatedCount) {
      years.push({
        key: UNDATED_KEY,
        label: "Date unknown",
        count: this.undatedCount,
        children: [],
      });
    }
    return (this.cachedTree = years);
  }

  private setDate(path: string, date: string | null): void {
    const exists = this.datesByPath.has(path);
    const previous = this.datesByPath.get(path);
    if (exists && previous === date) return;
    if (exists && previous === null) this.undatedCount--;
    else if (exists && previous) this.decrementDate(previous);
    this.datesByPath.set(path, date);
    if (date === null) this.undatedCount++;
    else if (date) this.dateCounts.set(date, (this.dateCounts.get(date) ?? 0) + 1);
    this.cachedTree = null;
  }

  private decrementDate(date: string): void {
    const count = (this.dateCounts.get(date) ?? 0) - 1;
    if (count > 0) this.dateCounts.set(date, count);
    else this.dateCounts.delete(date);
  }
}

function lastNodeOrAppend(nodes: DateTreeNode[], key: string, label: () => string): DateTreeNode {
  const last = nodes[nodes.length - 1];
  if (last?.key === key) return last;
  const node: DateTreeNode = { key, label: label(), count: 0, children: [] };
  nodes.push(node);
  return node;
}

// Noon keeps the local calendar day stable across time zones.
function noon(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

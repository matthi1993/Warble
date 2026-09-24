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
  const date = photo.filterInfo?.dateTaken;
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

export function buildDateTree(photos: readonly Photo[], metadataLoading = false): DateTreeNode[] {
  const years = new Map<string, Map<string, Map<string, number>>>();
  let undated = 0;
  for (const photo of photos) {
    const date = captureDay(photo);
    if (!date) {
      if (!metadataLoading || photo.filterInfo) undated++;
      continue;
    }
    const [year, month] = date.split("-");
    if (!years.has(year)) years.set(year, new Map());
    const months = years.get(year)!;
    if (!months.has(month)) months.set(month, new Map());
    const days = months.get(month)!;
    days.set(date, (days.get(date) ?? 0) + 1);
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
  if (undated) nodes.push({ key: "undated", label: "Date unknown", count: undated, children: [] });
  return nodes;
}
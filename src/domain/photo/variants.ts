/**
 * Pure helpers for photos that have multiple files sharing the same stem.
 *
 * Two orthogonal axes:
 *   - **Format** — `jpg` vs `raw` (other extensions are ignored by the toggle).
 *   - **Variant** — `base` (the primary file, no parens on the stem) plus any
 *     additional `Stem (key).ext` siblings (e.g. `Foo (1).jpg`, `Foo (edit).jpg`).
 *
 * Each (format, variant) pair maps to at most one file on disk.
 */
import type { Photo, PhotoFile } from "./types";

export type PhotoFormat = "jpg" | "raw";

const JPG_EXTS = ["jpg", "jpeg"];
const RAW_EXTS = [
  "raf",
  "raw",
  "arw",
  "cr2",
  "cr3",
  "nef",
  "dng",
  "orf",
  "rw2",
];

export function classifyFormat(ext: string): PhotoFormat | null {
  const e = ext.toLowerCase();
  if (JPG_EXTS.includes(e)) return "jpg";
  if (RAW_EXTS.includes(e)) return "raw";
  return null;
}

function filesOf(photo: Photo): PhotoFile[] {
  return photo.files ?? [];
}

/** Available formats on a photo, in stable order: jpg, raw. */
export function availableFormats(photo: Photo): PhotoFormat[] {
  const seen = new Set<PhotoFormat>();
  for (const f of filesOf(photo)) {
    const fmt = classifyFormat(f.extension);
    if (fmt) seen.add(fmt);
  }
  const out: PhotoFormat[] = [];
  if (seen.has("jpg")) out.push("jpg");
  if (seen.has("raw")) out.push("raw");
  return out;
}

export interface VariantOption {
  /** Stable identifier (e.g. `"base"`, `"1"`, `"edit"`). */
  key: string;
  /** Human-readable label for the toggle. */
  label: string;
}

function variantLabel(key: string): string {
  if (key === "base") return "Base";
  if (key.toLowerCase() === "edit") return "Edit";
  if (/^edit \d+$/i.test(key)) {
    return `Edit ${key.slice(5)}`;
  }
  return `Variant ${key}`;
}

/** Variants available for the given format, with `base` first. */
export function availableVariants(
  photo: Photo,
  format: PhotoFormat,
): VariantOption[] {
  const keys = new Set<string>();
  for (const f of filesOf(photo)) {
    if (classifyFormat(f.extension) === format) keys.add(f.variant);
  }
  const sorted = Array.from(keys).sort((a, b) => {
    if (a === b) return 0;
    if (a === "base") return -1;
    if (b === "base") return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
  return sorted.map((k) => ({ key: k, label: variantLabel(k) }));
}

/** Resolve the filesystem path for a (format, variant) pick. */
export function fileForSelection(
  photo: Photo,
  format: PhotoFormat,
  variantKey: string,
): string | null {
  for (const f of filesOf(photo)) {
    if (classifyFormat(f.extension) === format && f.variant === variantKey) {
      return f.path;
    }
  }
  return null;
}

/**
 * The (format, variant) selection that corresponds to `photo.path` — i.e.
 * the default the backend chose. Falls back to the first available pair
 * when the primary file isn't a known format.
 */
export function primarySelection(
  photo: Photo,
): { format: PhotoFormat; variant: string } | null {
  for (const f of filesOf(photo)) {
    if (f.path === photo.path) {
      const fmt = classifyFormat(f.extension);
      if (fmt) return { format: fmt, variant: f.variant };
    }
  }
  const formats = availableFormats(photo);
  if (formats.length === 0) return null;
  const fmt = formats[0];
  const variants = availableVariants(photo, fmt);
  if (variants.length === 0) return null;
  return { format: fmt, variant: variants[0].key };
}

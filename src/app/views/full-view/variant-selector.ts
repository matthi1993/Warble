/**
 * Pure helpers for resolving the active format/variant selection
 * for a photo, given the user's persisted override.
 *
 * Extracted from `pf-full-view` so the orchestrator doesn't carry
 * domain-resolution logic inline. No DOM, no Lit — just data math.
 */
import {
  availableFormats,
  availableVariants,
  fileForSelection,
  primarySelection,
  type Photo,
  type PhotoFormat,
} from "@domain/photo";
import {
  getVariantOverride,
  hasSessionVariantOverride,
} from "@app/variant-store";

export interface VariantSelection {
  format: PhotoFormat;
  variant: string;
}

/** Pick the newest numbered Edit JPEG when the last stored selection was
 * RAW. The saved-variant flow uses this naming sequence, so lexical variant
 * order alone would incorrectly put Edit 10 before Edit 2. */
export function latestJpegVariant(photo: Photo): string | null {
  const variants = availableVariants(photo, "jpg");
  if (variants.length === 0) return null;
  const edits = variants.filter((v) => /^edit(?: \d+)?$/i.test(v.key));
  if (edits.length > 0) {
    edits.sort((a, b) => {
      const number = (key: string) =>
        key.toLowerCase() === "edit" ? 1 : Number(key.slice(5));
      return number(b.key) - number(a.key);
    });
    return edits[0].key;
  }
  return variants[variants.length - 1].key;
}

/** The currently-selected (format, variant) for `photo`, taking the
 *  user's persisted override into account. Returns `null` when the
 *  photo has no available formats. */
export function currentSelection(photo: Photo): VariantSelection | null {
  const formats = availableFormats(photo);
  if (formats.length === 0) return null;
  const primary = primarySelection(photo);
  const stored = getVariantOverride(photo.path);
  // A JPEG is the reopenable/default representation whenever one exists.
  // RAW can still be selected explicitly for the current session, but it
  // must not become the persisted default after the app is restarted.
  const storedFormat = stored?.format === "raw" && formats.includes("jpg") &&
      !hasSessionVariantOverride(photo.path)
    ? "jpg"
    : stored?.format;
  const format = storedFormat ?? primary?.format ?? formats[0];
  const variants = availableVariants(photo, format);
  if (variants.length === 0) return null;
  const requested =
    (stored && stored.format === format ? stored.variant : null) ??
    (format === "jpg" && stored?.format === "raw"
      ? latestJpegVariant(photo)
      : null) ??
    (primary && primary.format === format ? primary.variant : null) ??
    variants[0].key;
  const final =
    variants.find((v) => v.key === requested)?.key ?? variants[0].key;
  return { format, variant: final };
}

/** Resolved on-disk path for the active selection — falls back to
 *  the photo's nominal path when no concrete file is available. */
export function resolvedPath(photo: Photo): string {
  const sel = currentSelection(photo);
  if (!sel) return photo.path;
  return fileForSelection(photo, sel.format, sel.variant) ?? photo.path;
}

/** True when the active selection has an editable format. Both JPEG
 *  and RAW selections run through the same in-canvas edit pipeline
 *  (tone, curve, crop) — RAW is decoded server-side into a
 *  display-ready bitmap, so the frontend treats the two identically. */
export function isEditableSelection(photo: Photo | null): boolean {
  if (!photo) return false;
  const fmt = currentSelection(photo)?.format;
  return fmt === "jpg" || fmt === "raw";
}

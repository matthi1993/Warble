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
import { getVariantOverride } from "@app/variant-store";

export interface VariantSelection {
  format: PhotoFormat;
  variant: string;
}

/** The currently-selected (format, variant) for `photo`, taking the
 *  user's persisted override into account. Returns `null` when the
 *  photo has no available formats. */
export function currentSelection(photo: Photo): VariantSelection | null {
  const formats = availableFormats(photo);
  if (formats.length === 0) return null;
  const primary = primarySelection(photo);
  const stored = getVariantOverride(photo.path);
  const format = stored?.format ?? primary?.format ?? formats[0];
  const variants = availableVariants(photo, format);
  if (variants.length === 0) return null;
  const requested =
    (stored && stored.format === format ? stored.variant : null) ??
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

/** True when the active selection is a JPEG — only format we edit. */
export function isJpegSelection(photo: Photo | null): boolean {
  if (!photo) return false;
  return currentSelection(photo)?.format === "jpg";
}

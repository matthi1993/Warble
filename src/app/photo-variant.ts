/**
 * Helpers for handling photos that have multiple files sharing the same stem
 * (e.g. an in-camera JPEG sibling next to a RAW). The backend exposes the
 * full extension list on every {@link Photo}; this module converts that into
 * a user-facing JPG/RAW variant choice and constructs the path for each.
 */
import type { Photo } from "./types";

export type PhotoVariant = "jpg" | "raw";

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

function classify(ext: string): PhotoVariant | null {
  const e = ext.toLowerCase();
  if (JPG_EXTS.includes(e)) return "jpg";
  if (RAW_EXTS.includes(e)) return "raw";
  return null;
}

/** Pick the first extension on the photo matching the requested variant. */
function variantExtension(photo: Photo, variant: PhotoVariant): string | null {
  for (const ext of photo.extensions ?? []) {
    if (classify(ext) === variant) return ext;
  }
  return null;
}

/**
 * Returns the available variants for a photo (in stable order: jpg, raw).
 * If only one variant is available, the toggle UI should hide.
 */
export function availableVariants(photo: Photo): PhotoVariant[] {
  const out: PhotoVariant[] = [];
  if (variantExtension(photo, "jpg")) out.push("jpg");
  if (variantExtension(photo, "raw")) out.push("raw");
  return out;
}

/** The variant of the photo's primary path (the one returned by the backend). */
export function primaryVariant(photo: Photo): PhotoVariant | null {
  const dot = photo.path.lastIndexOf(".");
  if (dot < 0) return null;
  return classify(photo.path.slice(dot + 1));
}

/**
 * Build the filesystem path for the given variant by swapping the extension
 * on the primary path. Preserves the original case of the sibling extension
 * as recorded on the {@link Photo}.
 */
export function variantPath(
  photo: Photo,
  variant: PhotoVariant
): string | null {
  const ext = variantExtension(photo, variant);
  if (!ext) return null;
  const dot = photo.path.lastIndexOf(".");
  if (dot < 0) return null;
  return photo.path.slice(0, dot + 1) + ext;
}

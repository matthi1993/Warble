import type { Photo, PhotoFile } from "./photo";

export type PhotoFormat = "jpg";

export interface VariantOption {
  key: string;
  label: string;
}

const JPG_EXTS = ["jpg", "jpeg"];

export const RAW_EXTS = [
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
  return JPG_EXTS.includes(ext.toLowerCase()) ? "jpg" : null;
}

export function availableFormats(photo: Photo): PhotoFormat[] {
  const hasJpg = filesOf(photo).some((file) => classifyFormat(file.extension) === "jpg");
  return hasJpg ? ["jpg"] : [];
}

export function availableVariants(photo: Photo, format: PhotoFormat): VariantOption[] {
  const keys = new Set<string>();
  for (const file of filesOf(photo)) {
    if (classifyFormat(file.extension) === format) keys.add(file.variant);
  }
  return Array.from(keys)
    .sort(compareVariantKeys)
    .map((key) => ({ key, label: variantLabel(key) }));
}

export function fileForSelection(
  photo: Photo,
  format: PhotoFormat,
  variantKey: string,
): string | null {
  const file = filesOf(photo).find(
    (candidate) => classifyFormat(candidate.extension) === format && candidate.variant === variantKey,
  );
  return file?.path ?? null;
}

export function primarySelection(
  photo: Photo,
): { format: PhotoFormat; variant: string } | null {
  for (const file of filesOf(photo)) {
    if (file.path !== photo.path) continue;
    const format = classifyFormat(file.extension);
    if (format) return { format, variant: file.variant };
  }
  const [format] = availableFormats(photo);
  if (!format) return null;
  const [firstVariant] = availableVariants(photo, format);
  return firstVariant ? { format, variant: firstVariant.key } : null;
}

function filesOf(photo: Photo): PhotoFile[] {
  return photo.files ?? [];
}

function compareVariantKeys(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "base") return -1;
  if (b === "base") return 1;
  return a.localeCompare(b, undefined, { numeric: true });
}

function variantLabel(key: string): string {
  if (key === "base") return "Base";
  if (key.toLowerCase() === "edit") return "Edit";
  if (/^edit \d+$/i.test(key)) return `Edit ${key.slice(5)}`;
  return `Variant ${key}`;
}

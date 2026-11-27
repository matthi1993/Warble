import {
  availableFormats,
  availableVariants,
  fileForSelection,
  primarySelection,
  type Photo,
  type PhotoFormat,
  type VariantPref,
} from "@warble/library";

export interface VariantSelection {
  format: PhotoFormat;
  variant: string;
}

export interface VariantPreferences {
  get(path: string): VariantPref | null;
}

export class VariantResolver {
  constructor(private readonly preferences: VariantPreferences) {}

  currentSelection(photo: Photo): VariantSelection | null {
    const formats = availableFormats(photo);
    if (formats.length === 0) return null;
    const primary = primarySelection(photo);
    const stored = this.preferences.get(photo.path);
    const format = stored?.format ?? primary?.format ?? formats[0];
    const variants = availableVariants(photo, format);
    if (variants.length === 0) return null;
    const requested =
      (stored && stored.format === format ? stored.variant : null) ??
      (primary && primary.format === format ? primary.variant : null) ??
      variants[0].key;
    const variant = variants.find((candidate) => candidate.key === requested)?.key ?? variants[0].key;
    return { format, variant };
  }

  resolvedPath(photo: Photo): string {
    const selection = this.currentSelection(photo);
    if (!selection) return photo.path;
    return fileForSelection(photo, selection.format, selection.variant) ?? photo.path;
  }

  isEditable(photo: Photo | null): boolean {
    return photo !== null && this.currentSelection(photo)?.format === "jpg";
  }
}

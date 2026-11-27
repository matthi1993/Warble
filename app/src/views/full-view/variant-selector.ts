import type { Photo } from "@warble/library";
import { app } from "@app/composition/app";
import { VariantResolver, type VariantSelection } from "./variant-resolver";

export type { VariantSelection } from "./variant-resolver";

const resolver = new VariantResolver(app.library.variants);

export function currentSelection(photo: Photo): VariantSelection | null {
  return resolver.currentSelection(photo);
}

export function resolvedPath(photo: Photo): string {
  return resolver.resolvedPath(photo);
}

export function isEditableSelection(photo: Photo | null): boolean {
  return resolver.isEditable(photo);
}

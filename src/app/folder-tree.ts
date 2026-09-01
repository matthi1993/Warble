import type { Folder } from "@domain/folder";

export function buildFolderForest(imports: Folder[]): Folder[] {
  return [...imports].sort((a, b) => a.name.localeCompare(b.name));
}

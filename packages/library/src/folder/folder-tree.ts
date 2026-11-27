import type { Folder } from "./folder";

export function findFolderByPath(roots: Folder[], path: string): Folder | null {
  for (const root of roots) {
    if (root.path === path) return root;
    const found = findFolderByPath(root.children, path);
    if (found) return found;
  }
  return null;
}

export function buildFolderForest(imports: Folder[]): Folder[] {
  return [...imports].sort((a, b) => a.name.localeCompare(b.name));
}

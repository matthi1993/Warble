import type { Folder } from "./types";

/** Depth-first lookup of a folder by its absolute path. Returns `null`
 *  when no node in any of the supplied root forests matches. */
export function findFolderByPath(
  roots: Folder[],
  path: string,
): Folder | null {
  for (const r of roots) {
    if (r.path === path) return r;
    const found = findFolderByPath(r.children, path);
    if (found) return found;
  }
  return null;
}

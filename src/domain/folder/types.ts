/**
 * Folder tree value object. A single recursive node carrying its
 * absolute path and the children discovered under it.
 */

export interface Folder {
  id: string;
  path: string;
  name: string;
  children: Folder[];
}

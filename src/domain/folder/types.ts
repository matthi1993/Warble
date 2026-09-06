/**
 * Folder tree value object. A single recursive node carrying its
 * portable root-relative key and the children discovered under it.
 */

export interface Folder {
  id: string;
  path: string;
  name: string;
  children: Folder[];
  /** False when this device has not yet been granted access to the root. */
  available: boolean;
}

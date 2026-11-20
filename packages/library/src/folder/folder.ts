export interface Folder {
  id: string;
  path: string;
  name: string;
  children: Folder[];
  /** False when this device has not yet been granted access to the root. */
  available: boolean;
  scanning?: boolean;
}

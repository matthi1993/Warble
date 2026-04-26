export interface Photo {
  path: string;
  filename: string;
}

export interface Folder {
  id: string;
  path: string;
  name: string;
  children: Folder[];
}

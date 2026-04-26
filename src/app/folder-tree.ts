import type { Folder } from "./types";

interface TrieNode {
  segments: string[];
  children: Map<string, TrieNode>;
  isReal: boolean;
}

function splitPath(p: string): string[] {
  return p.split("/").filter(Boolean);
}

function joinAbs(segs: string[]): string {
  return "/" + segs.join("/");
}

function insertFolder(root: TrieNode, folder: Folder): void {
  const segs = splitPath(folder.path);
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    let child = cur.children.get(seg);
    if (!child) {
      child = {
        segments: segs.slice(0, i + 1),
        children: new Map(),
        isReal: false,
      };
      cur.children.set(seg, child);
    }
    cur = child;
  }
  cur.isReal = true;
  for (const c of folder.children) insertFolder(root, c);
}

function nodeToFolder(node: TrieNode): Folder {
  const path = joinAbs(node.segments);
  const name = node.segments[node.segments.length - 1] ?? path;
  const children: Folder[] = [];
  for (const child of node.children.values()) {
    children.push(...findRoots(child));
  }
  children.sort((a, b) => a.name.localeCompare(b.name));
  return { id: path, path, name, children };
}

function findRoots(node: TrieNode): Folder[] {
  let cur = node;
  while (!cur.isReal && cur.children.size === 1) {
    cur = cur.children.values().next().value!;
  }
  if (!cur.isReal && cur.children.size > 1) {
    const result: Folder[] = [];
    for (const child of cur.children.values()) {
      result.push(...findRoots(child));
    }
    return result;
  }
  return [nodeToFolder(cur)];
}

export function buildFolderForest(imports: Folder[]): Folder[] {
  const root: TrieNode = {
    segments: [],
    children: new Map(),
    isReal: false,
  };
  for (const imp of imports) insertFolder(root, imp);
  const forest: Folder[] = [];
  for (const child of root.children.values()) {
    forest.push(...findRoots(child));
  }
  forest.sort((a, b) => a.path.localeCompare(b.path));
  return forest;
}

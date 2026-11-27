import { LruCache } from "@warble/core";

export interface ThumbnailImage {
  url: string;
  release(): void;
}

interface ThumbnailResource {
  cacheReferences: number;
  imageReferences: number;
  url: string | null;
}

const CAPACITY = 500;

export class ThumbnailCache {
  private readonly resources = new WeakMap<ArrayBuffer, ThumbnailResource>();
  private readonly bytesByPath = new LruCache<string, ArrayBuffer>({
    capacity: CAPACITY,
    onEvict: (bytes) => {
      const resource = this.resourceFor(bytes);
      resource.cacheReferences--;
      this.revokeUnusedUrl(resource);
    },
  });

  has(path: string): boolean {
    return this.bytesByPath.has(path);
  }

  get(path: string): ArrayBuffer | null {
    return this.bytesByPath.get(path) ?? null;
  }

  set(path: string, bytes: ArrayBuffer): void {
    if (this.bytesByPath.peek(path) !== bytes) this.resourceFor(bytes).cacheReferences++;
    this.bytesByPath.set(path, bytes);
  }

  delete(path: string): void {
    this.bytesByPath.delete(path);
  }

  clear(): void {
    this.bytesByPath.clear();
  }

  acquireImage(bytes: ArrayBuffer): ThumbnailImage {
    const resource = this.resourceFor(bytes);
    resource.url ??= URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    resource.imageReferences++;
    let released = false;
    return {
      url: resource.url,
      release: () => {
        if (released) return;
        released = true;
        resource.imageReferences--;
        this.revokeUnusedUrl(resource);
      },
    };
  }

  private resourceFor(bytes: ArrayBuffer): ThumbnailResource {
    let resource = this.resources.get(bytes);
    if (!resource) {
      resource = { cacheReferences: 0, imageReferences: 0, url: null };
      this.resources.set(bytes, resource);
    }
    return resource;
  }

  private revokeUnusedUrl(resource: ThumbnailResource): void {
    if (resource.cacheReferences > 0 || resource.imageReferences > 0 || !resource.url) return;
    URL.revokeObjectURL(resource.url);
    resource.url = null;
  }
}

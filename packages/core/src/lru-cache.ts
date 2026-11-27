export interface LruCacheOptions<K, V> {
  readonly capacity: number;
  readonly onEvict?: (value: V, key: K) => void;
  readonly isPinned?: (key: K) => boolean;
}

export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();
  private limit: number;

  constructor(private readonly options: LruCacheOptions<K, V>) {
    this.limit = Math.max(0, options.capacity);
  }

  get capacity(): number {
    return this.limit;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  peek(key: K): V | undefined {
    return this.entries.get(key);
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key)!;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    const previous = this.entries.get(key);
    this.entries.delete(key);
    if (previous !== undefined && previous !== value) this.options.onEvict?.(previous, key);
    this.entries.set(key, value);
    this.trim();
  }

  delete(key: K): boolean {
    if (!this.entries.has(key)) return false;
    const value = this.entries.get(key)!;
    this.entries.delete(key);
    this.options.onEvict?.(value, key);
    return true;
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.delete(key);
  }

  resize(capacity: number): void {
    this.limit = Math.max(0, capacity);
    this.trim();
  }

  keys(): K[] {
    return [...this.entries.keys()];
  }

  private trim(): void {
    if (this.entries.size <= this.limit) return;
    for (const key of [...this.entries.keys()]) {
      if (this.entries.size <= this.limit) return;
      if (!this.options.isPinned?.(key)) this.delete(key);
    }
  }
}

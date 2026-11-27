import { Debouncer } from "@warble/core";

/** Debounces saves per photo and never lets two saves of the same photo overlap or overtake each other. */
export class PhotoSaveQueue {
  private readonly debouncers = new Map<string, Debouncer>();
  private readonly latestSaves = new Map<string, Promise<void>>();
  private readonly runningSaves = new Set<Promise<void>>();
  private readonly failedPaths = new Set<string>();

  constructor(
    private readonly delayMs: number,
    private readonly save: (path: string) => Promise<void>,
  ) {}

  schedule(path: string): void {
    const debouncer = this.debouncers.get(path) ?? this.createDebouncer(path);
    debouncer.schedule();
  }

  async flush(path: string): Promise<void> {
    if (this.cancelScheduled(path)) await this.run(path);
    await Promise.allSettled([this.latestSaves.get(path)]);
    if (this.failedPaths.has(path)) await this.run(path);
  }

  async flushAll(): Promise<void> {
    const paths = new Set(this.debouncers.keys());
    for (const path of paths) this.cancelScheduled(path);
    await Promise.allSettled([...this.runningSaves]);
    for (const path of this.failedPaths) paths.add(path);
    await Promise.all([...paths].map((path) => this.run(path)));
  }

  private createDebouncer(path: string): Debouncer {
    const debouncer = new Debouncer(this.delayMs, () => {
      this.debouncers.delete(path);
      void this.run(path);
    });
    this.debouncers.set(path, debouncer);
    return debouncer;
  }

  private cancelScheduled(path: string): boolean {
    const debouncer = this.debouncers.get(path);
    if (!debouncer) return false;
    debouncer.cancel();
    this.debouncers.delete(path);
    return true;
  }

  private run(path: string): Promise<void> {
    const previous = this.latestSaves.get(path) ?? Promise.resolve();
    const save = previous.catch(() => {}).then(() => this.save(path));
    this.latestSaves.set(path, save);
    this.runningSaves.add(save);
    void save
      .then(
        () => {
          this.failedPaths.delete(path);
        },
        (error) => {
          this.failedPaths.add(path);
          console.error("Failed to persist photo edit", error);
        },
      )
      .finally(() => {
        this.runningSaves.delete(save);
        if (this.latestSaves.get(path) === save) this.latestSaves.delete(path);
      });
    return save;
  }
}

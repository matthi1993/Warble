export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly action: () => void,
  ) {}

  get pending(): boolean {
    return this.timer !== null;
  }

  schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.action();
    }, this.delayMs);
  }

  flush(): void {
    if (!this.pending) return;
    this.cancel();
    this.action();
  }

  cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

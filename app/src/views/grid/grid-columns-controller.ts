const STORAGE_KEY = "pf-grid-columns";
const DEFAULT_COLUMNS = 6;

export interface GridColumnsHost {
  requestUpdate(): void;
}

export interface ColumnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The number of thumbnails per row, remembered between sessions. */
export class GridColumnsController {
  static readonly MIN = 1;
  static readonly MAX = 8;

  count: number;

  constructor(
    private readonly host: GridColumnsHost,
    private readonly storage: ColumnStorage,
  ) {
    this.count = this.readStoredColumns();
  }

  /** The slider is inverted: dragging right gives fewer, larger thumbnails. */
  get sliderValue(): number {
    return GridColumnsController.MIN + GridColumnsController.MAX - this.count;
  }

  setFromSlider(sliderValue: number): void {
    this.setColumns(GridColumnsController.MIN + GridColumnsController.MAX - sliderValue);
  }

  setColumns(count: number): void {
    const clamped = this.clamp(count);
    if (clamped === this.count) return;
    this.count = clamped;
    this.host.requestUpdate();
    try {
      this.storage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // Storage can be full or blocked; the size then lasts for this session only.
    }
  }

  private readStoredColumns(): number {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      const stored = raw == null ? NaN : Number(raw);
      return Number.isFinite(stored) ? this.clamp(stored) : DEFAULT_COLUMNS;
    } catch {
      return DEFAULT_COLUMNS;
    }
  }

  private clamp(count: number): number {
    return Math.min(GridColumnsController.MAX, Math.max(GridColumnsController.MIN, Math.round(count)));
  }
}

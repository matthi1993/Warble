import {
  DEFAULT_VIEW_STATE,
  type BgColor,
  type FrameRadius,
  type FrameSize,
  type ProofingSize,
  type SizingMode,
  type SmoothingQuality,
  type ViewState,
  type ViewStateStore,
} from "@app/state/view-state-store";
import type { CanvasAccessor } from "./full-view-canvas";
import type { MenuController } from "./menu-controller";
import type { UpdateHost } from "./update-host";

const COLOR_CSS: Record<BgColor, string> = { black: "#000", grey: "#808080", white: "#fff" };

export class ViewStateController {
  private current: ViewState = { ...DEFAULT_VIEW_STATE };
  /** Nothing is saved before the persisted state has been read, so defaults cannot overwrite it. */
  private hydrated = false;

  constructor(
    private readonly host: UpdateHost,
    private readonly store: Pick<ViewStateStore, "load" | "save">,
    private readonly menus: MenuController,
    private readonly canvas: CanvasAccessor,
  ) {}

  get value(): ViewState {
    return this.current;
  }

  get backgroundCss(): string {
    return this.colorCss(this.current.bg);
  }

  get foregroundCss(): string {
    return this.current.bg === "white" ? "#000" : "#fff";
  }

  async hydrate(): Promise<void> {
    const persisted = await this.store.load();
    this.hydrated = true;
    this.change(persisted);
  }

  setBackground(bg: BgColor): void {
    this.change({ bg });
    this.menus.close();
  }

  setProofingSize(proofingSize: ProofingSize): void {
    this.changeOrResetView({ proofingSize });
  }

  setFrameSize(frameSize: FrameSize): void {
    this.changeOrResetView({ frameSize });
  }

  setFrameColor(frameColor: BgColor): void {
    this.change({ frameColor });
  }

  setFrameRadius(frameRadius: FrameRadius): void {
    this.change({ frameRadius });
  }

  setSizing(sizing: SizingMode): void {
    this.changeOrResetView({ sizing });
  }

  toggleAutoRotate(): void {
    this.change({ autoRotate: !this.current.autoRotate });
  }

  setSmoothing(smoothing: SmoothingQuality): void {
    this.change({ smoothing });
  }

  colorCss(color: BgColor): string {
    return COLOR_CSS[color];
  }

  colorLabel(color: BgColor): string {
    return color.charAt(0).toUpperCase() + color.slice(1);
  }

  /** Choosing the value that is already active recentres the image instead. */
  private changeOrResetView(patch: Partial<ViewState>): void {
    if (!this.change(patch)) this.canvas()?.resetView();
  }

  private change(patch: Partial<ViewState>): boolean {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const next: ViewState = { ...this.current, ...defined };
    const changed = (Object.keys(next) as (keyof ViewState)[]).some((key) => next[key] !== this.current[key]);
    if (!changed) return false;
    this.current = next;
    this.host.requestUpdate();
    if (this.hydrated) void this.store.save(next);
    return true;
  }
}

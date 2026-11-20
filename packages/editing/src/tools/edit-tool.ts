import type { EditingContext } from "../editing-context";
import type { ToolCanvasOverrides, ToolHost, ToolKeyEvent, ToolScope } from "./tool-host";

/**
 * One editing tool without its UI. Subclasses override only the hooks they need;
 * after changing state they call `host.requestUpdate()` so the host can re-render.
 */
export abstract class EditTool {
  abstract readonly id: string;

  cardOpen = false;
  /** Set by the host while this tool owns the canvas. */
  active = false;

  constructor(
    readonly scope: ToolScope,
    protected readonly context: EditingContext,
  ) {}

  isEffectDisabled(host: ToolHost, toggleId: string = this.id): boolean {
    return !this.context.toggles.isEnabled(this.scope, host.editTarget, toggleId);
  }

  toggleEffect(host: ToolHost, toggleId: string = this.id): void {
    this.context.toggles.toggle(this.scope, host.editTarget, toggleId);
  }

  setCardOpen(host: ToolHost, open: boolean): void {
    this.cardOpen = open;
    host.requestUpdate();
  }

  activate(_host: ToolHost): void {}

  /** Called on every way out of the tool; should save pending work and clear overlays. */
  deactivate(_host: ToolHost): void {}

  /** Refreshes the tool's own working values after the edit target changed. */
  syncFromStore(_target: string | null): void {}

  abstract hasEdits(target: string): boolean;

  abstract reset(host: ToolHost): void | Promise<void>;

  /** Copy: a serialisable snapshot only this tool's `applyEdit` understands, or `null` for nothing to copy. */
  serializeEdit(_target: string): unknown | null {
    return null;
  }

  /** Paste: `data` is an earlier `serializeEdit` result; `null` clears this tool's edit. */
  applyEdit(_host: ToolHost, _data: unknown): void | Promise<void> {}

  applyToCanvas(): ToolCanvasOverrides {
    return {};
  }

  /** Returns `true` when the key was consumed and the host must not handle it. */
  handleKey(_event: ToolKeyEvent, _host: ToolHost): boolean {
    return false;
  }

  onCanvasCropChange(_host: ToolHost): void {}

  onCanvasOrientationFlip(_host: ToolHost): void {}

  onCanvasHorizonLine(_host: ToolHost, _delta: number): void {}
}

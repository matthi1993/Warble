/**
 * Shared controller contract for editing tools.
 *
 * Each concrete tool (crop, tone, …) owns its own local UI state
 * (sliders, frame, preset selection) and renders its own side-panel
 * card. The host (`pf-full-view`) only knows the `EditTool` shape —
 * it can iterate over a list of tools without caring how any of
 * them work internally.
 *
 * Adding a new tool means writing a subclass that:
 *   - picks a stable `id`,
 *   - implements `renderCard(host)`,
 *   - decides what to do on activation/deactivation/reset,
 *   - optionally contributes overrides to the canvas via
 *     `applyToCanvas()`,
 *   - optionally hooks keyboard / canvas events.
 *
 * Tools mutate their own fields freely; when state changes they
 * call `host.requestUpdate()` to make the shell re-render.
 */
import type { TemplateResult } from "lit";
import { isEffectEnabled, setEffectEnabled } from "./effect-enabled";
export type ToolScope = "photo" | "post";
export type EditorImageSizing = "fit" | "fill" | "hybrid";

export interface EditorCanvas {
  getCropFrame(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

/** Slice of `pf-full-view` exposed to tools. Keeps the coupling
 *  explicit and unit-testable. */
export interface ToolHost {
  /** Path of the file currently displayed by the canvas (i.e. the
   *  resolved variant). Edits attach to this path. */
  readonly editTarget: string | null;
  /** The canvas element, if mounted. Tools occasionally need it to
   *  read the live crop frame or call `resetView()`. */
  readonly canvas: EditorCanvas | null;
  /** Trigger a Lit re-render of the shell. */
  requestUpdate(): void;
  /** Reveal the edit side panel (windowed-mode toggle + fullscreen
   *  visibility), so a card opened via keyboard shortcut is actually
   *  visible. */
  revealEditPanel(): void;
  /** Flush the edit-store's debounced persist for `editTarget`. Tools
   *  call this on deactivate so the next navigation sees committed
   *  state. */
  flushActiveEdit(): Promise<void> | void;
  /** Mark a tool as the shell's active (canvas-owning) tool, or
   *  clear with `null`. Tools that hand off canvas control on card
   *  open/close (notably the crop tool) call this so the shell's
   *  bookkeeping stays in sync with their lifecycle. */
  setActiveTool(toolId: string | null): void;
}

/** Canvas property overrides a tool can contribute while active. The
 *  host merges these into the `<pf-image-canvas>` bindings. */
export interface ToolCanvasOverrides {
  cropMode?: boolean;
  cropAspect?: number | null;
  rotation?: number;
  horizonMode?: boolean;
  /** Force a specific sizing while the tool is active (e.g. crop
   *  pins `"fit"` so the frame is always fully visible). */
  sizing?: EditorImageSizing;
}

/**
 * Lifecycle: `activate` runs when the user enters the tool (e.g.
 * opens its card or its hotkey). `deactivate` runs on exit (ESC,
 * Enter, navigation, card-close, tool switch). Every other method
 * has a no-op default so simple tools only override what they need.
 */
export abstract class EditTool {
  /** Stable, lowercase identifier (`"crop"`, `"tone"`, …). Used by
   *  the shell to address tools and decide active-state. */
  abstract readonly id: string;

  constructor(readonly scope: ToolScope = "photo") {}

  /** True when the side-panel card is expanded. The shell renders
   *  every tool's card unconditionally — the tool decides its own
   *  open/closed visual via `renderCard`. */
  cardOpen = false;

  protected effectDisabled(host: ToolHost, id = this.id): boolean {
    return !isEffectEnabled(this.scope, host.editTarget, id);
  }

  protected toggleEffect(host: ToolHost, id = this.id): void {
    setEffectEnabled(this.scope, host.editTarget, id, this.effectDisabled(host, id));
  }

  /** Set by the shell when this tool is the focused/interactive one. */
  active = false;

  // ---- Lifecycle ----------------------------------------------------

  /** Called when the tool becomes active (card opened or focused). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  activate(_host: ToolHost): void {}

  /** Called when the tool is dismissed. Should flush any debounced
   *  persists and clear interactive overlays. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deactivate(_host: ToolHost): void {}

  /** Re-hydrate the tool's local mirror from the persisted edit on
   *  `target` (or to defaults when `target` is null / has no edit). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  syncFromStore(_target: string | null): void {}

  // ---- Edit state introspection -------------------------------------

  /** Does `target` have a persisted edit owned by this tool? Used to
   *  enable Revert and the before/after preview affordances. */
  abstract hasEdits(target: string): boolean;

  /** Drop this tool's persisted edits on the active target. */
  abstract reset(host: ToolHost): void | Promise<void>;

  // ---- Copy / paste -------------------------------------------------

  /** Snapshot this tool's persisted edit on `target` into a
   *  serialisable blob, or return `null` when there is nothing to
   *  copy. The shape is opaque to the shell — only this tool's
   *  `applyEdit` needs to understand it. Defaults to "nothing to
   *  copy" so tools opt in. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  serializeEdit(_target: string): unknown | null {
    return null;
  }

  /** Apply a previously serialised edit blob to the host's current
   *  target. `data` will be one of this tool's own `serializeEdit`
   *  outputs (or `null`, in which case implementations should clear
   *  the corresponding edit). Defaults to a no-op. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  applyEdit(_host: ToolHost, _data: unknown): void | Promise<void> {}


  // ---- Rendering ----------------------------------------------------

  /** Tool's side-panel card. */
  abstract renderCard(host: ToolHost): TemplateResult;

  /** Canvas property overrides this tool wants in effect while
   *  active. The default returns an empty object — non-active tools
   *  contribute nothing. */
  applyToCanvas(): ToolCanvasOverrides {
    return {};
  }

  // ---- Event hooks --------------------------------------------------

  /** Handle a keyboard event when this tool is active. Return `true`
   *  to indicate the event was consumed; the shell will then skip
   *  its global handler. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleKey(_e: KeyboardEvent, _host: ToolHost): boolean {
    return false;
  }

  /** Canvas dispatched `crop-change`. Default: ignore. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onCanvasCropChange(_host: ToolHost): void {}

  /** Canvas dispatched `orientation-flip` (corner-drag inverted
   *  dominant axis). Default: ignore. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onCanvasOrientationFlip(_host: ToolHost): void {}

  /** Canvas dispatched `horizon-line` with a degree correction.
   *  Default: ignore. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onCanvasHorizonLine(_host: ToolHost, _delta: number): void {}
}

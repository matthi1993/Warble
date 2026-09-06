/**
 * `pf-curve-editor` — reusable tone curve editor.
 *
 * Renders an interactive 0..1 curve grid with draggable control
 * points for a single channel at a time. A row of small icon
 * buttons above the grid switches between channels (RGB combined,
 * R, G, B, and Luma).
 *
 * The element is controlled: it never mutates the incoming `value`
 * prop directly. Drag interactions emit `curve-change` events with
 * the full updated `CurveEdit`. Right-clicking a point removes it.
 * Clicking the grid background inserts a new point at the cursor.
 *
 * Events:
 *  - `curve-change` (detail: `CurveEdit`) — emitted on every commit
 *    of a drag / insert / delete.
 *  - `curve-reset-channel` (detail: `CurveChannel`) — emitted when
 *    the user double-clicks the active channel button to reset it
 *    to identity.
 */
import { LitElement, css, html, svg, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  CURVE_CHANNELS,
  buildChannelLut,
  defaultCurve,
  identityCurveChannel,
  isCurveChannelIdentity,
  type CurveChannel,
  type CurveEdit,
  type CurvePoint,
} from "@domain/edits";

const W = 240;
const H = 240;
const PADDING = 8;

const CHANNEL_LABEL: Record<CurveChannel, string> = {
  rgb: "RGB",
  r: "Red",
  g: "Green",
  b: "Blue",
  luma: "Luma",
};

/** SVG color used for the curve stroke (and handle ring) of each
 *  channel. Luma uses neutral grey rather than yellow — yellow used
 *  to imply "this is the luminance channel = sun = warm", but it
 *  reads as a colour cast and the curve itself isn't coloured at
 *  all (it modulates intensity, not hue). */
const CHANNEL_STROKE: Record<CurveChannel, string> = {
  rgb: "var(--pf-text)",
  r: "#e25c5c",
  g: "#4caf50",
  b: "#5187d8",
  luma: "#cccccc",
};

@customElement("pf-curve-editor")
export class PfCurveEditor extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .channels {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
    .channels button {
      flex: 1;
      background: transparent;
      border: 1px solid var(--pf-border);
      color: var(--pf-text-muted);
      border-radius: 4px;
      padding: 4px 0;
      font-size: 0.7rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .channels button.active {
      background: var(--pf-surface-hover);
      color: var(--pf-text);
      border-color: var(--pf-border-strong, var(--pf-border));
    }
    .channels .swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    .grid {
      position: relative;
      width: 100%;
      aspect-ratio: 1 / 1;
      max-width: ${W}px;
      margin: 0 auto;
      background: var(--pf-surface-2, rgba(0, 0, 0, 0.25));
      border: 1px solid var(--pf-border);
      border-radius: 4px;
      overflow: hidden;
      user-select: none;
      touch-action: none;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .gridline {
      stroke: var(--pf-text-muted);
      stroke-width: 1;
      opacity: 0.55;
    }
    .gridline.minor {
      opacity: 0.25;
    }
    .diagonal {
      stroke: var(--pf-text-muted);
      stroke-width: 1;
      stroke-dasharray: 3 3;
      opacity: 0.6;
    }
    .curve {
      fill: none;
      stroke-width: 1.5;
    }
    .handle {
      cursor: grab;
    }
    .handle:active {
      cursor: grabbing;
    }
    .handle circle {
      fill: var(--pf-bg, #1a1a1a);
      stroke-width: 1.5;
    }
  `;

  @property({ attribute: false })
  value: CurveEdit = defaultCurve();

  @state()
  private activeChannel: CurveChannel = "rgb";

  @state()
  private dragIndex: number | null = null;

  /**
   * Optimistic copy of `value` updated synchronously on every drag
   * tick. Lit's prop updates from the host arrive a frame late, so
   * if we read `this.value` mid-drag we'd build the next move from
   * stale points (which is exactly what made handles jitter / lag
   * behind the cursor). While `draft` is non-null it shadows
   * `value` for both rendering and mutation.
   */
  @state()
  private draft: CurveEdit | null = null;

  /** Read the live curve (draft if a drag is in progress, otherwise
   *  the upstream-controlled `value`). */
  private get currentValue(): CurveEdit {
    return this.draft ?? this.value;
  }

  /** Pointer offset captured at drag start to keep the grab anchor
   *  stable as the cursor moves. */
  private dragDx = 0;
  private dragDy = 0;

  render(): TemplateResult {
    const pts = this.currentValue[this.activeChannel];
    const stroke = CHANNEL_STROKE[this.activeChannel];
    return html`
      <div class="channels">
        ${CURVE_CHANNELS.map(
          (ch) => html`
            <button
              type="button"
              class=${ch === this.activeChannel ? "active" : ""}
              title=${CHANNEL_LABEL[ch]}
              @click=${() => (this.activeChannel = ch)}
              @dblclick=${() => this.resetChannel(ch)}
            >
              <span
                class="swatch"
                style="background:${CHANNEL_STROKE[ch]}"
              ></span>
              ${CHANNEL_LABEL[ch]}
            </button>
          `
        )}
      </div>
      <div class="grid" @pointerdown=${this.onGridPointerDown}>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          ${this.renderGridLines()} ${this.renderHistogramPath(pts, stroke)}
          ${this.renderHandles(pts, stroke)}
        </svg>
      </div>
    `;
  }

  // --- rendering helpers ------------------------------------------

  private renderGridLines() {
    const lines: TemplateResult[] = [];
    // Two tiers: bold quartile lines and faint eighth-lines. The
    // finer grid makes it much easier to spot whether the curve
    // sits exactly on the diagonal when comparing channels.
    for (let i = 1; i < 8; i++) {
      const x = PADDING + ((W - 2 * PADDING) * i) / 8;
      const y = PADDING + ((H - 2 * PADDING) * i) / 8;
      const cls = i % 2 === 0 ? "gridline" : "gridline minor";
      lines.push(
        svg`<line class=${cls} x1=${x} y1=${PADDING} x2=${x} y2=${H - PADDING}></line>`
      );
      lines.push(
        svg`<line class=${cls} x1=${PADDING} y1=${y} x2=${W - PADDING} y2=${y}></line>`
      );
    }
    lines.push(
      svg`<line class="diagonal" x1=${PADDING} y1=${H - PADDING} x2=${W - PADDING} y2=${PADDING}></line>`
    );
    return svg`${lines}`;
  }

  private renderHistogramPath(pts: readonly CurvePoint[], stroke: string) {
    // Build a smooth-ish curve by sampling the LUT (256 points).
    const lut = buildChannelLut(pts);
    let d = "";
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const v = lut[i] / 255;
      const x = this.toCanvasX(t);
      const y = this.toCanvasY(v);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    return svg`<path class="curve" d=${d} stroke=${stroke}></path>`;
  }

  private renderHandles(pts: readonly CurvePoint[], stroke: string) {
    return svg`${pts.map(
      (p, i) => svg`
        <g class="handle" data-i=${i} @pointerdown=${(e: PointerEvent) =>
          this.onHandlePointerDown(e, i)}
          @contextmenu=${(e: MouseEvent) => this.onHandleContextMenu(e, i)}
          @dblclick=${(e: MouseEvent) => this.onHandleDoubleClick(e, i)}>
          <circle
            cx=${this.toCanvasX(p.x)}
            cy=${this.toCanvasY(p.y)}
            r="5"
            stroke=${stroke}
          ></circle>
        </g>
      `
    )}`;
  }

  // --- coordinate helpers -----------------------------------------

  private toCanvasX(t: number): number {
    return PADDING + (W - 2 * PADDING) * t;
  }
  private toCanvasY(v: number): number {
    return H - PADDING - (H - 2 * PADDING) * v;
  }
  private fromCanvasX(x: number): number {
    return Math.max(0, Math.min(1, (x - PADDING) / (W - 2 * PADDING)));
  }
  private fromCanvasY(y: number): number {
    return Math.max(0, Math.min(1, 1 - (y - PADDING) / (H - 2 * PADDING)));
  }

  /** Map a client (px) coordinate inside the grid element to SVG
   *  viewBox coordinates. */
  private clientToSvg(e: PointerEvent, host: HTMLElement): { x: number; y: number } {
    const rect = host.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    return { x, y };
  }

  // --- interaction ------------------------------------------------

  private onGridPointerDown = (e: PointerEvent) => {
    // Only handle plain clicks on the grid background — handles
    // claim their own pointerdown via stopPropagation.
    if (e.button !== 0) return;
    const host = e.currentTarget as HTMLElement;
    const { x, y } = this.clientToSvg(e, host);
    const tx = this.fromCanvasX(x);
    const ty = this.fromCanvasY(y);
    const { points, insertedAt } = this.insertPoint(tx, ty);
    if (insertedAt < 0) {
      // Click landed on top of an existing point's x-coordinate;
      // just bail rather than rejecting silently.
      return;
    }
    // Start the drag BEFORE dispatching the change so the listener
    // setup races ahead of the host's re-render. The cursor offset
    // is exactly zero (we inserted under the cursor) so subsequent
    // moves track it 1:1.
    this.beginDrag(host, insertedAt, 0, 0, points);
    this.flushDraft();
    host.setPointerCapture(e.pointerId);
  };

  private onHandlePointerDown = (e: PointerEvent, idx: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const grid = (e.currentTarget as Element).closest(
      ".grid"
    ) as HTMLElement | null;
    if (!grid) return;
    const pts = this.currentValue[this.activeChannel];
    const p = pts[idx];
    const { x, y } = this.clientToSvg(e, grid);
    const dx = this.toCanvasX(p.x) - x;
    const dy = this.toCanvasY(p.y) - y;
    this.beginDrag(grid, idx, dx, dy, pts);
    grid.setPointerCapture(e.pointerId);
  };

  private onHandleContextMenu = (e: MouseEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    this.removePoint(idx);
  };

  private onHandleDoubleClick = (e: MouseEvent, idx: number) => {
    // Double-click on a handle removes the point — same rules as
    // right-click. Endpoints are preserved (they anchor the curve).
    e.preventDefault();
    e.stopPropagation();
    this.removePoint(idx);
  };

  private removePoint(idx: number): void {
    const pts = this.currentValue[this.activeChannel];
    if (idx === 0 || idx === pts.length - 1) return;
    const next = pts.filter((_, i) => i !== idx);
    this.setChannel(next);
    this.flushDraft();
  }

  /** Set up the drag bookkeeping + pointermove/up handlers. `pts` is
   *  the channel-points array that already contains the point being
   *  dragged (so on insert the caller passes the post-insert array). */
  private beginDrag(
    grid: HTMLElement,
    idx: number,
    dx: number,
    dy: number,
    pts: readonly CurvePoint[]
  ): void {
    // Seed the draft so subsequent moves read consistent state.
    this.draft = { ...this.currentValue, [this.activeChannel]: pts };
    this.dragIndex = idx;
    this.dragDx = dx;
    this.dragDy = dy;
    const onMove = (ev: PointerEvent) => this.onDragMove(ev, grid);
    const onUp = (ev: PointerEvent) => {
      if (grid.hasPointerCapture(ev.pointerId))
        grid.releasePointerCapture(ev.pointerId);
      grid.removeEventListener("pointermove", onMove);
      grid.removeEventListener("pointerup", onUp);
      grid.removeEventListener("pointercancel", onUp);
      this.dragIndex = null;
      // Clear the draft now that the host has the final value.
      this.draft = null;
    };
    grid.addEventListener("pointermove", onMove);
    grid.addEventListener("pointerup", onUp);
    grid.addEventListener("pointercancel", onUp);
  }

  private onDragMove(e: PointerEvent, grid: HTMLElement) {
    if (this.dragIndex == null) return;
    const { x, y } = this.clientToSvg(e, grid);
    const cx = x + this.dragDx;
    const cy = y + this.dragDy;
    const pts = this.currentValue[this.activeChannel];
    const idx = this.dragIndex;
    let nx = this.fromCanvasX(cx);
    const ny = this.fromCanvasY(cy);
    // Endpoints are pinned on the x axis but free on y so the user
    // can lift blacks / clip whites by dragging the corner handles.
    if (idx === 0) nx = 0;
    else if (idx === pts.length - 1) nx = 1;
    else {
      // Keep order: clamp between neighbours with a tiny gap.
      const gap = 1 / 255;
      nx = Math.max(pts[idx - 1].x + gap, Math.min(pts[idx + 1].x - gap, nx));
    }
    const next = pts.map((p, i) => (i === idx ? { x: nx, y: ny } : p));
    this.setChannel(next);
    this.flushDraft();
  }

  // --- mutation helpers -------------------------------------------

  /** Insert a new control point, keeping x order. Returns both the
   *  resulting array and the index at which the new point landed so
   *  the caller can immediately attach a drag to it (no findIndex
   *  round-trip needed). `insertedAt === -1` means the point was
   *  rejected (too close to an existing one). */
  private insertPoint(
    tx: number,
    ty: number
  ): { points: CurvePoint[]; insertedAt: number } {
    const pts = [...this.currentValue[this.activeChannel]];
    const gap = 2 / 255;
    for (const p of pts) {
      if (Math.abs(p.x - tx) < gap) return { points: pts, insertedAt: -1 };
    }
    let i = 0;
    while (i < pts.length && pts[i].x < tx) i++;
    pts.splice(i, 0, { x: tx, y: ty });
    return { points: pts, insertedAt: i };
  }

  /** Update the draft for the active channel. Does NOT dispatch —
   *  call `flushDraft()` to push to the host. */
  private setChannel(pts: readonly CurvePoint[]): void {
    const base = this.currentValue;
    this.draft = { ...base, [this.activeChannel]: pts };
  }

  /** Push the current draft to the host. We always send the latest
   *  value so the host can persist; clearing the draft is handled
   *  by the pointerup handler. */
  private flushDraft(): void {
    if (!this.draft) return;
    this.dispatchEvent(
      new CustomEvent<CurveEdit>("curve-change", {
        detail: this.draft,
        bubbles: true,
        composed: true,
      })
    );
  }

  private resetChannel(ch: CurveChannel) {
    if (isCurveChannelIdentity(this.currentValue[ch])) return;
    const next: CurveEdit = {
      ...this.currentValue,
      [ch]: identityCurveChannel(),
    };
    this.draft = null;
    this.dispatchEvent(
      new CustomEvent<CurveEdit>("curve-change", {
        detail: next,
        bubbles: true,
        composed: true,
      })
    );
    this.dispatchEvent(
      new CustomEvent<CurveChannel>("curve-reset-channel", {
        detail: ch,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-curve-editor": PfCurveEditor;
  }
}

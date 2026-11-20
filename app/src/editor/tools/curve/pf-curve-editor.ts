import { LitElement, html, svg, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  CURVE_CHANNELS,
  buildChannelLut,
  defaultCurve,
  type CurveChannel,
  type CurveEdit,
  type CurvePoint,
} from "@warble/render";
import { CurveEditorController } from "./curve-editor-controller";
import { CurveGridGeometry } from "./curve-grid-geometry";
import { curveEditorStyles } from "./pf-curve-editor.styles";

const GRID_DIVISIONS = 8;

const CHANNEL_LABEL: Record<CurveChannel, string> = {
  rgb: "RGB",
  r: "Red",
  g: "Green",
  b: "Blue",
  luma: "Luma",
};

const CHANNEL_STROKE: Record<CurveChannel, string> = {
  rgb: "var(--pf-text)",
  r: "#e25c5c",
  g: "#4caf50",
  b: "#5187d8",
  luma: "#cccccc",
};

/**
 * Controlled curve editor: never changes `value` itself.
 * Emits `curve-change` (the whole `CurveEdit`) and `curve-reset-channel` (the `CurveChannel`).
 */
@customElement("pf-curve-editor")
export class PfCurveEditor extends LitElement {
  static styles = curveEditorStyles;

  @property({ attribute: false })
  value: CurveEdit = defaultCurve();

  private readonly geometry = new CurveGridGeometry();

  private readonly controller = new CurveEditorController(
    {
      currentValue: () => this.value,
      requestUpdate: () => this.requestUpdate(),
      emitChange: (curve) => this.emit<CurveEdit>("curve-change", curve),
      emitChannelReset: (channel) => this.emit<CurveChannel>("curve-reset-channel", channel),
    },
    this.geometry,
  );

  private emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  private onGridPointerDown = (event: PointerEvent) => {
    this.controller.insertPoint(event, event.currentTarget as HTMLElement);
  };

  private onGridPointerMove = (event: PointerEvent) => {
    this.controller.dragTo(event, event.currentTarget as HTMLElement);
  };

  private onGridPointerEnd = (event: PointerEvent) => {
    this.controller.endDrag(event, event.currentTarget as HTMLElement);
  };

  /** A handle that takes the pointer keeps it from the grid, which would insert a second point. */
  private onHandlePointerDown(event: PointerEvent, index: number): void {
    const grid = (event.currentTarget as Element).closest<HTMLElement>(".grid");
    if (grid && this.controller.grabPoint(index, event, grid)) event.stopPropagation();
  }

  private onHandleRemove(event: MouseEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.controller.removePoint(index);
  }

  render(): TemplateResult {
    const controller = this.controller;
    const points = controller.points;
    const stroke = CHANNEL_STROKE[controller.activeChannel];
    const size = this.geometry.size;
    return html`
      <div class="channels">
        ${CURVE_CHANNELS.map(
          (channel) => html`
            <button
              type="button"
              class=${channel === controller.activeChannel ? "active" : ""}
              title=${CHANNEL_LABEL[channel]}
              @click=${() => controller.selectChannel(channel)}
              @dblclick=${() => controller.resetChannel(channel)}
            >
              <span class="swatch" style="background:${CHANNEL_STROKE[channel]}"></span>
              ${CHANNEL_LABEL[channel]}
            </button>
          `,
        )}
      </div>
      <div
        class="grid"
        @pointerdown=${this.onGridPointerDown}
        @pointermove=${this.onGridPointerMove}
        @pointerup=${this.onGridPointerEnd}
        @pointercancel=${this.onGridPointerEnd}
      >
        <svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="none">
          ${this.renderGridLines()} ${this.renderCurve(points, stroke)} ${this.renderHandles(points, stroke)}
        </svg>
      </div>
    `;
  }

  private renderGridLines() {
    const { start, end } = this.geometry;
    const lines: TemplateResult[] = [];
    for (let division = 1; division < GRID_DIVISIONS; division++) {
      const offset = this.geometry.toGridX(division / GRID_DIVISIONS);
      const lineClass = division % 2 === 0 ? "gridline" : "gridline minor";
      lines.push(svg`<line class=${lineClass} x1=${offset} y1=${start} x2=${offset} y2=${end}></line>`);
      lines.push(svg`<line class=${lineClass} x1=${start} y1=${offset} x2=${end} y2=${offset}></line>`);
    }
    lines.push(svg`<line class="diagonal" x1=${start} y1=${end} x2=${end} y2=${start}></line>`);
    return svg`${lines}`;
  }

  private renderCurve(points: readonly CurvePoint[], stroke: string) {
    const lut = buildChannelLut(points);
    let path = "";
    for (let level = 0; level < 256; level++) {
      const x = this.geometry.toGridX(level / 255);
      const y = this.geometry.toGridY(lut[level] / 255);
      path += level === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    return svg`<path class="curve" d=${path} stroke=${stroke}></path>`;
  }

  private renderHandles(points: readonly CurvePoint[], stroke: string) {
    return svg`${points.map(
      (point, index) => svg`
        <g
          class="handle"
          data-i=${index}
          @pointerdown=${(event: PointerEvent) => this.onHandlePointerDown(event, index)}
          @contextmenu=${(event: MouseEvent) => this.onHandleRemove(event, index)}
          @dblclick=${(event: MouseEvent) => this.onHandleRemove(event, index)}
        >
          <circle
            cx=${this.geometry.toGridX(point.x)}
            cy=${this.geometry.toGridY(point.y)}
            r="5"
            stroke=${stroke}
          ></circle>
        </g>
      `,
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-curve-editor": PfCurveEditor;
  }
}

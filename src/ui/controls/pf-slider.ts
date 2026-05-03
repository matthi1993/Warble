/**
 * Bipolar slider with a "0" detent: the track shows a centred zero
 * marker and the portion of the track between 0 and the current value
 * is highlighted in the accent colour, so positive vs. negative offsets
 * are visible at a glance.
 *
 * Emits a bubbling `change` event (not a native input event) carrying
 * the parsed numeric value so consumers can wire `@change`/`@input`
 * uniformly. The native range input under the hood is what owns
 * keyboard + drag interaction; we only restyle.
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("pf-slider")
export class PfSlider extends LitElement {
  static styles = css`
    :host {
      display: block;
      --pf-slider-track: var(--pf-border-strong, rgba(127, 127, 127, 0.6));
      --pf-slider-fill: var(--pf-accent, #4a90e2);
      --pf-slider-thumb: var(--pf-text, #fff);
      --pf-slider-tick: var(--pf-border-strong, rgba(127, 127, 127, 0.8));
      --pf-slider-height: 4px;
      --pf-slider-thumb-size: 14px;
    }
    .wrap {
      position: relative;
      height: var(--pf-slider-thumb-size);
      display: flex;
      align-items: center;
    }
    .track {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      height: var(--pf-slider-height);
      background: var(--pf-slider-track);
      border-radius: 999px;
      pointer-events: none;
    }
    /* The accent fill is positioned between the zero point and the
       current thumb position. We compute both "left" and "right" from
       the host so it works on both sides of zero with the same rules. */
    .fill {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      height: var(--pf-slider-height);
      background: var(--pf-slider-fill);
      border-radius: 999px;
      pointer-events: none;
    }
    /* Centre zero marker: a vertical tick across the track. */
    .zero {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 2px;
      height: calc(var(--pf-slider-thumb-size) - 2px);
      background: var(--pf-slider-tick);
      transform: translate(-50%, -50%);
      border-radius: 1px;
      pointer-events: none;
    }
    /* The native input is fully transparent and stretched over the
       track so it owns hit-testing and keyboard input. We just paint
       the visuals beneath. */
    input[type="range"] {
      position: relative;
      width: 100%;
      margin: 0;
      background: transparent;
      -webkit-appearance: none;
      appearance: none;
      height: var(--pf-slider-thumb-size);
      cursor: pointer;
    }
    input[type="range"]:focus {
      outline: none;
    }
    input[type="range"]::-webkit-slider-runnable-track {
      background: transparent;
      height: var(--pf-slider-height);
      border: none;
    }
    input[type="range"]::-moz-range-track {
      background: transparent;
      height: var(--pf-slider-height);
      border: none;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: var(--pf-slider-thumb-size);
      height: var(--pf-slider-thumb-size);
      border-radius: 999px;
      background: var(--pf-slider-thumb);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4),
        0 1px 3px rgba(0, 0, 0, 0.4);
      margin-top: calc(
        (var(--pf-slider-height) - var(--pf-slider-thumb-size)) / 2
      );
      cursor: grab;
      transition: transform 80ms ease;
    }
    input[type="range"]:active::-webkit-slider-thumb {
      cursor: grabbing;
      transform: scale(1.1);
    }
    input[type="range"]::-moz-range-thumb {
      width: var(--pf-slider-thumb-size);
      height: var(--pf-slider-thumb-size);
      border-radius: 999px;
      background: var(--pf-slider-thumb);
      border: none;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4),
        0 1px 3px rgba(0, 0, 0, 0.4);
      cursor: grab;
    }
    input[type="range"]:focus-visible::-webkit-slider-thumb {
      box-shadow: 0 0 0 2px var(--pf-slider-fill),
        0 1px 3px rgba(0, 0, 0, 0.4);
    }
  `;

  @property({ type: Number })
  min = -100;

  @property({ type: Number })
  max = 100;

  @property({ type: Number })
  step = 1;

  @property({ type: Number })
  value = 0;

  @property({ type: String })
  label = "";

  /** Numeric value at which the accent fill originates. Defaults to 0
   * (bipolar). Use `min` for a unipolar slider. */
  @property({ type: Number, attribute: "fill-from" })
  fillFrom = 0;

  private onInput = (e: Event) => {
    const v = Number((e.target as HTMLInputElement).value);
    this.value = v;
    this.dispatchEvent(
      new CustomEvent<number>("change", {
        detail: v,
        bubbles: true,
        composed: true,
      })
    );
  };

  /** Stop the native `change` event from bubbling out of the slider so
   * consumers don't receive a second, plain (non-custom) `change`
   * whose `event.detail` is 0 — which would silently snap the bound
   * value back to zero on mouse-up. */
  private stopNativeChange = (e: Event) => {
    e.stopPropagation();
  };

  private onDoubleClick = () => {
    if (this.value === this.fillFrom) return;
    this.value = this.fillFrom;
    this.dispatchEvent(
      new CustomEvent<number>("change", {
        detail: this.value,
        bubbles: true,
        composed: true,
      })
    );
  };

  /** Map a value to a percentage along the track [0..1]. */
  private pct(v: number): number {
    if (this.max === this.min) return 0;
    return (v - this.min) / (this.max - this.min);
  }

  render() {
    const fillStart = Math.max(this.min, Math.min(this.max, this.fillFrom));
    const v = Math.max(this.min, Math.min(this.max, this.value));
    const a = this.pct(Math.min(fillStart, v)) * 100;
    const b = this.pct(Math.max(fillStart, v)) * 100;
    const fillStyle = `left: ${a}%; right: ${100 - b}%;`;
    const showZero = this.fillFrom > this.min && this.fillFrom < this.max;
    // Place the zero marker at its actual position along the track
    // rather than always at 50%, so non-symmetric ranges still work.
    const zeroPct = this.pct(fillStart) * 100;
    return html`
      <div class="wrap">
        <div class="track"></div>
        <div class="fill" style=${fillStyle}></div>
        ${showZero
          ? html`<div
              class="zero"
              style="left: ${zeroPct}%; transform: translate(-50%, -50%);"
            ></div>`
          : null}
        <input
          type="range"
          min=${this.min}
          max=${this.max}
          step=${this.step}
          .value=${String(this.value)}
          aria-label=${this.label}
          aria-valuemin=${this.min}
          aria-valuemax=${this.max}
          aria-valuenow=${this.value}
          @input=${this.onInput}
          @change=${this.stopNativeChange}
          @dblclick=${this.onDoubleClick}
        />
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-slider": PfSlider;
  }
}

interface PfSliderEventMap {
  change: CustomEvent<number>;
}

declare global {
  interface HTMLElementEventMap extends PfSliderEventMap {}
}

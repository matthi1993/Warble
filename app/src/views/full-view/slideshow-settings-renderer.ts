import { html, type TemplateResult } from "lit";
import { SLIDESHOW_DURATIONS, type SlideshowTransition } from "@app/state/slideshow-settings-store";
import type { FullViewController } from "./full-view-controller";
import type { SlideshowController } from "./slideshow-controller";

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return seconds < 3600 ? `${seconds / 60}min` : "1h";
}

function applyCustomDuration(slideshow: SlideshowController, event: Event): void {
  const input = event.target as HTMLInputElement;
  if (!slideshow.setCustomDuration(Number(input.value))) input.value = String(slideshow.settings.durationSeconds);
}

export function renderSlideshowSettings(view: FullViewController): TemplateResult {
  const { slideshow } = view;
  const { durationSeconds, transition } = slideshow.settings;
  return html`<section class="slideshow-settings">
    <h2>Slideshow</h2>
    <label for="slide-duration">Time per photo</label>
    <span class="slideshow-select-wrap">
      <select
        id="slide-duration"
        @change=${(event: Event) => slideshow.selectDuration((event.target as HTMLSelectElement).value)}
      >
        ${SLIDESHOW_DURATIONS.map(
          (seconds) => html`<option
            value=${seconds}
            ?selected=${!slideshow.customDuration && durationSeconds === seconds}
          >
            ${durationLabel(seconds)}
          </option>`,
        )}
        <option value="custom" ?selected=${slideshow.customDuration}>Custom</option>
      </select>
      <pf-icon name="chevron-down"></pf-icon>
    </span>
    ${slideshow.customDuration
      ? html`<label for="slide-custom-duration">Seconds per photo</label>
          <input
            id="slide-custom-duration"
            type="number"
            min="1"
            max="86400"
            step="1"
            .value=${String(durationSeconds)}
            @change=${(event: Event) => applyCustomDuration(slideshow, event)}
          />`
      : null}
    <label for="slide-transition">Transition</label>
    <span class="slideshow-select-wrap">
      <select
        id="slide-transition"
        @change=${(event: Event) =>
          slideshow.updateSettings({ transition: (event.target as HTMLSelectElement).value as SlideshowTransition })}
      >
        <option value="fade" ?selected=${transition === "fade"}>Fade</option>
        <option value="instant" ?selected=${transition === "instant"}>Instant</option>
      </select>
      <pf-icon name="chevron-down"></pf-icon>
    </span>
    <button type="button" @click=${() => view.events.slideshowStart()}><pf-icon name="play"></pf-icon> Play</button>
  </section>`;
}

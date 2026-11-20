import { html, type TemplateResult } from "lit";
import type { SizingMode, SmoothingQuality } from "@app/state/view-state-store";
import type { FullViewController } from "./full-view-controller";

const SCALES: ReadonlyArray<{ mode: SizingMode; label: string; hint: string }> = [
  { mode: "fit", label: "Contain", hint: "Image fully visible inside the frame" },
  { mode: "fill", label: "Cover", hint: "Image fills the stage (may crop)" },
  { mode: "hybrid", label: "Hybrid", hint: "Cover when cropping is modest; contain otherwise" },
];
const QUALITIES: readonly SmoothingQuality[] = ["low", "medium", "high"];

function renderPostProcessingSection(view: FullViewController): TemplateResult {
  const enabled = view.editing.postProcessEnabled;
  return html`<div class="settings-section" role="group" aria-label="Post-Processing">
    <span class="settings-section-label">Post-Processing</span>
    <div class="settings-options">
      <button
        class="menu-item"
        type="button"
        aria-pressed=${enabled}
        title="Toggle post-processing"
        @click=${() => view.editing.togglePostProcess()}
      >
        ${enabled ? "On" : "Off"}
      </button>
    </div>
  </div>`;
}

function renderViewSettings(view: FullViewController): TemplateResult {
  const { viewState } = view;
  const { sizing, autoRotate, smoothing } = viewState.value;
  return html`<div class="menu-popup settings-menu view-menu" role="group" aria-label="View settings">
    <div class="settings-section" role="group" aria-label="Scale">
      <span class="settings-section-label">Scale</span>
      <div class="settings-options">
        ${SCALES.map(
          (scale) => html`<button
            class="menu-item"
            type="button"
            aria-pressed=${sizing === scale.mode}
            title=${scale.hint}
            @click=${() => viewState.setSizing(scale.mode)}
          >
            ${scale.label}
          </button>`,
        )}
      </div>
    </div>
    <div class="settings-section" role="group" aria-label="Orientation">
      <span class="settings-section-label">Orientation</span>
      <div class="settings-options">
        <button
          class="menu-item"
          type="button"
          aria-pressed=${autoRotate}
          title="Rotate photos to match the screen orientation; turn the iPad to view upright"
          @click=${() => viewState.toggleAutoRotate()}
        >
          Auto rotate
        </button>
      </div>
    </div>
    <div class="settings-section" role="group" aria-label="Quality">
      <span class="settings-section-label">Quality</span>
      <div class="settings-options">
        ${QUALITIES.map(
          (quality) => html`<button
            class="menu-item"
            type="button"
            aria-pressed=${smoothing === quality}
            @click=${() => viewState.setSmoothing(quality)}
          >
            ${quality.charAt(0).toUpperCase() + quality.slice(1)}
          </button>`,
        )}
      </div>
    </div>
    ${view.stage.activeVideoPath ? null : renderPostProcessingSection(view)}
  </div>`;
}

export function renderViewMenu(view: FullViewController): TemplateResult {
  const open = view.menus.open === "view";
  return html`
    <span class="menu-wrap">
      <button
        class="menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded=${open}
        @click=${() => view.menus.toggle("view")}
      >
        View
        <pf-icon name="chevron-down"></pf-icon>
      </button>
      ${open ? renderViewSettings(view) : null}
    </span>
  `;
}

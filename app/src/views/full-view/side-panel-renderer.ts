import { html, type TemplateResult } from "lit";
import { toolCards } from "@app/editor";
import { renderEditFooter } from "./edit-footer-renderer";
import type { FullViewController } from "./full-view-controller";
import { renderSlideshowSettings } from "./slideshow-settings-renderer";

function renderEditTab(view: FullViewController): TemplateResult {
  const { editing } = view;
  const enabled = editing.editsEnabled;
  return html`
    <div class="edit-enable-row">
      <span>Edit ${enabled ? "enabled" : "disabled"}</span>
      <pf-effect-toggle
        .disabled=${!enabled}
        label="editing"
        @effect-toggle=${() => editing.toggleEditsEnabled()}
      ></pf-effect-toggle>
    </div>
    <div class=${enabled ? "edit-tool-stack" : "edit-tool-stack dim"}>
      ${editing.tools.map((tool) => toolCards.render(tool, editing.toolHost))}
    </div>
  `;
}

function renderTabContent(view: FullViewController): TemplateResult | null {
  switch (view.panel.activeTab) {
    case "info":
      return html`<pf-info-card .exif=${view.exif.exif} ?open=${true}></pf-info-card>`;
    case "edit":
      return renderEditTab(view);
    case "post":
      return html`<pf-post-process-card></pf-post-process-card>`;
    case "slideshow":
      return renderSlideshowSettings(view);
    default:
      return null;
  }
}

export function renderSidePanel(view: FullViewController): TemplateResult {
  return html`
    <pf-edit-side-panel
      aria-label="Edit panel"
      @click=${(event: Event) => event.stopPropagation()}
      @slider-interaction-start=${() => view.canvas()?.beginEditInteraction()}
      @slider-interaction-end=${() => view.canvas()?.endEditInteraction()}
    >
      ${renderTabContent(view)} ${view.panel.activeTab === "edit" ? renderEditFooter(view) : null}
    </pf-edit-side-panel>
  `;
}

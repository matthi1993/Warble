import { html, type TemplateResult } from "lit";
import type { FullViewController } from "./full-view-controller";
import type { SidePanelTab } from "./side-panel-controller";

const TABS: ReadonlyArray<{ id: SidePanelTab; icon: string; label: string }> = [
  { id: "info", icon: "info", label: "Info" },
  { id: "edit", icon: "pencil", label: "Edit" },
  { id: "post", icon: "wand", label: "Post Process" },
  { id: "slideshow", icon: "play", label: "Slideshow" },
];

export function renderSideRail(view: FullViewController): TemplateResult {
  const { panel } = view;
  return html`
    <div class="edit-side-rail" @click=${(event: Event) => event.stopPropagation()}>
      ${TABS.filter((tab) => panel.isAvailable(tab.id)).map(
        (tab) => html`
          <pf-icon-button
            icon=${tab.icon}
            label=${tab.label}
            aria-pressed=${panel.activeTab === tab.id ? "true" : "false"}
            class=${panel.activeTab === tab.id ? "is-active" : ""}
            @click=${() => panel.toggleTab(tab.id)}
          ></pf-icon-button>
        `,
      )}
    </div>
  `;
}

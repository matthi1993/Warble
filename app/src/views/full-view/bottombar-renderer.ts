import { html, type TemplateResult } from "lit";
import { renderBackgroundMenu } from "./background-menu-renderer";
import { renderFrameMenu } from "./frame-menu-renderer";
import type { FullViewController } from "./full-view-controller";
import { renderViewMenu } from "./view-menu-renderer";

export function renderBottombar(view: FullViewController): TemplateResult {
  const { immersive } = view.host;
  return html`
    <div class="bottombar">
      ${renderBackgroundMenu(view)} ${renderFrameMenu(view)} ${renderViewMenu(view)}
      <button
        class="menu-trigger"
        type="button"
        aria-pressed=${immersive}
        title=${immersive ? "Exit immersive view" : "Enter immersive view"}
        @click=${() => view.events.toggleImmersiveView()}
      >
        <pf-icon name="focus"></pf-icon> Immersive
      </button>
      <button class="menu-trigger" type="button" title="Start slideshow" @click=${() => view.events.slideshowStart()}>
        <pf-icon name="play"></pf-icon> Play
      </button>
    </div>
  `;
}

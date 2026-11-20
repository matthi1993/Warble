import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import type { PostProcessPreset } from "@warble/editing";
import { app } from "@app/composition/app";
import "@ui/cards/pf-card";
import "@ui/icons/pf-icon";
import { postPresetsCardStyles } from "./pf-post-presets-card.styles";
import { PostPresetsController } from "./post-presets-controller";

@customElement("pf-post-presets-card")
export class PfPostPresetsCard extends LitElement {
  static styles = postPresetsCardStyles;

  private readonly controller = new PostPresetsController(
    this,
    app.editing.post,
    app.editing.presets,
    app.platform.dialogs,
  );

  connectedCallback(): void {
    super.connectedCallback();
    this.controller.connect();
  }

  disconnectedCallback(): void {
    this.controller.disconnect();
    super.disconnectedCallback();
  }

  private onNameKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key !== "Enter") return;
    event.preventDefault();
    this.controller.save();
  };

  private onDelete(event: Event, preset: PostProcessPreset): void {
    event.stopPropagation();
    void this.controller.remove(preset);
  }

  render() {
    const controller = this.controller;
    return html`
      <pf-card
        title="Presets"
        ?open=${controller.open}
        @toggle=${(event: CustomEvent<{ open: boolean }>) => controller.setOpen(event.detail.open)}
      >
        <div class="body">
          ${controller.presets.length === 0
            ? html`<p class="empty">No saved presets yet.</p>`
            : html`<div class="list">${controller.presets.map((preset) => this.renderPreset(preset))}</div>`}
          <div class="save">
            <input
              type="text"
              maxlength="64"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              placeholder="Preset name"
              aria-label="Preset name"
              .value=${controller.name}
              @input=${(event: Event) => controller.setName((event.target as HTMLInputElement).value)}
              @keydown=${this.onNameKeyDown}
            />
            <button type="button" ?disabled=${!controller.canSave} @click=${() => controller.save()}>Save</button>
          </div>
        </div>
      </pf-card>
    `;
  }

  private renderPreset(preset: PostProcessPreset) {
    const controller = this.controller;
    return html`
      <div
        class=${controller.isActive(preset) ? "preset active" : "preset"}
        @mouseenter=${() => controller.preview(preset)}
        @mouseleave=${() => controller.stopPreview()}
      >
        <button
          type="button"
          class="select"
          title="Apply ${preset.name}"
          @click=${() => controller.apply(preset)}
        >${preset.name}</button>
        <button
          type="button"
          class="delete"
          title="Delete ${preset.name}"
          aria-label="Delete ${preset.name}"
          @click=${(event: Event) => this.onDelete(event, preset)}
        >
          <pf-icon name="x"></pf-icon>
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-post-presets-card": PfPostPresetsCard;
  }
}

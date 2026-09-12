/** Preset manager for global post-processing tool values. */
import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  clearPostProcessPreview,
  getCommittedPostProcess,
  getPostProcess,
  previewPostProcess,
  setPostProcess,
  subscribePostProcess,
  type PostProcessSettings,
} from "@services/post-process/post-process-store";
import {
  deletePostProcessPreset,
  getPostProcessPresets,
  savePostProcessPreset,
  settingsFromPostProcessPreset,
  subscribePostProcessPresets,
  type PostProcessPreset,
} from "@services/post-process/post-process-presets-store";
import "@ui/cards/pf-card";
import "@ui/icons/pf-icon";

@customElement("pf-post-presets-card")
export class PfPostPresetsCard extends LitElement {
  static styles = css`
    .body {
      padding: 8px 10px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .empty {
      margin: 0;
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .preset {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm, 4px);
      overflow: hidden;
      background: var(--pf-surface);
    }
    .preset:hover,
    .preset.active {
      border-color: var(--pf-accent, #4a90e2);
    }
    .select,
    .delete {
      border: 0;
      background: transparent;
      color: var(--pf-text);
      cursor: pointer;
    }
    .select {
      min-width: 0;
      padding: 6px 8px;
      text-align: left;
      font-size: var(--pf-text-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .preset.active .select {
      color: var(--pf-accent, #4a90e2);
      font-weight: 600;
    }
    .delete {
      display: grid;
      place-items: center;
      width: 30px;
      border-left: 1px solid var(--pf-border);
      color: var(--pf-text-muted);
    }
    .delete:hover {
      color: var(--pf-text);
      background: var(--pf-surface-hover);
    }
    .delete pf-icon {
      font-size: 0.85rem;
    }
    .save {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px;
      padding-top: 2px;
    }
    input {
      min-width: 0;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm, 4px);
      background: var(--pf-surface);
      color: var(--pf-text);
      padding: 6px 8px;
      font: inherit;
      font-size: var(--pf-text-xs);
      outline: none;
    }
    input:focus {
      border-color: var(--pf-accent, #4a90e2);
    }
    .save button {
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm, 4px);
      background: var(--pf-surface);
      color: var(--pf-text);
      padding: 5px 9px;
      font-size: var(--pf-text-xs);
      cursor: pointer;
    }
    .save button:hover:not(:disabled) {
      background: var(--pf-surface-hover);
    }
    .save button:disabled {
      opacity: 0.4;
      cursor: default;
    }
  `;

  @state()
  private open = true;

  @state()
  private name = "";

  @state()
  private presets: readonly PostProcessPreset[] = getPostProcessPresets();

  @state()
  private settings: PostProcessSettings = getPostProcess();

  private unsubscribePresets: (() => void) | null = null;
  private unsubscribeSettings: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribePresets = subscribePostProcessPresets((presets) => {
      this.presets = presets;
    });
    this.unsubscribeSettings = subscribePostProcess((settings) => {
      this.settings = settings;
    });
  }

  disconnectedCallback(): void {
    clearPostProcessPreview();
    this.unsubscribePresets?.();
    this.unsubscribeSettings?.();
    this.unsubscribePresets = null;
    this.unsubscribeSettings = null;
    super.disconnectedCallback();
  }

  private presetSettings(preset: PostProcessPreset): PostProcessSettings {
    return settingsFromPostProcessPreset(preset, getCommittedPostProcess());
  }

  private preview = (preset: PostProcessPreset) => {
    previewPostProcess(this.presetSettings(preset));
  };

  private stopPreview = () => {
    clearPostProcessPreview();
  };

  private select = (preset: PostProcessPreset) => {
    setPostProcess(this.presetSettings(preset));
  };

  private removePreset = (event: Event, preset: PostProcessPreset) => {
    event.stopPropagation();
    clearPostProcessPreview();
    deletePostProcessPreset(preset.id);
  };

  private save = () => {
    if (!this.name.trim()) return;
    savePostProcessPreset(this.name, getCommittedPostProcess());
    this.name = "";
  };

  private isActive(preset: PostProcessPreset): boolean {
    const current = getCommittedPostProcess();
    return JSON.stringify(preset.values) === JSON.stringify({
      tone: current.tone,
      color: current.color,
      curve: current.curve,
      sharpen: current.sharpen,
      grain: current.grain,
    });
  }

  render() {
    // Keep Lit subscribed to post-process changes for active-row styling.
    void this.settings;
    return html`
      <pf-card
        title="Presets"
        ?open=${this.open}
        @toggle=${(event: CustomEvent<{ open: boolean }>) => {
          this.open = event.detail.open;
        }}
      >
        <div class="body">
          ${this.presets.length === 0
            ? html`<p class="empty">No saved presets yet.</p>`
            : html`
                <div class="list">
                  ${this.presets.map((preset) => html`
                    <div
                      class=${this.isActive(preset) ? "preset active" : "preset"}
                      @mouseenter=${() => this.preview(preset)}
                      @mouseleave=${this.stopPreview}
                    >
                      <button
                        type="button"
                        class="select"
                        title="Apply ${preset.name}"
                        @click=${() => this.select(preset)}
                      >${preset.name}</button>
                      <button
                        type="button"
                        class="delete"
                        title="Delete ${preset.name}"
                        aria-label="Delete ${preset.name}"
                        @click=${(event: Event) =>
                          this.removePreset(event, preset)}
                      ><pf-icon name="x"></pf-icon></button>
                    </div>
                  `)}
                </div>
              `}
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
              .value=${this.name}
              @input=${(event: Event) => {
                this.name = (event.target as HTMLInputElement).value;
              }}
              @keydown=${(event: KeyboardEvent) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  this.save();
                }
              }}
            />
            <button
              type="button"
              ?disabled=${!this.name.trim()}
              @click=${this.save}
            >Save</button>
          </div>
        </div>
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-post-presets-card": PfPostPresetsCard;
  }
}

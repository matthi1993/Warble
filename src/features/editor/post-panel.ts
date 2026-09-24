import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import {
  getPostProcess,
  setPostProcessEnabled,
  subscribePostProcess,
} from "@services/post-process/post-process-store";
import { createEditorTools } from "./registry";
import { subscribeEffectEnabled } from "@services/effects/effect-enabled-store";
import { editorStateAdapter } from "@features/editor/adapters/store-state";
import type { ToolHost } from "./tool";
import "./post-presets.ui";
import "@ui/controls/pf-effect-toggle";

/** Global tool host. It renders the same registered tools as the photo editor. */
@customElement("pf-post-process-card")
export class PfPostProcessCard extends LitElement {
  static styles = css`
    :host, .stack {
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-2);
    }
    .enable-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      background: var(--pf-surface);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm, 4px);
    }
    .label { font-size: var(--pf-text-sm); font-weight: 500; }
    .dim { opacity: 0.5; }
  `;

  private readonly tools = createEditorTools("post", editorStateAdapter);
  private unsubscribe: (() => void) | null = null;
  private unsubscribeEffects: (() => void) | null = null;
  private readonly host: ToolHost = {
    editTarget: null,
    canvas: null,
    requestUpdate: () => this.requestUpdate(),
    revealEditPanel: () => undefined,
    flushActiveEdit: () => undefined,
    setActiveTool: () => undefined,
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = subscribePostProcess(() => this.requestUpdate());
    this.unsubscribeEffects = subscribeEffectEnabled(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeEffects?.();
    this.unsubscribeEffects = null;
    super.disconnectedCallback();
  }

  render() {
    const enabled = getPostProcess().enabled;
    return html`
      <div class="enable-row">
        <span class="label">Post-Processing ${enabled ? "enabled" : "disabled"}</span>
        <pf-effect-toggle
          .disabled=${!enabled}
          label="post-processing"
          @effect-toggle=${() => setPostProcessEnabled(!enabled)}
        ></pf-effect-toggle>
      </div>
      <pf-post-presets-card></pf-post-presets-card>
      <div class=${enabled ? "stack" : "stack dim"}>
        ${this.tools.map((tool) => tool.renderCard(this.host))}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-post-process-card": PfPostProcessCard;
  }
}

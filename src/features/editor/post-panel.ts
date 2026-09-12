import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import {
  getPostProcess,
  setPostProcessEnabled,
  subscribePostProcess,
} from "@services/post-process/post-process-store";
import { createEditorTools } from "./registry";
import type { ToolHost } from "./tool";
import "./post-presets.ui";

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
    .toggle {
      position: relative;
      width: 36px;
      height: 20px;
      border: 0;
      border-radius: 999px;
      padding: 0;
      cursor: pointer;
      background: var(--pf-border);
    }
    .toggle[aria-pressed="true"] { background: var(--pf-accent, #4a90e2); }
    .toggle::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      transition: transform 120ms ease;
    }
    .toggle[aria-pressed="true"]::after { transform: translateX(16px); }
    .dim { opacity: 0.5; pointer-events: none; }
  `;

  private readonly tools = createEditorTools("post");
  private unsubscribe: (() => void) | null = null;
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
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.disconnectedCallback();
  }

  render() {
    const enabled = getPostProcess().enabled;
    return html`
      <pf-post-presets-card></pf-post-presets-card>
      <div class="enable-row">
        <span class="label">Post-Processing</span>
        <button
          type="button"
          class="toggle"
          role="switch"
          aria-pressed=${enabled ? "true" : "false"}
          aria-label="Toggle post-processing"
          @click=${() => setPostProcessEnabled(!enabled)}
        ></button>
      </div>
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

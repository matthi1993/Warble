import { html, type TemplateResult } from "lit";
import { defaultBloom, isBloomZero, type BloomSettings } from "@domain/edits";
import type { EditorState } from "../../editor-state";
import { EditTool, type ToolHost } from "../../tool";
import "./bloom.ui";

export function readBloomToolValue(state: EditorState): BloomSettings { return state.getPostProcess().bloom; }

export class BloomTool extends EditTool {
  readonly id = "bloom";
  hasEdits(): boolean { return !isBloomZero(this.state.getPostProcess().bloom); }
  reset(host: ToolHost): void { this.state.resetPostBloom(); host.requestUpdate(); }
  renderCard(host: ToolHost): TemplateResult {
    const value = this.state.getPostProcess().bloom;
    const defaults = defaultBloom();
    const canRevert = Object.keys(defaults).some(
      (key) => value[key as keyof BloomSettings] !== defaults[key as keyof BloomSettings],
    );
    return html`<pf-bloom-card .value=${value} ?open=${this.cardOpen} ?can-revert=${canRevert}
      .effectDisabled=${this.effectDisabled(host)}
      @effect-toggle=${() => this.toggleEffect(host)}
      @toggle=${(e: CustomEvent<{ open: boolean }>) => { this.cardOpen = e.detail.open; host.requestUpdate(); }}
      @bloom-change=${(e: CustomEvent<BloomSettings>) => { this.state.setPostBloom(e.detail); host.requestUpdate(); }}
      @bloom-reset=${() => this.reset(host)}></pf-bloom-card>`;
  }
}

import { html, type TemplateResult } from "lit";
import { defaultBloom, isBloomZero, type BloomSettings } from "@services/effects/effects-store";
import { getPostProcess, resetPostBloom, setPostBloom } from "@services/post-process/post-process-store";
import { EditTool, type ToolHost } from "../../tool";
import "./bloom.ui";

export function readBloomToolValue(): BloomSettings { return getPostProcess().bloom; }

export class BloomTool extends EditTool {
  readonly id = "bloom";
  hasEdits(): boolean { return !isBloomZero(getPostProcess().bloom); }
  reset(host: ToolHost): void { resetPostBloom(); host.requestUpdate(); }
  renderCard(host: ToolHost): TemplateResult {
    const value = getPostProcess().bloom;
    const defaults = defaultBloom();
    const canRevert = Object.keys(defaults).some(
      (key) => value[key as keyof BloomSettings] !== defaults[key as keyof BloomSettings],
    );
    return html`<pf-bloom-card .value=${value} ?open=${this.cardOpen} ?can-revert=${canRevert}
      @tool-preview-start=${this.startBeforePreview}
      @tool-preview-end=${this.endBeforePreview}
      @toggle=${(e: CustomEvent<{ open: boolean }>) => { this.cardOpen = e.detail.open; host.requestUpdate(); }}
      @bloom-change=${(e: CustomEvent<BloomSettings>) => { setPostBloom(e.detail); host.requestUpdate(); }}
      @bloom-reset=${() => this.reset(host)}></pf-bloom-card>`;
  }
}

import { html, type TemplateResult } from "lit";
import {
  defaultSharpen,
  type SharpenSettings,
} from "@domain/edits";
import type { EditorState } from "../../editor-state";
import { EditTool, type ToolHost, type ToolScope } from "../../tool";
import "./sharpen.ui";

export function readSharpenToolValue(
  scope: ToolScope,
  path: string | null,
  state: EditorState,
): SharpenSettings {
  if (scope === "post") return state.getPostProcess().sharpen;
  return state.getPhotoSharpen(path) ?? defaultSharpen();
}

export class SharpenTool extends EditTool {
  readonly id = "sharpen";

  hasEdits(target: string): boolean {
    return this.state.getPhotoSharpen(target) != null;
  }

  serializeEdit(target: string): unknown | null {
    const value = this.state.getPhotoSharpen(target);
    return value ? { ...value } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (!host.editTarget || this.scope !== "photo") return;
    this.state.setPhotoSharpen(
      host.editTarget,
      data == null ? null : { ...defaultSharpen(), ...(data as SharpenSettings) },
    );
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") this.state.resetPostSharpen();
    else if (host.editTarget) this.state.setPhotoSharpen(host.editTarget, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    const stored = this.scope === "post"
      ? this.state.getPostProcess().sharpen
      : this.state.getPhotoSharpen(host.editTarget);
    const value = readSharpenToolValue(this.scope, host.editTarget, this.state);
    return html`<pf-sharpen-card
      .title=${this.scope === "post" ? "Output Sharpening" : "Sharpen"}
      .value=${value}
      ?open=${this.cardOpen}
      .effectDisabled=${this.effectDisabled(host)}
      @effect-toggle=${() => this.toggleEffect(host)}
      ?can-revert=${this.scope === "post" ? value.strength > 0 : stored != null}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => {
        this.cardOpen = event.detail.open;
        host.requestUpdate();
      }}
      @sharpen-change=${(event: CustomEvent<SharpenSettings>) => {
        if (this.scope === "post") this.state.setPostSharpen(event.detail);
        else if (host.editTarget) this.state.setPhotoSharpen(host.editTarget, event.detail);
        host.requestUpdate();
      }}
      @sharpen-reset=${() => this.reset(host)}
    ></pf-sharpen-card>`;
  }
}

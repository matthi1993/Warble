import { html, type TemplateResult } from "lit";
import { defaultClarity, type ClaritySettings } from "@domain/edits";
import type { EditorState } from "../../editor-state";
import { EditTool, type ToolHost, type ToolScope } from "../../tool";
import "./clarity.ui";

export function readClarityToolValue(scope: ToolScope, path: string | null, state: EditorState): ClaritySettings {
  return (scope === "post" ? state.getPostProcess().clarity : state.getPhotoClarity(path)) ?? defaultClarity();
}

export class ClarityTool extends EditTool {
  readonly id = "clarity";

  hasEdits(target: string): boolean {
    return this.state.getPhotoClarity(target) != null;
  }

  serializeEdit(target: string): unknown | null {
    const value = this.state.getPhotoClarity(target);
    return value ? { ...value } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (this.scope !== "photo" || !host.editTarget) return;
    this.state.setPhotoClarity(host.editTarget, data == null ? null : { ...defaultClarity(), ...(data as ClaritySettings) });
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") this.state.resetPostClarity();
    else if (host.editTarget) this.state.setPhotoClarity(host.editTarget, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    const value = readClarityToolValue(this.scope, host.editTarget, this.state);
    const defaults = defaultClarity();
    const canRevert = this.scope === "post"
      ? Object.keys(defaults).some((key) => value[key as keyof ClaritySettings] !== defaults[key as keyof ClaritySettings])
      : this.hasEdits(host.editTarget ?? "");
    return html`<pf-clarity-card
      .value=${value}
      ?open=${this.cardOpen}
      .effectDisabled=${this.effectDisabled(host)}
      ?can-revert=${canRevert}
      @effect-toggle=${() => this.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => {
        this.cardOpen = event.detail.open;
        host.requestUpdate();
      }}
      @clarity-change=${(event: CustomEvent<ClaritySettings>) => {
        if (this.scope === "post") this.state.setPostClarity(event.detail);
        else if (host.editTarget) this.state.setPhotoClarity(host.editTarget, event.detail);
        host.requestUpdate();
      }}
      @clarity-reset=${() => this.reset(host)}
    ></pf-clarity-card>`;
  }
}

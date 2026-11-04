import { html, type TemplateResult } from "lit";
import { defaultAnalog, type AnalogSettings } from "@domain/edits";
import type { EditorState } from "../../editor-state";
import { EditTool, type ToolHost, type ToolScope } from "../../tool";
import "./analog.ui";

export function readAnalogToolValue(scope: ToolScope, path: string | null, state: EditorState): AnalogSettings {
  return (scope === "post" ? state.getPostProcess().analog : state.getPhotoAnalog(path)) ?? defaultAnalog();
}

export class AnalogTool extends EditTool {
  readonly id = "analog";

  hasEdits(target: string): boolean {
    return this.state.getPhotoAnalog(target) != null;
  }

  serializeEdit(target: string): unknown | null {
    const value = this.state.getPhotoAnalog(target);
    return value ? { ...value } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (this.scope !== "photo" || !host.editTarget) return;
    this.state.setPhotoAnalog(host.editTarget, data == null ? null : { ...defaultAnalog(), ...(data as AnalogSettings) });
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") this.state.resetPostAnalog();
    else if (host.editTarget) this.state.setPhotoAnalog(host.editTarget, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    const value = readAnalogToolValue(this.scope, host.editTarget, this.state);
    const defaults = defaultAnalog();
    const canRevert = this.scope === "post"
      ? Object.keys(defaults).some((key) => value[key as keyof AnalogSettings] !== defaults[key as keyof AnalogSettings])
      : this.hasEdits(host.editTarget ?? "");
    return html`<pf-analog-card
      .value=${value}
      ?open=${this.cardOpen}
      .effectDisabled=${this.effectDisabled(host)}
      ?can-revert=${canRevert}
      @effect-toggle=${() => this.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => {
        this.cardOpen = event.detail.open;
        host.requestUpdate();
      }}
      @analog-change=${(event: CustomEvent<AnalogSettings>) => {
        if (this.scope === "post") this.state.setPostAnalog(event.detail);
        else if (host.editTarget) this.state.setPhotoAnalog(host.editTarget, event.detail);
        host.requestUpdate();
      }}
      @analog-reset=${() => this.reset(host)}
    ></pf-analog-card>`;
  }
}

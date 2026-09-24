import { html, type TemplateResult } from "lit";
import {
  defaultGrain,
  isGrainZero,
  type GrainSettings,
} from "@domain/edits";
import type { EditorState } from "../../editor-state";
import { EditTool, type ToolHost, type ToolScope } from "../../tool";
import "./grain.ui";

export function readGrainToolValue(
  scope: ToolScope,
  path: string | null,
  state: EditorState,
): GrainSettings | null {
  if (scope === "post") return state.getPostProcess().grain;
  return state.getPhotoGrain(path);
}

export class GrainTool extends EditTool {
  readonly id = "grain";

  hasEdits(target: string): boolean {
    return this.state.getPhotoGrain(target) != null;
  }

  serializeEdit(target: string): unknown | null {
    const value = this.state.getPhotoGrain(target);
    return value ? { ...value } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (!host.editTarget || this.scope !== "photo") return;
    this.state.setPhotoGrain(
      host.editTarget,
      data == null ? null : { ...defaultGrain(), ...(data as GrainSettings) },
    );
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") this.state.resetPostGrain();
    else if (host.editTarget) this.state.setPhotoGrain(host.editTarget, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    const stored = readGrainToolValue(this.scope, host.editTarget, this.state);
    const value = stored ?? defaultGrain();
    return html`<pf-grain-card
      .title=${"Grain"}
      .value=${value}
      ?open=${this.cardOpen}
      ?can-revert=${this.scope === "post" ? !isGrainZero(value) : stored != null}
      .effectDisabled=${this.effectDisabled(host)}
      @effect-toggle=${() => this.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => {
        this.cardOpen = event.detail.open;
        host.requestUpdate();
      }}
      @grain-change=${(event: CustomEvent<GrainSettings>) => {
        if (this.scope === "post") this.state.setPostGrain(event.detail);
        else if (host.editTarget) this.state.setPhotoGrain(host.editTarget, event.detail);
        host.requestUpdate();
      }}
      @grain-reset=${() => this.reset(host)}
    ></pf-grain-card>`;
  }
}

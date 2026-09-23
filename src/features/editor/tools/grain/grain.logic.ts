import { html, type TemplateResult } from "lit";
import {
  defaultGrain,
  getPhotoGrain,
  isGrainZero,
  setPhotoGrain,
  type GrainSettings,
} from "@services/effects/effects-store";
import {
  getPostProcess,
  resetPostGrain,
  setPostGrain,
} from "@services/post-process/post-process-store";
import { EditTool, type ToolHost, type ToolScope } from "../../tool";
import "./grain.ui";

export function readGrainToolValue(
  scope: ToolScope,
  path: string | null,
): GrainSettings | null {
  if (scope === "post") return getPostProcess().grain;
  return getPhotoGrain(path);
}

export class GrainTool extends EditTool {
  readonly id = "grain";

  hasEdits(target: string): boolean {
    return getPhotoGrain(target) != null;
  }

  serializeEdit(target: string): unknown | null {
    const value = getPhotoGrain(target);
    return value ? { ...value } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (!host.editTarget || this.scope !== "photo") return;
    setPhotoGrain(
      host.editTarget,
      data == null ? null : { ...defaultGrain(), ...(data as GrainSettings) },
    );
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") resetPostGrain();
    else if (host.editTarget) setPhotoGrain(host.editTarget, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    const stored = readGrainToolValue(this.scope, host.editTarget);
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
        if (this.scope === "post") setPostGrain(event.detail);
        else if (host.editTarget) setPhotoGrain(host.editTarget, event.detail);
        host.requestUpdate();
      }}
      @grain-reset=${() => this.reset(host)}
    ></pf-grain-card>`;
  }
}

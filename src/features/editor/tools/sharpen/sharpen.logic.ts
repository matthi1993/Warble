import { html, type TemplateResult } from "lit";
import { classifyFormat } from "@domain/photo";
import {
  defaultSharpen,
  defaultSharpenForFormat,
  getPhotoSharpen,
  setPhotoSharpen,
  type SharpenSettings,
} from "@services/effects/effects-store";
import {
  getPostProcess,
  resetPostSharpen,
  setPostSharpen,
} from "@services/post-process/post-process-store";
import { EditTool, type ToolHost, type ToolScope } from "../../tool";
import "./sharpen.ui";

function formatOf(path: string | null) {
  return path ? classifyFormat(path.split(".").pop() ?? "") : null;
}

export function readSharpenToolValue(
  scope: ToolScope,
  path: string | null,
): SharpenSettings {
  if (scope === "post") return getPostProcess().sharpen;
  return getPhotoSharpen(path) ?? defaultSharpenForFormat(formatOf(path));
}

export class SharpenTool extends EditTool {
  readonly id = "sharpen";

  hasEdits(target: string): boolean {
    return getPhotoSharpen(target) != null;
  }

  serializeEdit(target: string): unknown | null {
    const value = getPhotoSharpen(target);
    return value ? { ...value } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (!host.editTarget || this.scope !== "photo") return;
    setPhotoSharpen(
      host.editTarget,
      data == null ? null : { ...defaultSharpen(), ...(data as SharpenSettings) },
    );
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") resetPostSharpen();
    else if (host.editTarget) setPhotoSharpen(host.editTarget, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    const stored = this.scope === "post"
      ? getPostProcess().sharpen
      : getPhotoSharpen(host.editTarget);
    const value = readSharpenToolValue(this.scope, host.editTarget);
    return html`<pf-sharpen-card
      .title=${this.scope === "post" ? "Output Sharpening" : "Sharpen"}
      .value=${value}
      ?open=${this.cardOpen}
      ?can-revert=${this.scope === "post" ? value.strength > 0 : stored != null}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => {
        this.cardOpen = event.detail.open;
        host.requestUpdate();
      }}
      @sharpen-change=${(event: CustomEvent<SharpenSettings>) => {
        if (this.scope === "post") setPostSharpen(event.detail);
        else if (host.editTarget) setPhotoSharpen(host.editTarget, event.detail);
        host.requestUpdate();
      }}
      @sharpen-reset=${() => this.reset(host)}
    ></pf-sharpen-card>`;
  }
}

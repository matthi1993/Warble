import { html, type TemplateResult } from "lit";
import { defaultColor, isColorZero, type ColorEdit } from "@domain/edits";
import { getPhotoEdit, setPhotoColor } from "@services/edits/edits-store";
import { getPostProcess, resetPostColor, setPostColor } from "@services/post-process/post-process-store";
import { EditTool, type ToolHost, type ToolScope } from "../../tool";
import "./color.ui";

export function readColorToolValue(scope: ToolScope, path: string | null): ColorEdit {
  if (scope === "post") return getPostProcess().color;
  return (path ? getPhotoEdit(path)?.color : null) ?? defaultColor();
}

export class ColorTool extends EditTool {
  readonly id = "color";

  private value(host: ToolHost): ColorEdit {
    return readColorToolValue(this.scope, host.editTarget);
  }

  hasEdits(target: string): boolean {
    return !isColorZero(getPhotoEdit(target)?.color);
  }

  serializeEdit(target: string): unknown | null {
    const value = getPhotoEdit(target)?.color;
    return value ? structuredClone(value) : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (!host.editTarget || this.scope !== "photo") return;
    const value = data == null ? null : structuredClone(data as ColorEdit);
    setPhotoColor(host.editTarget, value && !isColorZero(value) ? value : null);
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") resetPostColor();
    else if (host.editTarget) setPhotoColor(host.editTarget, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    return html`<pf-color-card
      .title=${"Color"}
      .value=${this.value(host)}
      ?open=${this.cardOpen}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => {
        this.cardOpen = event.detail.open;
        host.requestUpdate();
      }}
      @color-change=${(event: CustomEvent<ColorEdit>) => {
        if (this.scope === "post") setPostColor(event.detail);
        else if (host.editTarget) setPhotoColor(host.editTarget, event.detail);
        host.requestUpdate();
      }}
      @color-reset=${() => this.reset(host)}
    ></pf-color-card>`;
  }
}

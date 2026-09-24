import { html, type TemplateResult } from "lit";
import { defaultColor, isColorZero, type ColorEdit } from "@domain/edits";
import type { EditorState } from "../../editor-state";
import { EditTool, type ToolHost, type ToolScope } from "../../tool";
import "./color.ui";

export function readColorToolValue(scope: ToolScope, path: string | null, state: EditorState): ColorEdit {
  if (scope === "post") return state.getPostProcess().color;
  return (path ? state.getPhotoEdit(path)?.color : null) ?? defaultColor();
}

export class ColorTool extends EditTool {
  readonly id = "color";

  private value(host: ToolHost): ColorEdit {
    return readColorToolValue(this.scope, host.editTarget, this.state);
  }

  hasEdits(target: string): boolean {
    return !isColorZero(this.state.getPhotoEdit(target)?.color);
  }

  serializeEdit(target: string): unknown | null {
    const value = this.state.getPhotoEdit(target)?.color;
    return value ? structuredClone(value) : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (!host.editTarget || this.scope !== "photo") return;
    const value = data == null ? null : structuredClone(data as ColorEdit);
    this.state.setPhotoColor(host.editTarget, value && !isColorZero(value) ? value : null);
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") this.state.resetPostColor();
    else if (host.editTarget) this.state.setPhotoColor(host.editTarget, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    return html`<pf-color-card
      .title=${"Color"}
      .value=${this.value(host)}
      ?open=${this.cardOpen}
      .effectDisabled=${this.effectDisabled(host)}
      @effect-toggle=${() => this.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => {
        this.cardOpen = event.detail.open;
        host.requestUpdate();
      }}
      @color-change=${(event: CustomEvent<ColorEdit>) => {
        if (this.scope === "post") this.state.setPostColor(event.detail);
        else if (host.editTarget) this.state.setPhotoColor(host.editTarget, event.detail);
        host.requestUpdate();
      }}
      @color-reset=${() => this.reset(host)}
    ></pf-color-card>`;
  }
}

/**
 * Color tool: per-photo per-hue HSL adjustments. Mirrors the
 * `CurveTool` pattern: keeps a local copy of the colour edit
 * hydrated from the edits store, routes changes back through
 * `setPhotoColor`, and renders a `pf-color-card`. The canvas reads
 * the colour edit from the edits store via its own subscription
 * so `applyToCanvas` is a no-op.
 */
import { html, type TemplateResult } from "lit";
import {
  defaultColor,
  isColorZero,
  type ColorEdit,
} from "@domain/edits";
import { getPhotoEdit, setPhotoColor } from "@services/edits/edits-store";
import "@ui/cards/pf-color-card";
import { EditTool, type ToolHost } from "./edit-tool";

export class ColorTool extends EditTool {
  readonly id = "color";

  color: ColorEdit = defaultColor();
  private colorForPath: string | null = null;

  syncFromStore(target: string | null): void {
    if (target == null) {
      if (this.colorForPath !== null) {
        this.color = defaultColor();
        this.colorForPath = null;
      }
      return;
    }
    if (target === this.colorForPath) return;
    const persisted = getPhotoEdit(target)?.color ?? null;
    this.color = persisted ?? defaultColor();
    this.colorForPath = target;
  }

  invalidateMirror(): void {
    this.colorForPath = null;
  }

  hasEdits(_target: string): boolean {
    return !isColorZero(this.color);
  }

  serializeEdit(target: string): unknown | null {
    const color = getPhotoEdit(target)?.color ?? null;
    return color ? structuredClone(color) : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    const target = host.editTarget;
    if (!target) return;
    if (data == null) {
      this.color = defaultColor();
      this.colorForPath = target;
      setPhotoColor(target, null);
      host.requestUpdate();
      return;
    }
    const color = structuredClone(data as ColorEdit);
    this.color = color;
    this.colorForPath = target;
    setPhotoColor(target, isColorZero(color) ? null : color);
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    const target = host.editTarget;
    if (!target) return;
    if (isColorZero(this.color)) return;
    this.color = defaultColor();
    this.colorForPath = target;
    setPhotoColor(target, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    return html`
      <pf-color-card
        .value=${this.color}
        ?open=${this.cardOpen}
        @toggle=${(e: CustomEvent<{ open: boolean }>) => {
          this.cardOpen = e.detail.open;
          host.requestUpdate();
        }}
        @color-change=${(e: CustomEvent<ColorEdit>) =>
          this.onColorChange(host, e.detail)}
        @color-reset=${() => this.reset(host)}
      ></pf-color-card>
    `;
  }

  private onColorChange(host: ToolHost, next: ColorEdit): void {
    const target = host.editTarget;
    if (!target) return;
    this.color = next;
    this.colorForPath = target;
    setPhotoColor(target, isColorZero(next) ? null : next);
    host.requestUpdate();
  }
}

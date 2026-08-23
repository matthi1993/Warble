/**
 * Sharpen tool: per-photo unsharp-mask sharpening exposed on the
 * "Edit" panel. Uses a format-aware default — RAWs ship with a
 * moderate amount of sharpening
* (since they're stored unsharp from the sensor), JPGs default to
* none (since the camera already applied output sharpening).
 *
 * The persisted state distinguishes "no override" (use format
 * default) from "explicit override" (which may even be all zeros,
 * i.e. the user deliberately disabling RAW sharpening). That lets
 * cmd+v deterministically reproduce the source photo's setting on
 * the destination — including "turn the default off".
 */
import { html, type TemplateResult } from "lit";
import {
  defaultSharpen,
  defaultSharpenForFormat,
  getPhotoSharpen,
  setPhotoSharpen,
  type SharpenSettings,
} from "@services/effects/effects-store";
import { classifyFormat } from "@domain/photo";
import "@ui/cards/pf-sharpen-card";
import { EditTool, type ToolHost } from "./edit-tool";

function formatOf(target: string | null) {
  if (!target) return null;
  const ext = target.split(".").pop() ?? "";
  return classifyFormat(ext);
}

export class SharpenTool extends EditTool {
  readonly id = "sharpen";

  hasEdits(target: string): boolean {
    // "Has edits" here means: the user explicitly overrode the
    // format default. The format default itself is not considered
    // an edit (otherwise every RAW would appear edited).
    return getPhotoSharpen(target) != null;
  }

  reset(host: ToolHost): void {
    const target = host.editTarget;
    if (!target) return;
    if (!this.hasEdits(target)) return;
    setPhotoSharpen(target, null);
    host.requestUpdate();
  }

  serializeEdit(target: string): unknown | null {
    const s = getPhotoSharpen(target);
    return s ? { ...s } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    const target = host.editTarget;
    if (!target) return;
    if (data == null) {
      setPhotoSharpen(target, null);
      host.requestUpdate();
      return;
    }
    const s = { ...defaultSharpen(), ...(data as SharpenSettings) };
    setPhotoSharpen(target, s);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    const target = host.editTarget;
    const fmt = formatOf(target);
    const stored = target ? getPhotoSharpen(target) : null;
    // Show the effective value — explicit override if present,
    // otherwise the format default. The user-visible "current"
    // value is always what the pipeline is actually rendering.
    const value = stored ?? defaultSharpenForFormat(fmt);
    return html`
      <pf-sharpen-card
        .value=${value}
        ?open=${this.cardOpen}
        ?can-revert=${stored != null}
        @toggle=${(e: CustomEvent<{ open: boolean }>) => {
          this.cardOpen = e.detail.open;
          host.requestUpdate();
        }}
        @sharpen-change=${(e: CustomEvent<SharpenSettings>) =>
          this.onChange(host, e.detail)}
        @sharpen-reset=${() => this.reset(host)}
      ></pf-sharpen-card>
    `;
  }

  private onChange(host: ToolHost, next: SharpenSettings): void {
    const target = host.editTarget;
    if (!target) return;
    setPhotoSharpen(target, next);
    host.requestUpdate();
  }
}

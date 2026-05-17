/**
 * Bloom tool: per-photo highlight bloom exposed on the "Effects"
 * panel. Mirrors the ToneTool pattern but persists via the
 * localStorage-backed `effects-store` instead of the SQLite edits
 * store.
 *
 * Copy/paste flows through the tool's `serializeEdit` / `applyEdit`
 * overrides so cmd+v reproduces the bloom settings on the
 * destination photo (or clears them when the source had no bloom).
 */
import { html, type TemplateResult } from "lit";
import "../pf-bloom-card";
import {
  defaultBloom,
  getPhotoBloom,
  setPhotoBloom,
  type BloomSettings,
} from "@services/effects/effects-store";
import { EditTool, type ToolHost } from "./edit-tool";

export class BloomTool extends EditTool {
  readonly id = "bloom";

  hasEdits(target: string): boolean {
    const b = getPhotoBloom(target);
    return !!b && b.strength > 0;
  }

  reset(host: ToolHost): void {
    const target = host.editTarget;
    if (!target) return;
    if (!this.hasEdits(target)) return;
    setPhotoBloom(target, null);
    host.requestUpdate();
  }

  serializeEdit(target: string): unknown | null {
    const b = getPhotoBloom(target);
    return b ? { ...b } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    const target = host.editTarget;
    if (!target) return;
    if (data == null) {
      setPhotoBloom(target, null);
      host.requestUpdate();
      return;
    }
    const b = { ...defaultBloom(), ...(data as BloomSettings) };
    setPhotoBloom(target, b.strength > 0 ? b : null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    return html`
      <pf-bloom-card
        .target=${host.editTarget}
        ?open=${this.cardOpen}
        @toggle=${(e: CustomEvent<{ open: boolean }>) => {
          this.cardOpen = e.detail.open;
          host.requestUpdate();
        }}
      ></pf-bloom-card>
    `;
  }
}

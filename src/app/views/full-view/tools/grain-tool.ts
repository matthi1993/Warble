/** Per-photo Grain tool shown in the Edit tab. */
import { html, type TemplateResult } from "lit";
import {
  defaultGrain,
  getPhotoGrain,
  setPhotoGrain,
  type GrainSettings,
} from "@services/effects/effects-store";
import "@ui/cards/pf-grain-card";
import { EditTool, type ToolHost } from "./edit-tool";

export class GrainTool extends EditTool {
  readonly id = "grain";

  hasEdits(target: string): boolean {
    return getPhotoGrain(target) != null;
  }

  reset(host: ToolHost): void {
    const target = host.editTarget;
    if (!target || !this.hasEdits(target)) return;
    setPhotoGrain(target, null);
    host.requestUpdate();
  }

  serializeEdit(target: string): unknown | null {
    const grain = getPhotoGrain(target);
    return grain ? { ...grain } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    const target = host.editTarget;
    if (!target) return;
    if (data == null) {
      setPhotoGrain(target, null);
    } else {
      setPhotoGrain(target, {
        ...defaultGrain(),
        ...(data as GrainSettings),
      });
    }
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    const target = host.editTarget;
    const stored = target ? getPhotoGrain(target) : null;
    return html`
      <pf-grain-card
        .title=${"Grain"}
        .value=${stored ?? defaultGrain()}
        ?open=${this.cardOpen}
        ?can-revert=${stored != null}
        @toggle=${(event: CustomEvent<{ open: boolean }>) => {
          this.cardOpen = event.detail.open;
          host.requestUpdate();
        }}
        @grain-change=${(event: CustomEvent<GrainSettings>) =>
          this.onChange(host, event.detail)}
        @grain-reset=${() => this.reset(host)}
      ></pf-grain-card>
    `;
  }

  private onChange(host: ToolHost, grain: GrainSettings): void {
    const target = host.editTarget;
    if (!target) return;
    setPhotoGrain(target, grain);
    host.requestUpdate();
  }
}

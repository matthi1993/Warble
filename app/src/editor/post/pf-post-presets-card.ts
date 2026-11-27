import { LitElement, html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { customElement, state } from "lit/decorators.js";
import type { PostProcessPreset } from "@warble/editing";
import { app } from "@app/composition/app";
import "@ui/cards/pf-card";
import "@ui/icons/pf-icon";
import { postPresetsCardStyles } from "./pf-post-presets-card.styles";
import { findGroupDrop, renderPresetGroup, type GroupDrop } from "./post-preset-group";
import { renderInlineName } from "./post-preset-inline-name";
import { PostPresetsController } from "./post-presets-controller";
@customElement("pf-post-presets-card")
export class PfPostPresetsCard extends LitElement {
  static styles = postPresetsCardStyles;
  private readonly controller = new PostPresetsController(
    this,
    app.editing.post,
    app.editing.presets,
    app.platform.dialogs,
  );

  connectedCallback(): void {
    super.connectedCallback();
    this.controller.connect();
  }

  disconnectedCallback(): void {
    this.controller.disconnect();
    super.disconnectedCallback();
  }

  @state() private dragging: PostProcessPreset | null = null;
  @state() private destination: { group: string; beforeId: string | null } | null = null;
  @state() private creatingGroup = false;
  @state() private renamingGroup: string | null = null;
  @state() private renamingPreset: string | null = null;
  @state() private draggingGroup: string | null = null;
  @state() private groupDestination: GroupDrop | null = null;
  private pointer: { id: number; x: number; y: number } | null = null;

  private startDrag(event: PointerEvent): void {
    if (event.button !== 0 || this.pointer) return;
    this.renamingPreset = null;
    this.renamingGroup = null;
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  private trackGroupDrag(event: PointerEvent, group: string): void {
    if (this.pointer?.id !== event.pointerId) return;
    if (!this.draggingGroup && Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) < 4) return;
    if (!this.draggingGroup) this.controller.stopPreview();
    this.draggingGroup = group;
    const hit = this.shadowRoot?.elementFromPoint(event.clientX, event.clientY);
    this.groupDestination = findGroupDrop(hit, event.clientY, group, this.controller);
  }

  private trackDrag(event: PointerEvent, preset: PostProcessPreset): void {
    if (this.pointer?.id !== event.pointerId) return;
    if (!this.dragging) {
      if (Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) < 4) return;
      this.controller.stopPreview();
      this.dragging = preset;
    }

    const hit = this.shadowRoot?.elementFromPoint(event.clientX, event.clientY);
    const zone = hit?.closest<HTMLElement>("[data-group]");
    if (!zone) {
      this.destination = null;
      return;
    }
    if (hit?.closest(".drag-preview")) return;

    const group = zone.dataset.group ?? "";
    const rows = zone.querySelectorAll<HTMLElement>(":scope > .list > .preset[data-id], :scope > .group-content > .list > .preset[data-id]");
    const before = Array.from(rows).find((row) => {
      if (row.dataset.id === preset.id || !row.offsetHeight) return false;
      const bounds = row.getBoundingClientRect();
      return event.clientY < bounds.top + bounds.height / 2;
    });
    const beforeId = before?.dataset.id ?? null;
    if (this.destination?.group !== group || this.destination.beforeId !== beforeId) {
      this.destination = { group, beforeId };
    }
  }

  private finishDrag(event: PointerEvent): void {
    if (this.pointer?.id !== event.pointerId) return;
    if (event.type === "pointerup" && this.dragging && this.destination) {
      this.controller.move(this.dragging.id, this.destination.group, this.destination.beforeId);
    }
    if (event.type === "pointerup" && this.draggingGroup && this.groupDestination) {
      const { parent, before } = this.groupDestination;
      this.controller.moveGroup(this.draggingGroup, parent, before);
    }
    this.draggingGroup = null;
    this.groupDestination = null;
    this.pointer = null;
    this.dragging = null;
    this.destination = null;
  }

  private async editName(kind: "preset" | "group", id: string | null): Promise<void> {
    this.controller.stopPreview();
    this.renamingPreset = kind === "preset" ? id : null;
    this.renamingGroup = kind === "group" ? id : null;
    if (!id) return;
    await this.updateComplete;
    this.shadowRoot?.querySelector<HTMLInputElement>(".inline-name input")?.select();
  }

  render() {
    const controller = this.controller;
    return html`
      <pf-card
        title="Presets"
        ?open=${controller.open}
        .allowDisable=${false}
        @toggle=${(event: CustomEvent<{ open: boolean }>) => controller.setOpen(event.detail.open)}
      >
        <div class="body">
          <div class="ungrouped" data-group="" ?data-group-drop=${this.groupDestination?.target === ""}>
            ${controller.groups.length ? html`<div class="list-label">${this.draggingGroup ? "Drop here to move group to top level" : "Ungrouped"}</div>` : nothing}
            ${this.renderList("")}
          </div>
          <div class="root-groups">${this.renderGroups("")}</div>
          <div class="creation">
            <form class="save" @submit=${(event: SubmitEvent) => {
              event.preventDefault();
              controller.save();
            }} @keydown=${(event: KeyboardEvent) => event.stopPropagation()}>
              <input name="preset" maxlength="64" spellcheck="false" autocomplete="off"
                placeholder="Preset name" aria-label="Preset name" .value=${live(controller.name)}
                @input=${(event: Event) => controller.setName((event.target as HTMLInputElement).value)}
              />
              <button type="submit" ?disabled=${!controller.canSave}>Save preset</button>
            </form>
            ${this.creatingGroup ? html`
              <form class="new-group" @submit=${(event: SubmitEvent) => {
                event.preventDefault();
                const form = event.currentTarget as HTMLFormElement;
                const name = String(new FormData(form).get("group") ?? "").trim();
                if (!name) return;
                controller.createGroup(name);
                this.creatingGroup = false;
              }} @keydown=${(event: KeyboardEvent) => event.stopPropagation()}>
                <input name="group" maxlength="64" required placeholder="Group name" aria-label="Group name" />
                <button type="submit">Create group</button>
                <button type="button" @click=${() => { this.creatingGroup = false; }}>Cancel</button>
              </form>
            ` : html`<button type="button" class="add-group" @click=${async () => {
              this.creatingGroup = true;
              await this.updateComplete;
              this.renderRoot.querySelector<HTMLInputElement>('input[name="group"]')?.focus();
            }}>+ New group</button>`}
          </div>
        </div>
      </pf-card>
    `;
  }

  private renderGroups(parent: string): TemplateResult {
    return html`${repeat(this.controller.groupsIn(parent), (group) => group, (group) => renderPresetGroup({
      group,
      controller: this.controller,
      open: this.controller.openGroups.has(group) || this.destination?.group === group,
      renaming: this.renamingGroup === group,
      dragging: this.draggingGroup === group,
      drop: this.groupDestination?.target === group ? this.groupDestination.position : "",
      startDrag: (event) => this.startDrag(event),
      trackDrag: (event) => this.trackGroupDrag(event, group),
      finishDrag: (event) => this.finishDrag(event),
      rename: (group) => this.editName("group", group),
      content: () => html`${this.renderList(group)}${this.renderGroups(group)}`,
    }))}`;
  }

  private renderList(group: string) {
    const presets = this.controller.presets.filter((preset) => preset.group === group);
    const showPreview = this.dragging && this.destination?.group === group;
    const entries = presets.map((preset) => ({ key: preset.id, preset, preview: false }));
    if (showPreview && this.dragging) {
      const before = entries.findIndex(({ key }) => key === this.destination?.beforeId);
      entries.splice(before < 0 ? entries.length : before, 0, {
        key: "drag-preview",
        preset: this.dragging,
        preview: true,
      });
    }
    return html`
      <div class="list">
        ${repeat(entries, (entry) => entry.key, ({ preset, preview }) => preview
          ? html`<div class="preset drag-preview" aria-hidden="true"><span class="select">${preset.name}</span></div>`
          : this.renderPreset(preset))}
        ${!showPreview && !presets.some((preset) => preset.id !== this.dragging?.id)
          ? html`<p class="empty">${this.dragging ? "Drop preset here" : group ? "No presets in this group" : "No ungrouped presets"}</p>`
          : nothing}
      </div>
    `;
  }

  private renderPreset(preset: PostProcessPreset) {
    const controller = this.controller;
    const renaming = this.renamingPreset === preset.id;
    return html`
      <div
        class="preset ${controller.isActive(preset) ? "active" : ""} ${this.dragging?.id === preset.id ? "drag-source" : ""}"
        data-id=${preset.id}
        @mouseenter=${() => { if (!this.dragging && !this.draggingGroup && !this.renamingPreset && !this.renamingGroup) controller.preview(preset); }}
        @mouseleave=${() => controller.stopPreview()}
      >
        <button
          type="button"
          class="drag-handle"
          title="Drag to move ${preset.name}"
          aria-label="Move ${preset.name}"
          @pointerdown=${this.startDrag}
          @pointermove=${(event: PointerEvent) => this.trackDrag(event, preset)}
          @pointerup=${this.finishDrag}
          @pointercancel=${this.finishDrag}
          @lostpointercapture=${this.finishDrag}
        >⠿</button>
        ${renaming ? renderInlineName(preset.name, "Preset", (name) => controller.rename(preset, name),
          () => { this.renamingPreset = null; }) : html`
          <button type="button" class="select" title="Apply ${preset.name}"
            @click=${() => controller.apply(preset)}
          >${preset.name}</button>
        `}
        <button type="button" class="group-action" title="Rename ${preset.name}" aria-label="Rename ${preset.name}"
          @click=${() => this.editName("preset", renaming ? null : preset.id)}
        ><pf-icon name="pencil"></pf-icon></button>
        <button
          type="button"
          class="delete"
          title="Delete ${preset.name}"
          aria-label="Delete ${preset.name}"
          @click=${(event: Event) => { event.stopPropagation(); void controller.remove(preset); }}
        >
          <pf-icon name="x"></pf-icon>
        </button>
      </div>
    `;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "pf-post-presets-card": PfPostPresetsCard;
  }
}

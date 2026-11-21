import { html, nothing, type TemplateResult } from "lit";
import { renderInlineName } from "./post-preset-inline-name";
import type { PostPresetsController } from "./post-presets-controller";

export interface GroupDrop {
  target: string;
  parent: string;
  before: string | null;
  position: "before" | "after" | "inside";
}

export function findGroupDrop(
  hit: Element | null | undefined, y: number, source: string, controller: PostPresetsController,
): GroupDrop | null {
  const zone = hit?.closest<HTMLElement>("[data-group]");
  if (!zone) return null;
  const target = zone.dataset.group ?? "";
  if (target && !controller.canMoveGroup(source, target)) return null;
  const header = hit?.closest(".group-header");
  const bounds = header?.getBoundingClientRect();
  const relative = bounds && bounds.height > 0 ? (y - bounds.top) / bounds.height : 0.5;
  if (!target || (relative >= 0.25 && relative <= 0.75)) {
    return { target, parent: target, before: null, position: "inside" };
  }

  const parent = controller.parentGroup(target);
  const siblings = controller.groupsIn(parent).filter((group) => group !== source);
  const before = relative < 0.25;
  return {
    target,
    parent,
    before: before ? target : siblings[siblings.indexOf(target) + 1] ?? null,
    position: before ? "before" : "after",
  };
}

interface PresetGroupView {
  group: string;
  controller: PostPresetsController;
  open: boolean;
  renaming: boolean;
  dragging: boolean;
  drop: GroupDrop["position"] | "";
  startDrag(event: PointerEvent): void;
  trackDrag(event: PointerEvent): void;
  finishDrag(event: PointerEvent): void;
  rename(group: string | null): Promise<void>;
  content(): TemplateResult;
}

export function renderPresetGroup(view: PresetGroupView): TemplateResult {
  const { group, controller } = view;
  return html`
    <section class="preset-group" data-group=${group} data-drop=${view.drop} ?data-dragging=${view.dragging}>
      <div class="group-header">
        <button class="drag-handle" type="button" title="Drag to reorder or nest ${group}" aria-label="Drag ${group}"
          @pointerdown=${view.startDrag}
          @pointermove=${view.trackDrag}
          @pointerup=${view.finishDrag}
          @pointercancel=${view.finishDrag}
          @lostpointercapture=${view.finishDrag}
        >⠿</button>
        ${view.renaming ? renderInlineName(group, "Group", (name) => controller.renameGroup(group, name),
          () => { void view.rename(null); }) : html`
          <button class="group-toggle" type="button" aria-expanded=${view.open} title=${group}
            @click=${() => controller.toggleGroup(group)}
          ><pf-icon name="chevron-down"></pf-icon><span>${group}</span></button>
        `}
        <button class="group-action" type="button" title="Rename ${group}" aria-label="Rename ${group}"
          @click=${() => view.rename(view.renaming ? null : group)}
        ><pf-icon name="pencil"></pf-icon></button>
        <button class="group-action" type="button" title="Delete ${group}" aria-label="Delete ${group}"
          @click=${async () => {
            if (await controller.deleteGroup(group) && view.renaming) await view.rename(null);
          }}
        ><pf-icon name="x"></pf-icon></button>
      </div>
      <div class="group-content" ?hidden=${!view.open}>
        ${view.open ? view.content() : nothing}
      </div>
    </section>
  `;
}

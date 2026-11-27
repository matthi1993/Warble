import { html, type TemplateResult } from "lit";
import type { FullViewController } from "./full-view-controller";
import type { OriginalPreviewController } from "./original-preview-controller";

function beginCompare(compare: OriginalPreviewController, event: PointerEvent): void {
  if (!compare.begin()) return;
  event.preventDefault();
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    // Without capture the compare still ends on pointerleave.
  }
}

function renderBusyIcon(busy: boolean, icon: string): TemplateResult {
  return busy
    ? html`<span class="footer-btn-spinner" aria-hidden="true"></span>`
    : html`<pf-icon name=${icon}></pf-icon>`;
}

export function renderEditFooter(view: FullViewController): TemplateResult {
  const { editing, compare, variants } = view;
  const endCompare = () => compare.show(false);
  return html`
    <div slot="footer" class="edit-footer">
      <div class="edit-footer-row">
        <button
          type="button"
          class="footer-btn"
          aria-pressed=${compare.showing}
          aria-label="Compare before and after edits"
          title="Hold to compare before / after edits"
          ?disabled=${!compare.available}
          @pointerdown=${(event: PointerEvent) => beginCompare(compare, event)}
          @pointerup=${endCompare}
          @pointercancel=${endCompare}
          @pointerleave=${endCompare}
        >
          <pf-icon name="compare"></pf-icon>
          <span>Before / After</span>
        </button>
        <button
          type="button"
          class="footer-btn"
          title="Revert all edits"
          aria-label="Revert all edits"
          ?disabled=${!editing.hasAnyEdit()}
          @click=${() => editing.resetAll()}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
          <span>Revert all</span>
        </button>
      </div>
      <div class="edit-footer-row">
        <button
          type="button"
          class="footer-btn"
          aria-label=${variants.savingVariant ? "Saving edited image as a variant" : "Save edited image as a variant"}
          aria-busy=${variants.savingVariant ? "true" : "false"}
          title="Save edited image as a JPEG variant"
          ?disabled=${variants.busy}
          @click=${() => variants.save()}
        >
          ${renderBusyIcon(variants.savingVariant, "save")}
          <span>${variants.savingVariant ? "Saving…" : "Save Variant"}</span>
        </button>
        <button
          type="button"
          class="footer-btn danger"
          aria-label=${variants.deletingVariant ? "Deleting current image" : "Delete current image"}
          aria-busy=${variants.deletingVariant ? "true" : "false"}
          title="Move current image to the Bin"
          ?disabled=${variants.busy}
          @click=${() => variants.deleteVariant()}
        >
          ${renderBusyIcon(variants.deletingVariant, "trash")}
          <span>${variants.deletingVariant ? "Deleting…" : "Delete Variant"}</span>
        </button>
      </div>
    </div>
  `;
}

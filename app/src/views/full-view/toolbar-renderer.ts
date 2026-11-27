import { html, type TemplateResult } from "lit";
import { availableVariants, RAW_EXTS, type Photo } from "@warble/library";
import { DeviceProfile } from "./device-profile";
import type { FullViewController } from "./full-view-controller";
import type { VariantSelection } from "./variant-resolver";

function renderEditMark(edited: boolean): TemplateResult | null {
  return edited ? html`<span class="edit-mark" aria-label="Edited">*</span>` : null;
}

function renderVariantMenu(view: FullViewController, photo: Photo, selection: VariantSelection): TemplateResult | null {
  const variants = availableVariants(photo, selection.format);
  if (variants.length === 0) return null;
  const open = view.menus.open === "variant";
  const hasEdits = (variant: string) => view.variants.hasEdits(photo, selection.format, variant);
  return html`<span class="menu-wrap">
    <button
      class="menu-trigger"
      type="button"
      aria-haspopup="menu"
      aria-expanded=${open}
      @click=${() => view.menus.toggle("variant")}
    >
      ${variants.find((variant) => variant.key === selection.variant)?.label ?? selection.variant}
      ${renderEditMark(hasEdits(selection.variant))}
      <pf-icon name="chevron-down"></pf-icon>
    </button>
    ${open
      ? html`<div class="menu-popup" role="menu">
          ${variants.map(
            (variant) => html`<button
              class="menu-item"
              role="menuitemradio"
              aria-pressed=${selection.variant === variant.key}
              @click=${() => view.variants.select(variant.key)}
            >
              ${variant.label} ${renderEditMark(hasEdits(variant.key))}
            </button>`,
          )}
        </div>`
      : null}
  </span>`;
}

export function renderToolbar(view: FullViewController, photo: Photo): TemplateResult {
  const { stage, variants, externalApps, host } = view;
  const selection = view.resolver.currentSelection(photo);
  const rawFile = photo.files?.find((file) => RAW_EXTS.includes(file.extension.toLowerCase()));
  return html`
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="filename" title=${photo.filename}>${photo.filename}</span>
        <span class="counter">${stage.index + 1} / ${stage.photos.length}</span>
      </div>
      <div class="toolbar-center">
        ${rawFile
          ? html`<button
              class="menu-trigger"
              type="button"
              ?disabled=${externalApps.openingRaw}
              @click=${() => externalApps.openRaw(rawFile.path)}
            >
              ${externalApps.openingRaw ? "Opening RAW…" : "Open RAW in…"}
            </button>`
          : null}
        ${selection ? renderVariantMenu(view, photo, selection) : null}
        <pf-icon-button
          icon="share"
          label=${externalApps.openingIn ? "Opening…" : "Open In…"}
          ?disabled=${externalApps.openingIn}
          @click=${() => externalApps.openDisplayedImage()}
        ></pf-icon-button>
        <pf-icon-button
          icon="trash"
          danger
          label=${variants.deletingPhoto ? "Moving photo to Bin…" : "Delete photo and all variants (Delete)"}
          ?loading=${variants.deletingPhoto}
          ?disabled=${variants.busy}
          @click=${() => variants.deletePhoto()}
        ></pf-icon-button>
      </div>
      <div class="toolbar-right">
        ${DeviceProfile.current().isIPad
          ? null
          : html`<pf-icon-button
              icon=${host.windowFullscreen ? "minimize" : "maximize"}
              label=${host.windowFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              @click=${() => view.events.toggleWindowFullscreen()}
            ></pf-icon-button>`}
      </div>
    </div>
  `;
}

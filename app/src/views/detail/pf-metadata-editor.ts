import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { EditableMetadataField } from "@warble/library";
import { app } from "@app/composition/app";
import { MetadataEditorController } from "./metadata-editor-controller";
import { metadataEditorStyles } from "./pf-metadata-editor.styles";

const TEXT_FIELDS: readonly { key: Exclude<EditableMetadataField, "dateTaken">; label: string }[] = [
  { key: "artist", label: "Artist / photographer" },
  { key: "copyright", label: "Copyright" },
  { key: "cameraMake", label: "Camera make" },
  { key: "cameraModel", label: "Camera model" },
  { key: "lensModel", label: "Lens model" },
];

@customElement("pf-metadata-editor")
export class PfMetadataEditor extends LitElement {
  static styles = metadataEditorStyles;

  @property({ attribute: false })
  paths: string[] = [];

  private readonly editor = new MetadataEditorController(this, app.library.exif, app.platform.library);
  private readonly onKeyDown = (event: KeyboardEvent): void => this.editor.onKeyDown(event);

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown, true);
    this.editor.load();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown, true);
  }

  private setField(key: EditableMetadataField, event: Event): void {
    this.editor.setField(key, (event.target as HTMLInputElement).value);
  }

  private renderFields() {
    const { editor } = this;
    return html`
      <label>Capture date and time
        <input type="datetime-local" step="1" .value=${editor.fieldValue("dateTaken")}
          @change=${(event: Event) => this.setField("dateTaken", event)} />
      </label>
      ${TEXT_FIELDS.map(({ key, label }) => html`<label>${label}
        <input type="text" .value=${editor.fieldValue(key)}
          placeholder=${editor.multiple ? "Leave unchanged" : ""}
          @input=${(event: Event) => this.setField(key, event)} />
      </label>`)}
    `;
  }

  render() {
    const { editor } = this;
    const count = this.paths.length;
    return html`
      <div class="backdrop" @click=${() => editor.closeUnlessSaving()}></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="metadata-title">
        <header><h2 id="metadata-title">Edit metadata</h2><button type="button" aria-label="Close" @click=${() => editor.close()}>×</button></header>
        <main>
          <p>${editor.multiple ? `Editing ${count} photos. Only fields you change will be applied to all selected photos. Clear a field to remove its value.` : "Changes are saved beside the photo; the original image is not modified."}</p>
          ${editor.loading ? html`<p>Loading metadata…</p>` : this.renderFields()}
          ${editor.error ? html`<p class="error" role="alert">${editor.error}</p>` : null}
        </main>
        <footer>
          <button type="button" @click=${() => editor.close()} ?disabled=${editor.saving}>Cancel</button>
          <button type="button" class="primary" @click=${() => editor.save()} ?disabled=${editor.loading || editor.saving}>
            ${editor.saving ? "Saving…" : `Save${editor.multiple ? ` ${count} photos` : ""}`}
          </button>
        </footer>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-metadata-editor": PfMetadataEditor;
  }
}

import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import type { ExifMetadata } from "@domain/exif";
import { fetchExif } from "@services/exif/exif-service";

type EditableField = "dateTaken" | "artist" | "copyright" | "cameraMake" | "cameraModel" | "lensModel";
type Changes = Partial<Record<EditableField, string>>;

const fields: { key: Exclude<EditableField, "dateTaken">; label: string }[] = [
  { key: "artist", label: "Artist / photographer" },
  { key: "copyright", label: "Copyright" },
  { key: "cameraMake", label: "Camera make" },
  { key: "cameraModel", label: "Camera model" },
  { key: "lensModel", label: "Lens model" },
];

@customElement("pf-metadata-editor")
export class PfMetadataEditor extends LitElement {
  static styles = css`
    :host { position: fixed; inset: 0; z-index: 12000; }
    .backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, .65); }
    .sheet { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(480px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 32px));
      overflow-y: auto; box-sizing: border-box; border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-lg); background: var(--pf-surface); color: var(--pf-text);
      box-shadow: 0 24px 80px rgba(0,0,0,.5); }
    header, footer { display: flex; align-items: center; justify-content: space-between;
      gap: var(--pf-space-3); padding: var(--pf-space-3) var(--pf-space-4); }
    header { border-bottom: 1px solid var(--pf-border); }
    footer { border-top: 1px solid var(--pf-border); justify-content: flex-end; }
    h2 { font-size: var(--pf-text-lg); margin: 0; }
    main { display: grid; gap: var(--pf-space-3); padding: var(--pf-space-4); }
    p { color: var(--pf-text-muted); font-size: var(--pf-text-sm); margin: 0; }
    label { display: grid; gap: 5px; font-size: var(--pf-text-sm); }
    input { box-sizing: border-box; width: 100%; min-height: 36px; padding: 7px 10px;
      border: 1px solid var(--pf-border); border-radius: var(--pf-radius-md);
      background: var(--pf-surface-2); color: var(--pf-text); font: inherit; }
    input:focus-visible, button:focus-visible { outline: 2px solid var(--pf-accent); outline-offset: 2px; }
    button { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-md);
      padding: 8px 12px; background: var(--pf-surface-2); color: var(--pf-text);
      font: inherit; cursor: pointer; }
    button.primary { border-color: var(--pf-accent); background: var(--pf-accent); color: var(--pf-accent-contrast); }
    button:disabled { opacity: .55; cursor: default; }
    .error { color: var(--pf-danger); }
  `;

  @property({ attribute: false }) paths: string[] = [];
  @state() private original: ExifMetadata = {};
  @state() private changes: Changes = {};
  @state() private loading = true;
  @state() private saving = false;
  @state() private error = "";

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown, true);
    if (this.paths.length === 1) {
      void fetchExif(this.paths[0]).then((meta) => { this.original = meta; })
        .catch((error) => { this.error = String(error); })
        .finally(() => { this.loading = false; });
    } else {
      this.loading = false;
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown, true);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopImmediatePropagation();
      if (!this.saving) this.close();
    }
  };

  private close(): void { this.dispatchEvent(new Event("close")); }

  private setField(key: EditableField, event: Event): void {
    this.changes = { ...this.changes, [key]: (event.target as HTMLInputElement).value };
  }

  private captureDate(): string {
    const date = this.original.dateTaken ?? "";
    const match = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(date);
    return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4] ?? "00"}:${match[5] ?? "00"}:${match[6] ?? "00"}` : "";
  }

  private async save(): Promise<void> {
    if (!Object.keys(this.changes).length) { this.close(); return; }
    this.saving = true;
    this.error = "";
    const changes = { ...this.changes };
    if (changes.dateTaken) changes.dateTaken = changes.dateTaken.replace("T", " ");
    try {
      await invoke("set_photo_metadata", { photoPaths: this.paths, changes });
      this.dispatchEvent(new CustomEvent("metadata-saved", {
        detail: { paths: this.paths, ...changes }, bubbles: true, composed: true,
      }));
      this.close();
    } catch (error) {
      this.error = `Could not save metadata: ${String(error)}`;
    } finally {
      this.saving = false;
    }
  }

  render() {
    const multiple = this.paths.length > 1;
    return html`
      <div class="backdrop" @click=${() => { if (!this.saving) this.close(); }}></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="metadata-title">
        <header><h2 id="metadata-title">Edit metadata</h2><button type="button" aria-label="Close" @click=${() => this.close()}>×</button></header>
        <main>
          <p>${multiple ? `Editing ${this.paths.length} photos. Only fields you change will be applied to all selected photos. Clear a field to remove its value.` : "Changes are saved beside the photo; the original image is not modified."}</p>
          ${this.loading ? html`<p>Loading metadata…</p>` : html`
            <label>Capture date and time
              <input type="datetime-local" step="1" .value=${this.changes.dateTaken ?? (multiple ? "" : this.captureDate())}
                @change=${(e: Event) => this.setField("dateTaken", e)} />
            </label>
            ${fields.map(({ key, label }) => html`<label>${label}
              <input type="text" .value=${this.changes[key] ?? (multiple ? "" : this.original[key] ?? "")}
                placeholder=${multiple ? "Leave unchanged" : ""}
                @input=${(e: Event) => this.setField(key, e)} />
            </label>`)}
          `}
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : null}
        </main>
        <footer>
          <button type="button" @click=${() => this.close()} ?disabled=${this.saving}>Cancel</button>
          <button type="button" class="primary" @click=${() => this.save()} ?disabled=${this.loading || this.saving}>
            ${this.saving ? "Saving…" : `Save${multiple ? ` ${this.paths.length} photos` : ""}`}
          </button>
        </footer>
      </section>
    `;
  }
}

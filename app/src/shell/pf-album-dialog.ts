import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Album } from "@warble/library";
import { albumDialogStyles } from "./pf-album-dialog.styles";

@customElement("pf-album-dialog")
export class PfAlbumDialog extends LitElement {
  static styles = albumDialogStyles;

  @property({ attribute: false }) album!: Album | "new";
  @property({ type: String }) error = "";

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("album")) this.renderRoot.querySelector<HTMLInputElement>("input")?.focus();
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent("dialog-close"));
  }

  private submit(event: SubmitEvent): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    this.dispatchEvent(new CustomEvent("album-save", {
      detail: { name: String(data.get("name") ?? ""), description: String(data.get("description") ?? "") },
    }));
  }

  render() {
    const album = this.album;
    const creating = album === "new";
    const title = creating ? "Create album" : "Edit album";
    return html`
      <div class="album-dialog-backdrop" @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget) this.close();
      }}>
        <form class="album-dialog" role="dialog" aria-modal="true" aria-label=${title} @submit=${this.submit}>
          <h2>${title}</h2>
          <label>Name <input name="name" required maxlength="200" .value=${creating ? "" : album.name} autofocus /></label>
          <label>Description <textarea name="description" .value=${creating ? "" : album.description}></textarea></label>
          ${this.error ? html`<p class="album-error" role="alert">${this.error}</p>` : null}
          <div class="album-dialog-actions">
            <button type="button" @click=${() => this.close()}>Cancel</button>
            <button type="submit">${creating ? "Create album" : "Save changes"}</button>
          </div>
        </form>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-album-dialog": PfAlbumDialog;
  }
}

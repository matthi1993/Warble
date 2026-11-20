import { LitElement, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { app } from "@app/composition/app";
import type { CacheSettings } from "@app/state/cache-settings-store";
import { settingsStyles } from "./pf-settings.styles";
import { SettingsController, type SettingsHost } from "./settings-controller";

const WORKER_COUNTS = Array.from({ length: 16 }, (_, index) => index + 1);

@customElement("pf-settings")
export class PfSettings extends LitElement implements SettingsHost {
  static styles = settingsStyles;

  private readonly settings = new SettingsController(this, {
    cacheSettings: app.cacheSettings,
    settings: app.platform.settings,
    workspace: app.platform.library,
    dialogs: app.platform.dialogs,
    textFiles: app.platform.textFiles,
    presets: app.editing.presets,
  });
  private previousFocus: HTMLElement | null = null;

  async open(): Promise<void> {
    this.previousFocus = document.activeElement as HTMLElement | null;
    this.settings.show();
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(".sheet")?.focus();
    await this.settings.load();
  }

  announceWorkspaceReset(): void {
    this.dispatchEvent(new CustomEvent("workspace-reset-starting", { bubbles: true, composed: true }));
  }

  reloadApp(): void {
    window.location.reload();
  }

  private readonly close = (): void => {
    if (this.settings.close()) this.previousFocus?.focus();
  };

  private async save(): Promise<void> {
    if (await this.settings.save()) this.previousFocus?.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.settings.visible) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      this.close();
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...this.renderRoot.querySelectorAll<HTMLElement>(
        "button:not(:disabled), select:not(:disabled), input:not(:disabled)",
      ),
    ];
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = this.shadowRoot?.activeElement;
    const leavingSheet = event.shiftKey ? active === first || active?.classList.contains("sheet") : active === last;
    if (!leavingSheet) return;
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }

  private renderToggle(key: keyof CacheSettings, title: string, detail: string) {
    const { saving, loaded, draft } = this.settings;
    return html`<div class="row"><label for=${key}>${title}<small>${detail}</small></label><input id=${key}
      ?disabled=${saving || !loaded} type="checkbox" .checked=${draft[key] as boolean}
      @change=${(event: Event) => this.settings.setBoolean(key, (event.target as HTMLInputElement).checked)} /></div>`;
  }

  private renderSelect(key: keyof CacheSettings, title: string, detail: string, values: number[], unit: string) {
    const { saving, loaded, draft } = this.settings;
    const label = (value: number) => (value === 0 ? "Off" : `${value.toLocaleString()}${unit ? ` ${unit}` : ""}`);
    return html`<div class="row"><label for=${key}>${title}<small>${detail}</small></label><select id=${key}
      ?disabled=${saving || !loaded}
      @change=${(event: Event) => this.settings.setNumber(key, (event.target as HTMLSelectElement).value)}
      >${values.map((value) => html`<option value=${value} ?selected=${value === draft[key]}>${label(value)}</option>`)}</select></div>`;
  }

  private renderStorageSummary() {
    const usage = this.settings.usage;
    if (!usage) return nothing;
    return html`<div class="storage-summary">
      <div class="storage-stat"><strong>Thumbnails</strong><span>${this.settings.usageSummary(usage.thumbnail)}</span></div>
      <div class="storage-stat"><strong>HD previews</strong><span>${this.settings.usageSummary(usage.hd_image)}</span></div>
    </div>`;
  }

  render() {
    const settings = this.settings;
    if (!settings.visible) return nothing;
    const { saving, loaded } = settings;
    return html`<div class="backdrop" @keydown=${this.onKeyDown} @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.close(); }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
        <header><h2 id="settings-title">Settings</h2><button ?disabled=${saving} @click=${this.close} aria-label="Close settings">✕</button></header>
        <main>
          <section>
            <div class="heading"><h3>Performance</h3><p class="note">Balance background speed, memory use, and battery life.</p></div>
            ${this.renderSelect("parallel_workers", "Parallel workers", "Thumbnail, image, and metadata tasks. Lower values use less memory; with two or more workers, one stays ready for browsing.", WORKER_COUNTS, "")}
            ${this.renderToggle("full_resolution_enabled", "Full-resolution preview", "Load the original after a pause. Editing uses a fast HD preview; saved variants retain full quality.")}
          </section>
          <section>
            <div class="heading"><h3>Storage &amp; memory</h3><p class="note">Retain previews to open photos faster. Disk caches are off by default.</p></div>
            ${this.renderSelect("thumbnail_disk_max_entries", "Thumbnails on disk", "Small previews for the photo grid", [0, 1000, 5000, 10000, 25000], "files")}
            ${this.renderSelect("hd_image_disk_max_entries", "HD previews on disk", "1920px previews for browsing and editing", [0, 500, 1000, 2000, 5000], "files")}
            ${this.renderSelect("full_image_memory_max_entries", "Originals in memory", "Encoded image data", [0, 2, 4, 8, 16], "images")}
            ${this.renderSelect("full_image_bitmap_max_entries", "Decoded originals in memory", "Each image can use 100 MB or more", [1, 2, 4, 8], "images")}
            ${this.renderStorageSummary()}
          </section>
          <section>
            <h3>Presets</h3>
            <p class="note">Export or import all post-processing presets as a JSON file. Imported presets are added to your existing presets.</p>
            <div class="preset-actions">
              <button type="button" @click=${() => settings.exportPresets()}>Export presets as JSON</button>
              <button type="button" @click=${() => settings.importPresets()}>Import presets as JSON</button>
            </div>
            ${settings.presetFeedback ? html`<p class="feedback" role="status">${settings.presetFeedback}</p>` : nothing}
          </section>
          <section class="workspace">
            <h3>Workspace</h3>
            <p class="note">Start with an empty library. This forgets imported folders and deletes all SQLite library data, including ratings, edits, metadata, and saved library settings. Photos and sidecar files on disk are never deleted. Adding the same folders again may restore metadata from sidecars.</p>
            <div><button type="button" class="danger" ?disabled=${saving} @click=${() => settings.resetWorkspace()}>Reset workspace…</button></div>
          </section>
          ${settings.error ? html`<div class="error">${settings.error}</div>` : nothing}
        </main>
        <footer><span class="note" style="flex: 1">Saved on this device</span><button ?disabled=${saving} @click=${this.close}>Cancel</button><button class="primary" ?disabled=${saving || !loaded} @click=${this.save}>${saving ? "Saving…" : "Save settings"}</button></footer>
      </div></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-settings": PfSettings;
  }
}

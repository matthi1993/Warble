import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { confirm, open as openFile, save as saveFile } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  configureCacheSettings,
  getCacheSettings,
  saveCacheSettings,
  type CacheSettings,
} from "@services/settings/cache-settings";
import {
  exportPostProcessPresets,
  importPostProcessPresets,
  loadPostProcessPresets,
} from "@services/post-process/post-process-presets-store";

interface UsageEntry { path: string | null; bytes: number; files: number }
interface CacheUsage {
  thumbnail: UsageEntry;
  hd_image: UsageEntry;
}

@customElement("pf-settings")
export class PfSettings extends LitElement {
  static styles = css`
    :host { position: fixed; inset: 0; z-index: 12000; pointer-events: none; }
    .backdrop { position: absolute; inset: 0; display: grid; place-items: center; padding: 20px;
      background: rgba(0,0,0,.55); pointer-events: auto; }
    .sheet { width: min(680px, 100%); max-height: min(860px, calc(100dvh - 40px)); overflow: auto;
      box-sizing: border-box; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-lg);
      background: var(--pf-surface); color: var(--pf-text); box-shadow: 0 20px 60px rgba(0,0,0,.45); }
    header, footer { position: sticky; background: var(--pf-surface); display: flex; align-items: center;
      gap: 12px; padding: 16px 18px; z-index: 1; }
    header { top: 0; border-bottom: 1px solid var(--pf-border); }
    footer { bottom: 0; justify-content: flex-end; border-top: 1px solid var(--pf-border); }
    h2 { margin: 0; flex: 1; font-size: var(--pf-text-lg); }
    main { padding: 20px; display: grid; gap: 16px; background: var(--pf-bg); }
    section { display: grid; gap: 12px; padding: 18px; border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-lg); background: var(--pf-surface); }
    h3 { margin: 0; font-size: var(--pf-text-sm); font-weight: 650; }
    .heading { display: grid; gap: 5px; }
    .row + .row { border-top: 1px solid var(--pf-border); padding-top: 12px; }
    .storage-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .storage-stat { padding: 12px; background: var(--pf-surface-2); border-radius: var(--pf-radius-md); }
    .storage-stat strong { display: block; font-size: var(--pf-text-sm); margin-bottom: 4px; }
    .storage-stat span { color: var(--pf-text-muted); font-size: var(--pf-text-xs); }
    .workspace { border-color: color-mix(in srgb, var(--pf-danger) 25%, var(--pf-border)); }
    @media (max-width: 480px) {
      .backdrop { padding: 10px; }
      .sheet { max-height: calc(100dvh - 20px); }
      main { padding: 12px; }
      section { padding: 14px; }
      .row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
      input[type=checkbox] { justify-self: start; }
      select { width: 100%; }
    }
    .note { margin: 0; color: var(--pf-text-muted); font-size: var(--pf-text-xs); line-height: 1.45; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center;
      min-height: 42px; }
    label { font-size: var(--pf-text-sm); }
    label small { display: block; margin-top: 3px; color: var(--pf-text-muted); line-height: 1.35; }
    input[type=checkbox] { width: 20px; height: 20px; accent-color: var(--pf-accent); }
    select, button { min-height: 38px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-md);
      background: var(--pf-surface-2); color: var(--pf-text); padding: 0 11px; font: inherit; }
    button { cursor: pointer; touch-action: manipulation; }
    button.primary { background: var(--pf-accent); color: var(--pf-accent-contrast, white); border-color: transparent; }
    button.danger { color: var(--pf-danger); border-color: var(--pf-danger); }
    button:disabled { opacity: .55; cursor: default; }
    .preset-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .feedback { margin: 0; color: var(--pf-text-muted); font-size: var(--pf-text-xs); }
    .error { color: var(--pf-danger); font-size: var(--pf-text-xs); }
    @media (pointer: coarse) { select, button { min-height: 46px; } .row { min-height: 50px; } }
  `;

  @state() private visible = false;
  @state() private draft: CacheSettings = { ...getCacheSettings() };
  @state() private usage: CacheUsage | null = null;
  @state() private saving = false;
  @state() private loaded = false;
  @state() private error = "";
  @state() private presetFeedback = "";
  private previousFocus: HTMLElement | null = null;

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.visible) return;
    if (event.key === "Escape") { event.stopPropagation(); this.close(); }
    if (event.key !== "Tab") return;
    const controls = [...this.renderRoot.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled)")];
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = this.shadowRoot?.activeElement;
    if (event.shiftKey ? active === first || active?.classList.contains("sheet") : active === last) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  };

  async open(): Promise<void> {
    this.error = "";
    this.presetFeedback = "";
    this.loaded = false;
    this.previousFocus = document.activeElement as HTMLElement | null;
    this.usage = null;
    this.visible = true;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(".sheet")?.focus();
    try {
      await configureCacheSettings();
      this.draft = { ...await invoke<CacheSettings>("get_cache_settings") };
      this.loaded = true;
    } catch (error) {
      this.error = `Could not load cache settings: ${String(error)}`;
      return;
    }
    try { this.usage = await invoke<CacheUsage>("get_cache_disk_usage"); }
    catch { this.usage = null; }
  }

  private close = () => {
    if (this.saving) return;
    this.visible = false;
    this.previousFocus?.focus();
  };

  private setNumber(key: keyof CacheSettings, event: Event) {
    this.draft = { ...this.draft, [key]: Number((event.target as HTMLSelectElement).value) };
  }

  private setBoolean(key: keyof CacheSettings, event: Event) {
    this.draft = { ...this.draft, [key]: (event.target as HTMLInputElement).checked };
  }

  private async save() {
    this.saving = true; this.error = "";
    try { await saveCacheSettings(this.draft); this.saving = false; this.close(); }
    catch (error) { this.error = String(error); }
    finally { this.saving = false; }
  }

  private async resetWorkspace() {
    if (this.saving) return;
    const accepted = await confirm(
      "Remove all imported folders, ratings, edits, cached metadata, and other SQLite library data? Your photos and sidecar files will NOT be deleted. Sidecar metadata may be restored if you add the same folders again.",
      { title: "Reset workspace", kind: "warning", okLabel: "Reset workspace", cancelLabel: "Cancel" },
    );
    if (!accepted) return;
    this.saving = true;
    this.error = "";
    try {
      this.dispatchEvent(new CustomEvent("workspace-reset-starting", { bubbles: true, composed: true }));
      await invoke("reset_workspace");
      window.location.reload();
    } catch (error) {
      this.error = `Workspace reset failed: ${String(error)}`;
      this.saving = false;
    }
  }

  private async exportPresets() {
    this.presetFeedback = "";
    try {
      await loadPostProcessPresets();
      const path = await saveFile({
        defaultPath: "warble-presets.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFile(path, exportPostProcessPresets());
      this.presetFeedback = "Presets exported.";
    } catch (error) {
      this.presetFeedback = `Export failed: ${String(error)}`;
    }
  }

  private async importPresets() {
    this.presetFeedback = "";
    try {
      await loadPostProcessPresets();
      const selected = await openFile({
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      const count = importPostProcessPresets(await readTextFile(path));
      this.presetFeedback = count === 0
        ? "No presets were found in that file."
        : `${count} preset${count === 1 ? "" : "s"} imported.`;
    } catch (error) {
      this.presetFeedback = `Import failed: ${String(error)}`;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  render() {
    if (!this.visible) return nothing;
    const s = this.draft;
    return html`<div class="backdrop" @keydown=${this.onKeyDown} @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) this.close(); }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
        <header><h2 id="settings-title">Settings</h2><button ?disabled=${this.saving} @click=${this.close} aria-label="Close settings">✕</button></header>
        <main>
          <section>
            <div class="heading"><h3>Performance</h3><p class="note">Balance background speed, memory use, and battery life.</p></div>
            ${this.select("parallel_workers", "Parallel workers", "Thumbnail, image, and metadata tasks. Lower values use less memory; with two or more workers, one stays ready for browsing.", Array.from({ length: 16 }, (_, index) => index + 1), "")}
            ${this.toggle("full_resolution_enabled", "Full-resolution preview", "Load the original after a pause. Editing uses a fast HD preview; saved variants retain full quality.", s.full_resolution_enabled)}
          </section>
          <section>
            <div class="heading"><h3>Storage &amp; memory</h3><p class="note">Retain previews to open photos faster. Disk caches are off by default.</p></div>
            ${this.select("thumbnail_disk_max_entries", "Thumbnails on disk", "Small previews for the photo grid", [0,1000,5000,10000,25000], "files")}
            ${this.select("hd_image_disk_max_entries", "HD previews on disk", "1920px previews for browsing and editing", [0,500,1000,2000,5000], "files")}
            ${this.select("full_image_memory_max_entries", "Originals in memory", "Encoded image data", [0,2,4,8,16], "images")}
            ${this.select("full_image_bitmap_max_entries", "Decoded originals in memory", "Each image can use 100 MB or more", [1,2,4,8], "images")}
            ${this.usage ? html`<div class="storage-summary">
              <div class="storage-stat"><strong>Thumbnails</strong><span>${this.formatBytes(this.usage.thumbnail.bytes)} · ${this.usage.thumbnail.files.toLocaleString()} files</span></div>
              <div class="storage-stat"><strong>HD previews</strong><span>${this.formatBytes(this.usage.hd_image.bytes)} · ${this.usage.hd_image.files.toLocaleString()} files</span></div>
            </div>` : nothing}
          </section>
          <section>
            <h3>Presets</h3>
            <p class="note">Export or import all post-processing presets as a JSON file. Imported presets are added to your existing presets.</p>
            <div class="preset-actions">
              <button type="button" @click=${this.exportPresets}>Export presets as JSON</button>
              <button type="button" @click=${this.importPresets}>Import presets as JSON</button>
            </div>
            ${this.presetFeedback ? html`<p class="feedback" role="status">${this.presetFeedback}</p>` : nothing}
          </section>
          <section class="workspace">
            <h3>Workspace</h3>
            <p class="note">Start with an empty library. This forgets imported folders and deletes all SQLite library data, including ratings, edits, metadata, and saved library settings. Photos and sidecar files on disk are never deleted. Adding the same folders again may restore metadata from sidecars.</p>
            <div><button type="button" class="danger" ?disabled=${this.saving} @click=${this.resetWorkspace}>Reset workspace…</button></div>
          </section>
          ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        </main>
        <footer><span class="note" style="flex: 1">Saved on this device</span><button ?disabled=${this.saving} @click=${this.close}>Cancel</button><button class="primary" ?disabled=${this.saving || !this.loaded} @click=${this.save}>${this.saving ? "Saving…" : "Save settings"}</button></footer>
      </div></div>`;
  }

  private toggle(key: keyof CacheSettings, title: string, detail: string, checked: boolean) {
    return html`<div class="row"><label for=${key}>${title}<small>${detail}</small></label><input id=${key} ?disabled=${this.saving || !this.loaded} type="checkbox" .checked=${checked} @change=${(e: Event) => this.setBoolean(key, e)} /></div>`;
  }

  private select(key: keyof CacheSettings, title: string, detail: string, values: number[], unit: string) {
    return html`<div class="row"><label for=${key}>${title}<small>${detail}</small></label><select id=${key} ?disabled=${this.saving || !this.loaded} @change=${(e: Event) => this.setNumber(key, e)}>${values.map((value) => html`<option value=${value} ?selected=${value === this.draft[key]}>${value === 0 ? "Off" : `${value.toLocaleString()}${unit ? ` ${unit}` : ""}`}</option>`)}</select></div>`;
  }
}

declare global { interface HTMLElementTagNameMap { "pf-settings": PfSettings; } }

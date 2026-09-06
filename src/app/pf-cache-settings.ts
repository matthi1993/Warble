import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import {
  configureCacheSettings,
  getCacheSettings,
  saveCacheSettings,
  type CacheSettings,
} from "./cache-settings";

interface UsageEntry { path: string | null; bytes: number; files: number }
interface CacheUsage {
  thumbnail: UsageEntry;
  hd_image: UsageEntry;
  bg_thread_capacity: number;
}

@customElement("pf-cache-settings")
export class PfCacheSettings extends LitElement {
  static styles = css`
    :host { position: fixed; inset: 0; z-index: 12000; pointer-events: none; }
    .backdrop { position: absolute; inset: 0; display: grid; place-items: center; padding: 20px;
      background: rgba(0,0,0,.55); pointer-events: auto; }
    .sheet { width: min(620px, 100%); max-height: min(760px, calc(100vh - 40px)); overflow: auto;
      box-sizing: border-box; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-lg);
      background: var(--pf-surface); color: var(--pf-text); box-shadow: 0 20px 60px rgba(0,0,0,.45); }
    header, footer { position: sticky; background: var(--pf-surface); display: flex; align-items: center;
      gap: 12px; padding: 16px 18px; z-index: 1; }
    header { top: 0; border-bottom: 1px solid var(--pf-border); }
    footer { bottom: 0; justify-content: flex-end; border-top: 1px solid var(--pf-border); }
    h2 { margin: 0; flex: 1; font-size: var(--pf-text-lg); }
    main { padding: 16px 18px; display: grid; gap: 18px; }
    section { display: grid; gap: 10px; }
    h3 { margin: 0; font-size: var(--pf-text-sm); }
    .note { margin: 0; color: var(--pf-text-muted); font-size: var(--pf-text-xs); line-height: 1.45; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center;
      min-height: 42px; }
    label { font-size: var(--pf-text-sm); }
    label small { display: block; margin-top: 3px; color: var(--pf-text-muted); line-height: 1.35; }
    input[type=checkbox] { width: 20px; height: 20px; accent-color: var(--pf-accent); }
    select, button { min-height: 38px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-md);
      background: var(--pf-surface-2); color: var(--pf-text); padding: 0 11px; font: inherit; }
    button { cursor: pointer; }
    button.primary { background: var(--pf-accent); color: var(--pf-accent-contrast, white); border-color: transparent; }
    button:disabled { opacity: .55; cursor: default; }
    .usage { padding: 10px 12px; border-radius: var(--pf-radius-md); background: var(--pf-surface-2);
      color: var(--pf-text-muted); font-size: var(--pf-text-xs); line-height: 1.5; overflow-wrap: anywhere; }
    .error { color: var(--pf-danger); font-size: var(--pf-text-xs); }
    @media (pointer: coarse) { select, button { min-height: 46px; } .row { min-height: 50px; } }
  `;

  @state() private visible = false;
  @state() private draft: CacheSettings = { ...getCacheSettings() };
  @state() private usage: CacheUsage | null = null;
  @state() private saving = false;
  @state() private error = "";

  async open(): Promise<void> {
    this.visible = true;
    this.error = "";
    // `configureCacheSettings()` is a one-time startup load. Its promise can
    // therefore still resolve to the original snapshot after settings have
    // been saved during this session. Always take the draft from the current
    // shared snapshot after configuration has completed so reopening the
    // sheet cannot restore stale selections.
    await configureCacheSettings();
    this.draft = { ...getCacheSettings() };
    try { this.usage = await invoke<CacheUsage>("get_cache_disk_usage"); }
    catch { this.usage = null; }
  }

  private close = () => { if (!this.saving) this.visible = false; };
  private setNumber(key: keyof CacheSettings, event: Event) {
    this.draft = { ...this.draft, [key]: Number((event.target as HTMLSelectElement).value) };
  }
  private setBoolean(key: keyof CacheSettings, event: Event) {
    this.draft = { ...this.draft, [key]: (event.target as HTMLInputElement).checked };
  }
  private async save() {
    this.saving = true; this.error = "";
    try { await saveCacheSettings(this.draft); this.visible = false; }
    catch (error) { this.error = String(error); }
    finally { this.saving = false; }
  }
  private options(values: number[], unit: string) {
    return values.map((value) => html`<option value=${value}>${value === 0 ? "Off" : `${value.toLocaleString()} ${unit}`}</option>`);
  }
  private formatBytes(bytes: number) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  render() {
    if (!this.visible) return nothing;
    const s = this.draft;
    return html`<div class="backdrop" @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) this.close(); }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cache-title">
        <header><h2 id="cache-title">Performance & Caches</h2><button @click=${this.close} aria-label="Close">Close</button></header>
        <main>
          <p class="note">These choices and all generated cache files stay on this device. They are never stored in or exported with a .warble library. Caches are off by default to protect memory and battery on iPad.</p>
          <section><h3>Background work</h3>
            ${this.toggle("background_thumbnails_enabled", "Generate off-screen thumbnails", "Processes the whole folder instead of only visible photos.", s.background_thumbnails_enabled)}
            ${this.toggle("background_hd_previews_enabled", "Pre-generate HD previews", "Builds a 1920px preview for every photo in the folder.", s.background_hd_previews_enabled)}
            ${this.toggle("full_resolution_enabled", "Load full resolution after a pause", "Best quality, but a single large photo can require 100 MB or more.", s.full_resolution_enabled)}
            <div class="row"><label>Parallel background jobs<small>Keep this at 1 on iPad.</small></label><select .value=${String(s.background_pool_workers)} @change=${(e: Event) => this.setNumber("background_pool_workers", e)}>${this.options([1,2,4,8].filter(n => n <= (this.usage?.bg_thread_capacity ?? 8)), "jobs")}</select></div>
          </section>
          <section><h3>Device cache limits</h3>
            ${this.select("thumbnail_disk_max_entries", "Thumbnail disk cache", "Generated JPEG files", [0,1000,5000,10000,25000], "files")}
            ${this.select("hd_image_disk_max_entries", "HD preview disk cache", "Generated 1920px JPEG files", [0,500,1000,2000,5000], "files")}
            ${this.select("full_image_memory_max_entries", "Full-image byte cache", "Encoded originals retained in app memory", [0,2,4,8,16], "images")}
            ${this.select("full_image_bitmap_max_entries", "Decoded bitmap cache", "Includes the active image; each large bitmap can be 100 MB+", [1,2,4,8], "images")}
          </section>
          ${this.usage ? html`<div class="usage">Currently on this device: ${this.usage.thumbnail.files} thumbnails (${this.formatBytes(this.usage.thumbnail.bytes)}) and ${this.usage.hd_image.files} HD previews (${this.formatBytes(this.usage.hd_image.bytes)}).<br>${this.usage.thumbnail.path ?? "Cache directory unavailable"}</div>` : nothing}
          ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        </main>
        <footer><button @click=${this.close}>Cancel</button><button class="primary" ?disabled=${this.saving} @click=${this.save}>${this.saving ? "Saving…" : "Save on this device"}</button></footer>
      </div></div>`;
  }
  private toggle(key: keyof CacheSettings, title: string, detail: string, checked: boolean) {
    return html`<div class="row"><label>${title}<small>${detail}</small></label><input type="checkbox" .checked=${checked} @change=${(e: Event) => this.setBoolean(key, e)} /></div>`;
  }
  private select(key: keyof CacheSettings, title: string, detail: string, values: number[], unit: string) {
    return html`<div class="row"><label>${title}<small>${detail}</small></label><select .value=${String(this.draft[key])} @change=${(e: Event) => this.setNumber(key, e)}>${this.options(values, unit)}</select></div>`;
  }
}

declare global { interface HTMLElementTagNameMap { "pf-cache-settings": PfCacheSettings; } }

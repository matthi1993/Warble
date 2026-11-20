import type { PresetStore } from "@warble/editing";
import type { WorkspaceBackend } from "@warble/library";
import type { Dialogs, FileFilter, TextFiles } from "@app/platform/desktop";
import type { SettingsBackend } from "@app/platform/settings-backend";
import type { CacheSettings, CacheSettingsStore, CacheUsage, CacheUsageEntry } from "@app/state/cache-settings-store";

const PRESET_FILE_FILTERS: FileFilter[] = [{ name: "JSON", extensions: ["json"] }];
const RESET_WARNING =
  "Remove all imported folders, ratings, edits, cached metadata, and other SQLite library data? Your photos and sidecar files will NOT be deleted. Sidecar metadata may be restored if you add the same folders again.";

export interface SettingsHost {
  requestUpdate(): void;
  announceWorkspaceReset(): void;
  reloadApp(): void;
}

export interface SettingsServices {
  cacheSettings: Pick<CacheSettingsStore, "value" | "load" | "save" | "diskUsage">;
  settings: Pick<SettingsBackend, "getCacheSettings">;
  workspace: Pick<WorkspaceBackend, "resetWorkspace">;
  dialogs: Pick<Dialogs, "confirm" | "pickFile" | "pickSaveLocation">;
  textFiles: TextFiles;
  presets: Pick<PresetStore, "load" | "exportJson" | "importJson">;
}

export class SettingsController {
  visible = false;
  draft: CacheSettings;
  usage: CacheUsage | null = null;
  saving = false;
  loaded = false;
  error = "";
  presetFeedback = "";

  constructor(
    private readonly host: SettingsHost,
    private readonly services: SettingsServices,
  ) {
    this.draft = { ...services.cacheSettings.value };
  }

  show(): void {
    this.change({ error: "", presetFeedback: "", loaded: false, usage: null, visible: true });
  }

  async load(): Promise<void> {
    try {
      await this.services.cacheSettings.load();
      this.change({ draft: { ...(await this.services.settings.getCacheSettings()) }, loaded: true });
    } catch (error) {
      this.change({ error: `Could not load cache settings: ${String(error)}` });
      return;
    }
    try {
      this.change({ usage: await this.services.cacheSettings.diskUsage() });
    } catch {
      this.change({ usage: null });
    }
  }

  /** Returns whether the sheet closed; it stays open while a save or reset is running. */
  close(): boolean {
    if (this.saving) return false;
    this.change({ visible: false });
    return true;
  }

  setNumber(key: keyof CacheSettings, value: string): void {
    this.change({ draft: { ...this.draft, [key]: Number(value) } });
  }

  setBoolean(key: keyof CacheSettings, checked: boolean): void {
    this.change({ draft: { ...this.draft, [key]: checked } });
  }

  async save(): Promise<boolean> {
    this.change({ saving: true, error: "" });
    try {
      await this.services.cacheSettings.save(this.draft);
      this.saving = false;
      return this.close();
    } catch (error) {
      this.change({ error: String(error) });
      return false;
    } finally {
      this.change({ saving: false });
    }
  }

  async resetWorkspace(): Promise<void> {
    if (this.saving) return;
    const accepted = await this.services.dialogs.confirm(RESET_WARNING, {
      title: "Reset workspace",
      kind: "warning",
      okLabel: "Reset workspace",
      cancelLabel: "Cancel",
    });
    if (!accepted) return;
    this.change({ saving: true, error: "" });
    try {
      this.host.announceWorkspaceReset();
      await this.services.workspace.resetWorkspace();
      this.host.reloadApp();
    } catch (error) {
      this.change({ error: `Workspace reset failed: ${String(error)}`, saving: false });
    }
  }

  async exportPresets(): Promise<void> {
    const { presets, dialogs, textFiles } = this.services;
    this.change({ presetFeedback: "" });
    try {
      await presets.load();
      const path = await dialogs.pickSaveLocation("warble-presets.json", PRESET_FILE_FILTERS);
      if (!path) return;
      await textFiles.write(path, presets.exportJson());
      this.change({ presetFeedback: "Presets exported." });
    } catch (error) {
      this.change({ presetFeedback: `Export failed: ${String(error)}` });
    }
  }

  async importPresets(): Promise<void> {
    const { presets, dialogs, textFiles } = this.services;
    this.change({ presetFeedback: "" });
    try {
      await presets.load();
      const path = await dialogs.pickFile(PRESET_FILE_FILTERS);
      if (!path) return;
      const count = presets.importJson(await textFiles.read(path));
      this.change({
        presetFeedback:
          count === 0 ? "No presets were found in that file." : `${count} preset${count === 1 ? "" : "s"} imported.`,
      });
    } catch (error) {
      this.change({ presetFeedback: `Import failed: ${String(error)}` });
    }
  }

  usageSummary(entry: CacheUsageEntry): string {
    return `${this.formatBytes(entry.bytes)} · ${entry.files.toLocaleString()} files`;
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  private change(patch: Partial<Pick<SettingsController, SettingsField>>): void {
    Object.assign(this, patch);
    this.host.requestUpdate();
  }
}

type SettingsField = "visible" | "draft" | "usage" | "saving" | "loaded" | "error" | "presetFeedback";

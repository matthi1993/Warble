import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@warble/core";
import { SAFE_CACHE_DEFAULTS, type CacheSettings } from "@app/state/cache-settings-store";
import { SettingsController } from "@app/views/settings/settings-controller";
import { TaskDetailsModel } from "@app/views/settings/task-details-model";

function settingsFixture(options: { saveFails?: boolean; confirmReset?: boolean; resetFails?: boolean; pickedFile?: string | null } = {}) {
  const events: string[] = [];
  const stored: CacheSettings = { ...SAFE_CACHE_DEFAULTS, parallel_workers: 4 };
  const files = new Map<string, string>([["/in.json", "two presets"]]);
  const host = {
    updates: 0,
    requestUpdate() { this.updates++; },
    announceWorkspaceReset: () => void events.push("announce"),
    reloadApp: () => void events.push("reload"),
  };
  const controller = new SettingsController(host, {
    cacheSettings: {
      value: SAFE_CACHE_DEFAULTS,
      load: async () => stored,
      save: async (settings) => {
        if (options.saveFails) throw new Error("disk full");
        events.push(`save workers=${settings.parallel_workers}`);
        return settings;
      },
      diskUsage: async () => ({ thumbnail: { path: null, bytes: 3 * 1024 ** 2, files: 1200 }, hd_image: { path: null, bytes: 2 * 1024 ** 3, files: 7 } }),
    },
    settings: { getCacheSettings: async () => stored },
    workspace: {
      resetWorkspace: async () => {
        if (options.resetFails) throw new Error("locked");
        events.push("reset");
      },
    },
    dialogs: {
      confirm: async () => options.confirmReset ?? false,
      pickFile: async () => options.pickedFile ?? null,
      pickSaveLocation: async () => "/out.json",
    },
    textFiles: {
      read: async (path) => files.get(path) ?? "",
      write: async (path, contents) => void files.set(path, contents),
    },
    presets: {
      load: async () => {},
      exportJson: () => "exported presets",
      importJson: (raw) => (raw === "two presets" ? 2 : 0),
    },
  });
  return { controller, events, files, host };
}

describe("SettingsController", () => {
  it("shows the sheet at once and enables editing after the stored settings and disk usage arrived", async () => {
    const { controller } = settingsFixture();
    controller.show();
    expect(controller).toMatchObject({ visible: true, loaded: false, usage: null });
    await controller.load();
    expect(controller.loaded).toBe(true);
    expect(controller.draft.parallel_workers).toBe(4);
    expect(controller.usageSummary(controller.usage!.thumbnail)).toBe(`3.0 MB · ${(1200).toLocaleString()} files`);
    expect(controller.usageSummary(controller.usage!.hd_image)).toBe("2.0 GB · 7 files");
  });

  it("saves the edited draft and closes", async () => {
    const { controller, events } = settingsFixture();
    controller.show();
    await controller.load();
    controller.setNumber("parallel_workers", "8");
    controller.setBoolean("full_resolution_enabled", true);
    expect(await controller.save()).toBe(true);
    expect(events).toEqual(["save workers=8"]);
    expect(controller).toMatchObject({ visible: false, saving: false });
  });

  it("stays open and shows the error when saving fails", async () => {
    const { controller } = settingsFixture({ saveFails: true });
    controller.show();
    expect(await controller.save()).toBe(false);
    expect(controller).toMatchObject({ visible: true, saving: false, error: "Error: disk full" });
  });

  it("resets the workspace only after confirmation, announcing it before the backend call", async () => {
    const declined = settingsFixture();
    await declined.controller.resetWorkspace();
    expect(declined.events).toEqual([]);

    const accepted = settingsFixture({ confirmReset: true });
    await accepted.controller.resetWorkspace();
    expect(accepted.events).toEqual(["announce", "reset", "reload"]);
    expect(accepted.controller.close()).toBe(false);

    const failed = settingsFixture({ confirmReset: true, resetFails: true });
    await failed.controller.resetWorkspace();
    expect(failed.events).toEqual(["announce"]);
    expect(failed.controller).toMatchObject({ saving: false, error: "Workspace reset failed: Error: locked" });
  });

  it("exports and imports presets through the chosen files", async () => {
    const { controller, files } = settingsFixture({ pickedFile: "/in.json" });
    await controller.exportPresets();
    expect(files.get("/out.json")).toBe("exported presets");
    expect(controller.presetFeedback).toBe("Presets exported.");
    await controller.importPresets();
    expect(controller.presetFeedback).toBe("2 presets imported.");

    const cancelled = settingsFixture();
    await cancelled.controller.importPresets();
    expect(cancelled.controller.presetFeedback).toBe("");
  });
});

describe("TaskDetailsModel", () => {
  const task = (overrides: Partial<TaskRecord>): TaskRecord =>
    ({ id: 1, kind: "folder", label: "Scan", priority: "background", status: "running", startedAt: 0, ...overrides });

  it("counts queued and running tasks and describes what a task works on", () => {
    const model = new TaskDetailsModel();
    const tasks = [task({}), task({ status: "queued" }), task({ status: "completed" })];
    expect(model.activeCount(tasks)).toBe(2);
    expect(model.targetLabel(task({ completed: 3, total: 10, target: "Photo library" }))).toBe("3 of 10 photos");
    expect(model.targetLabel(task({ target: "/Volumes/Photos/2024/" }))).toBe("2024");
    expect(model.targetLabel(task({ target: "C:\\Photos\\Trip" }))).toBe("Trip");
    expect(model.targetLabel(task({}))).toBe("");
  });
});

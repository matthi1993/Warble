import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Photo, PhotoVariantSave, VariantPref } from "@warble/library";
import { MenuController } from "@app/views/full-view/menu-controller";
import { VariantActionsController } from "@app/views/full-view/variant-actions-controller";
import { CountingHost, FakeStage, RecordingEvents, photo } from "./support/full-view-fakes";

interface Scenario {
  existingVariants?: string[];
  answers?: boolean[];
  saveFailure?: Error;
}

function createActions(photos: Photo[], scenario: Scenario = {}) {
  const stage = new FakeStage(photos);
  const host = new CountingHost();
  const events = new RecordingEvents();
  const log: string[] = [];
  const questions: string[] = [];
  const messages: string[] = [];
  const saves: PhotoVariantSave[] = [];
  const answers = [...(scenario.answers ?? [])];
  const preferences = {
    set: (path: string, pref: VariantPref) => {
      stage.preferences.set(path, pref);
      log.push(`select ${path} ${pref.variant}`);
    },
    reload: async () => void log.push("reload variants"),
  };
  const actions = new VariantActionsController(
    {
      requestUpdate: () => host.requestUpdate(),
      rendered: () => host.updateComplete,
      events,
      canvas: () => ({
        exportJpeg: async () => {
          log.push("export");
          return new Uint8Array([1, 2, 3]);
        },
      }),
    },
    stage.model,
    new MenuController(host),
    {
      library: {
        photoVariantExists: async (_path, variant) => (scenario.existingVariants ?? []).includes(variant),
        savePhotoVariant: async (save) => {
          if (scenario.saveFailure) throw scenario.saveFailure;
          saves.push(save);
          log.push(`save ${save.variant}`);
        },
        trashPhotoVariant: async (path) => void log.push(`trash ${path}`),
        trashPhotoGroup: async (path) => {
          log.push(`trash group ${path}`);
          return 1;
        },
      },
      dialogs: {
        ask: async (text) => {
          questions.push(text);
          return answers.shift() ?? false;
        },
        message: async (text) => void messages.push(text),
      },
      preferences,
      photoEdits: {
        flush: async (path) => void log.push(`flush ${path}`),
        flushAll: async () => void log.push("flush all"),
        reload: async () => void log.push("reload edits"),
        hasEdits: (path) => path.includes("Edit"),
      },
      resolver: stage.resolver,
    },
  );
  return { actions, stage, events, log, questions, messages, saves };
}

describe("VariantActionsController", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("saves the first variant as Edit, after flushing pending edits, and shows it", async () => {
    const { actions, stage, events, log, questions, saves } = createActions([photo("a")]);
    await actions.save();
    expect(questions).toEqual([]);
    expect(saves).toEqual([
      { photoPath: "a.jpg", variant: "Edit", overwrite: false, jpegBytes: new Uint8Array([1, 2, 3]) },
    ]);
    expect(log).toEqual(["flush a.jpg", "export", "save Edit", "select a.jpg Edit"]);
    expect(stage.preferences.get("a.jpg")).toEqual({ format: "jpg", variant: "Edit" });
    expect(events.catalogChanges).toEqual([{ kind: "save", photoPath: "a.jpg", previousIndex: 0 }]);
    expect(actions.savingVariant).toBe(false);
  });

  it("offers to overwrite each taken name and otherwise moves on to the next free number", async () => {
    const declined = createActions([photo("a")], { existingVariants: ["Edit", "Edit 2"], answers: [false, false] });
    await declined.actions.save();
    expect(declined.questions).toEqual([
      "Edit.jpg already exists. Overwrite it? Choose No to save as Edit 2.",
      "Edit 2.jpg already exists. Overwrite it? Choose No to save as Edit 3.",
    ]);
    expect(declined.saves.map((save) => [save.variant, save.overwrite])).toEqual([["Edit 3", false]]);

    const confirmed = createActions([photo("a")], { existingVariants: ["Edit", "Edit 2"], answers: [false, true] });
    await confirmed.actions.save();
    expect(confirmed.saves.map((save) => [save.variant, save.overwrite])).toEqual([["Edit 2", true]]);
  });

  it("saves from the displayed variant and files the result under the photo", async () => {
    const { actions, stage, events, saves } = createActions([photo("a", ["Edit"])], {
      existingVariants: ["Edit"],
      answers: [false],
    });
    stage.preferences.set("a.jpg", { format: "jpg", variant: "Edit" });
    await actions.save();
    expect(saves[0].photoPath).toBe("a (Edit).jpg");
    expect(stage.preferences.get("a.jpg")).toEqual({ format: "jpg", variant: "Edit 2" });
    expect(events.catalogChanges[0].photoPath).toBe("a.jpg");
  });

  it("reports a failed save, keeps the selection and becomes available again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { actions, stage, events, messages } = createActions([photo("a")], { saveFailure: new Error("disk full") });
    await actions.save();
    expect(messages).toEqual(["Failed to save variant: Error: disk full"]);
    expect(stage.preferences.size).toBe(0);
    expect(events.catalogChanges).toEqual([]);
    expect(actions.busy).toBe(false);
  });

  it("deleting a variant falls back to the newest remaining edit", async () => {
    const { actions, stage, events, log, questions } = createActions([photo("a", ["Edit", "Edit 2", "Edit 3"])], {
      answers: [true],
    });
    stage.preferences.set("a.jpg", { format: "jpg", variant: "Edit 3" });
    await actions.deleteVariant();
    expect(questions).toEqual(["Move the current image (JPG, Edit 3) to the Bin?"]);
    expect(log).toEqual([
      "flush all",
      "trash a (Edit 3).jpg",
      "reload edits",
      "reload variants",
      "select a.jpg Edit 2",
    ]);
    expect(events.catalogChanges).toEqual([{ kind: "variant-delete", photoPath: "a.jpg", previousIndex: 0 }]);
  });

  it("deleting the base file keeps the selection, the only file counts as the photo, and declining deletes nothing", async () => {
    const base = createActions([photo("a", ["Edit"])], { answers: [true] });
    await base.actions.deleteVariant();
    expect(base.log).toEqual(["flush all", "trash a.jpg", "reload edits", "reload variants"]);
    expect(base.events.catalogChanges.map((change) => change.kind)).toEqual(["variant-delete"]);

    const only = createActions([photo("a")], { answers: [true] });
    await only.actions.deleteVariant();
    expect(only.events.catalogChanges.map((change) => change.kind)).toEqual(["photo-delete"]);

    const declined = createActions([photo("a", ["Edit"])], { answers: [false, false] });
    await declined.actions.deleteVariant();
    await declined.actions.deletePhoto();
    expect(declined.log).toEqual([]);
    expect(declined.events.catalogChanges).toEqual([]);
  });

  it("deletes the whole photo group after confirmation", async () => {
    const { actions, events, log, questions } = createActions([photo("x", ["Edit"]), photo("a")], { answers: [true] });
    await actions.deletePhoto();
    expect(questions).toEqual(["Move x.jpg and all its variants to the Bin?"]);
    expect(log).toEqual(["flush all", "trash group x.jpg", "reload edits", "reload variants"]);
    expect(events.catalogChanges).toEqual([{ kind: "photo-delete", photoPath: "x.jpg", previousIndex: 0 }]);
  });

  it("marks the variants that carry edits and switches the displayed variant", () => {
    const { actions, stage } = createActions([photo("a", ["Edit"])]);
    const [shown] = stage.sequence.photos;
    expect(actions.hasEdits(shown, "jpg", "Edit")).toBe(true);
    expect(actions.hasEdits(shown, "jpg", "base")).toBe(false);
    expect(actions.hasEdits(shown, "jpg", "missing")).toBe(false);
    actions.select("Edit");
    expect(stage.model.editTarget).toBe("a (Edit).jpg");
  });
});

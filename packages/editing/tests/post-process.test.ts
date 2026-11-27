import { defaultAnalog, defaultClarity, defaultGrain, defaultSharpen } from "@warble/render";
import { describe, expect, it, vi } from "vitest";
import { EffectCatalog, PostProcessStore, PresetStore, type PostProcessPreset, type PostProcessSettings } from "../src";
import { FakeEditRepository, MemoryStorage, settle } from "./support/fakes";

const catalog = EffectCatalog.standard();
const POST_KEY = "warble.postProcess.v4";

describe("PostProcessStore and PresetStore", () => {
  it("clarity and Analog persist in Post settings and presets while older presets stay neutral", async () => {
    const storage = new MemoryStorage({ [POST_KEY]: { enabled: false } });
    const post = new PostProcessStore(storage, catalog);
    expect(post.enabled).toBe(false);
    expect(post.effect("clarity")).toEqual(defaultClarity());
    expect(post.effect("analog")).toEqual(defaultAnalog());

    post.setEffect("clarity", { ...defaultClarity(), clarity: 35, structure: 20 });
    post.setEffect("analog", { ...defaultAnalog(), vignette: 65, halation: 25 });
    expect(storage.read<PostProcessSettings>(POST_KEY).clarity.clarity).toBe(35);
    expect(storage.read<PostProcessSettings>(POST_KEY).analog.vignette).toBe(65);

    const repository = new FakeEditRepository();
    const presets = new PresetStore(repository, catalog, storage);
    await presets.load();
    const saved = presets.save("Texture", post.settings)!;
    post.resetEffect("clarity");
    post.resetEffect("analog");
    expect(saved.values.clarity.clarity).toBe(35);
    expect(post.effect("clarity")).toEqual(defaultClarity());
    const exported = JSON.parse(presets.exportJson()) as { postProcess: PostProcessPreset[] };
    expect(exported.postProcess[0].values.clarity.structure).toBe(20);
    expect(exported.postProcess[0].values.analog.halation).toBe(25);

    post.replace(presets.settingsFrom(saved, post.settings));
    expect(post.enabled).toBe(true);
    expect(post.effect("clarity").structure).toBe(20);
    expect(post.effect("analog").vignette).toBe(65);
    expect(presets.matches(saved, post.settings)).toBe(true);

    expect(presets.importJson(JSON.stringify([{ name: "Legacy", values: { tone: {} } }]))).toBe(1);
    const legacy = presets.presets[presets.presets.length - 1];
    expect(legacy.values.clarity).toEqual(defaultClarity());
    expect(legacy.values.analog).toEqual(defaultAnalog());
    expect(presets.matches(legacy, post.settings)).toBe(false);
  });

  it("shows a preview without saving it and edits the saved state underneath", () => {
    const storage = new MemoryStorage();
    const post = new PostProcessStore(storage, catalog);
    post.setEffect("grain", { ...defaultGrain(), amount: 10 });
    const seen: number[] = [];
    post.subscribe((settings) => seen.push(settings.grain.amount));

    post.preview({ ...post.settings, grain: { ...defaultGrain(), amount: 80 } });
    expect(post.effect("grain").amount).toBe(80);
    expect(post.committed.grain.amount).toBe(10);
    expect(storage.read<PostProcessSettings>(POST_KEY).grain.amount).toBe(10);

    post.clearPreview();
    expect(post.effect("grain").amount).toBe(10);

    post.preview({ ...post.settings, grain: { ...defaultGrain(), amount: 80 } });
    post.setEffect("sharpen", { ...defaultSharpen(), strength: 40 });
    expect(post.effect("grain").amount).toBe(10);
    expect(post.effect("sharpen").strength).toBe(40);
    expect(post.committed).toBe(post.settings);
    expect(seen).toEqual([80, 10, 80, 10]);
  });

  it("keeps the settings when the master switch is flipped and resets one effect or all", () => {
    const post = new PostProcessStore(null, catalog);
    post.setEffect("grain", { ...defaultGrain(), amount: 10 });
    post.setEffect("sharpen", { ...defaultSharpen(), strength: 40 });
    post.setEnabled(false);
    expect(post.enabled).toBe(false);
    expect(post.effect("grain").amount).toBe(10);

    post.resetEffect("grain");
    expect(post.effect("grain")).toEqual(defaultGrain());
    expect(post.effect("sharpen").strength).toBe(40);

    post.reset();
    expect(post.settings).toEqual(post.defaults());
    expect(post.enabled).toBe(true);
  });

  it("replaces a preset saved under the same name and never overwrites on import", async () => {
    const repository = new FakeEditRepository();
    const post = new PostProcessStore(null, catalog);
    const presets = new PresetStore(repository, catalog);
    await presets.load();
    const first = presets.save(" Film ", post.settings)!;
    post.setEffect("grain", { ...defaultGrain(), amount: 30 });
    const replaced = presets.save("film", post.settings)!;
    expect(replaced.id).toBe(first.id);
    expect(presets.presets).toHaveLength(1);
    expect(presets.save("  ", post.settings)).toBeNull();

    expect(presets.importJson(presets.exportJson())).toBe(1);
    expect(presets.presets.map((preset) => preset.name)).toEqual(["film", "film (2)"]);
    expect(() => presets.importJson("not json")).toThrow("The selected file is not valid JSON.");
    expect(() => presets.importJson("{}")).toThrow("The selected file contains no post-process presets.");

    presets.remove(first.id);
    await settle();
    const stored = JSON.parse(repository.presetsJson!).presets as PostProcessPreset[];
    expect(stored.map((preset) => preset.name)).toEqual(["film (2)"]);
    expect(stored[0].values.grain.amount).toBe(30);
  });

  it("persists empty groups and preset order without changing saved effect values", async () => {
    const repository = new FakeEditRepository();
    const post = new PostProcessStore(null, catalog);
    const presets = new PresetStore(repository, catalog);
    await presets.load();
    presets.createGroup(" Film ");
    presets.createGroup("Empty");
    post.setEffect("grain", { ...defaultGrain(), amount: 30 });
    const first = presets.save("First", post.settings)!;
    post.resetEffect("grain");
    const second = presets.save("Second", post.settings)!;

    presets.move(first.id, "Film", null);
    presets.move(second.id, "Film", first.id);
    await settle();

    const reloaded = new PresetStore(repository, catalog);
    await reloaded.load();
    expect(reloaded.groups).toEqual(["Film", "Empty"]);
    expect(reloaded.presets).toEqual([
      { ...second, group: "Film" },
      { ...first, group: "Film" },
    ]);

    reloaded.move(second.id, "Film", null);
    expect(reloaded.presets.map(({ id }) => id)).toEqual([first.id, second.id]);
    reloaded.move(first.id, "", null);
    expect(reloaded.presets.find(({ id }) => id === first.id)?.group).toBe("");
  });

  it("renames a preset in place and rejects duplicate names", async () => {
    const repository = new FakeEditRepository();
    const post = new PostProcessStore(null, catalog);
    const presets = new PresetStore(repository, catalog);
    await presets.load();
    const first = presets.save("First", post.settings, "Film")!;
    const second = presets.save("Second", post.settings, "Film")!;

    expect(presets.rename(first.id, " second ")).toBe(false);
    expect(presets.rename(first.id, "  ")).toBe(false);
    expect(presets.rename(first.id, " Renamed ")).toBe(true);
    await settle();

    const reloaded = new PresetStore(repository, catalog);
    await reloaded.load();
    expect(reloaded.presets).toEqual([{ ...first, name: "Renamed" }, second]);
  });

  it("renames groups and keeps their presets when the group is deleted", async () => {
    const repository = new FakeEditRepository();
    const post = new PostProcessStore(null, catalog);
    const presets = new PresetStore(repository, catalog);
    await presets.load();
    presets.createGroup("Empty");
    const first = presets.save("First", post.settings, "Film")!;
    const second = presets.save("Second", post.settings, "Film")!;

    expect(presets.renameGroup("Film", "empty")).toBe(false);
    expect(presets.renameGroup("Film", " Cinema ")).toBe(true);
    expect(presets.groups).toEqual(["Empty", "Cinema"]);
    expect(presets.presets).toEqual([{ ...first, group: "Cinema" }, { ...second, group: "Cinema" }]);

    presets.deleteGroup("Cinema");
    await settle();
    const reloaded = new PresetStore(repository, catalog);
    await reloaded.load();
    expect(reloaded.groups).toEqual(["Empty"]);
    expect(reloaded.presets).toEqual([{ ...first, group: "" }, { ...second, group: "" }]);
  });

  it("persists group nesting and sibling order and prevents cycles", async () => {
    const repository = new FakeEditRepository();
    const presets = new PresetStore(repository, catalog);
    await presets.load();
    for (const group of ["Film", "Clean", "Color", "Grain"]) presets.createGroup(group);
    presets.moveGroup("Clean", "", "Film");
    presets.moveGroup("Color", "Film", null);
    presets.moveGroup("Grain", "Film", "Color");
    presets.moveGroup("Film", "Grain", null);

    await vi.waitFor(() => {
      const stored = JSON.parse(repository.presetsJson!);
      expect(stored.parents).toEqual({ Color: "Film", Grain: "Film" });
      expect(stored.groups).toEqual(["Clean", "Film", "Grain", "Color"]);
    });
    const reloaded = new PresetStore(repository, catalog);
    await reloaded.load();
    const groupsIn = (parent: string) => reloaded.groups.filter((group) => reloaded.parentGroup(group) === parent);
    expect(groupsIn("")).toEqual(["Clean", "Film"]);
    expect(groupsIn("Film")).toEqual(["Grain", "Color"]);
    reloaded.renameGroup("Film", "Cinema");
    expect(groupsIn("Cinema")).toEqual(["Grain", "Color"]);
    reloaded.moveGroup("Color", "", "Cinema");
    expect(groupsIn("")).toEqual(["Clean", "Color", "Cinema"]);
    reloaded.deleteGroup("Cinema");
    expect(groupsIn("")).toEqual(["Clean", "Color", "Grain"]);
  });

  it("moves presets from the old browser storage into the library once", async () => {
    const legacyKey = "warble.postProcessPresets.v1";
    const storage = new MemoryStorage({ [legacyKey]: [{ id: "a", name: "Old", values: {} }] });
    const repository = new FakeEditRepository();
    const presets = new PresetStore(repository, catalog, storage);
    await presets.load();
    expect(presets.presets.map((preset) => preset.name)).toEqual(["Old"]);
    expect(JSON.parse(repository.presetsJson!).presets).toHaveLength(1);
    expect(storage.getItem(legacyKey)).toBeNull();
  });
});

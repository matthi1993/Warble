import { EMPTY_RECIPE, EffectRegistry, defaultClarity, defaultGrain, defaultTone } from "@warble/render";
import { describe, expect, it } from "vitest";
import { EffectToggleStore, RecipeBuilder, type CropEdit, type EffectEnabledChange } from "../src";
import { MemoryStorage, createEditing } from "./support/fakes";

const crop: CropEdit = { x: 0.1, y: 0.2, width: 0.5, height: 0.5, aspectRatio: "3:2", orientation: "landscape", rotation: 0 };
const photoTone = { ...defaultTone(), exposure: 10, shadows: 20 };
const photoClarity = { ...defaultClarity(), clarity: 40 };
const postTone = { ...defaultTone(), contrast: 15, whites: 5 };
const postGrain = { ...defaultGrain(), amount: 30 };

function editedPhoto() {
  const editing = createEditing();
  const { photoEdits, post } = editing.context;
  photoEdits.setEffect("photo", "tone", photoTone);
  photoEdits.setEffect("photo", "clarity", photoClarity);
  photoEdits.setCrop("photo", crop);
  post.setEffect("tone", postTone);
  post.setEffect("grain", postGrain);
  return { ...editing, recipes: new RecipeBuilder(editing.context) };
}

describe("RecipeBuilder", () => {
  it("puts the photo's stored effects in the photo layer and the global look in the Post layer", () => {
    const { recipes, context } = editedPhoto();
    const recipe = recipes.build("photo");
    expect(recipe.photo).toEqual({ tone: photoTone, clarity: photoClarity });
    expect(recipe.post.tone).toEqual(postTone);
    expect(recipe.post.grain).toBe(context.post.effect("grain"));
    expect(Object.keys(recipe.post)).toEqual(context.effects.ids);
    expect(recipes.build("other").photo).toEqual({});
    expect(recipes.build(null).photo).toEqual({});
    expect(EffectRegistry.standard().isNeutral(recipe)).toBe(false);
  });

  it("leaves a switched-off effect out of its own layer only", () => {
    const { recipes, context } = editedPhoto();
    context.toggles.setEnabled("photo", "photo", "clarity", false);
    context.toggles.setEnabled("post", null, "grain", false);
    const recipe = recipes.build("photo");
    expect(recipe.photo).toEqual({ tone: photoTone });
    expect(recipe.post.grain).toBeUndefined();
    expect(recipe.post.tone).toEqual(postTone);

    context.photoEdits.setEffect("other", "clarity", photoClarity);
    expect(recipes.build("other").photo.clarity).toEqual(photoClarity);
  });

  it("switches base tone and dynamic range separately in both layers", () => {
    const { recipes, context } = editedPhoto();
    context.toggles.setEnabled("photo", "photo", "base-tone", false);
    context.toggles.setEnabled("post", null, "dynamic-range", false);
    const recipe = recipes.build("photo");
    expect(recipe.photo.tone).toEqual({ ...defaultTone(), shadows: 20 });
    expect(recipe.post.tone).toEqual({ ...defaultTone(), contrast: 15 });
    expect(context.photoEdits.effect("photo", "tone")).toEqual(photoTone);
  });

  it("empties the photo layer and the crop when all photo edits are switched off", () => {
    const { recipes, context } = editedPhoto();
    expect(recipes.crop("photo")).toEqual(crop);
    context.toggles.setEnabled("photo", "photo", "all", false);
    const recipe = recipes.build("photo");
    expect(recipe.photo).toEqual({});
    expect(recipe.post.grain).toEqual(postGrain);
    expect(recipes.cropEnabled("photo")).toBe(false);
    expect(recipes.crop("photo")).toBeNull();

    context.toggles.setEnabled("photo", "photo", "all", true);
    context.toggles.setEnabled("photo", "photo", "crop", false);
    expect(recipes.build("photo").photo.tone).toEqual(photoTone);
    expect(recipes.crop("photo")).toBeNull();
  });

  it("skips the Post layer while the Post master switch is off", () => {
    const { recipes, context } = editedPhoto();
    context.post.setEnabled(false);
    const recipe = recipes.build("photo");
    expect(recipe.post).toEqual({});
    expect(recipe.photo.tone).toEqual(photoTone);
    expect(recipes.hasVisibleEdits("other")).toBe(false);
    context.post.setEnabled(true);
    expect(recipes.hasVisibleEdits("other")).toBe(true);
    expect(recipes.hasVisibleEdits("photo")).toBe(true);
  });

  it("applies nothing when comparing with the original and only the photo layer when saving a variant", () => {
    const { recipes } = editedPhoto();
    expect(recipes.build("photo", { original: true })).toEqual(EMPTY_RECIPE);
    expect(recipes.crop("photo", { original: true })).toBeNull();
    const variant = recipes.build("photo", { includePost: false });
    expect(variant.photo.tone).toEqual(photoTone);
    expect(variant.post).toEqual({});
  });
});

describe("EffectToggleStore", () => {
  it("remembers switched-off effects per photo and globally for Post", () => {
    const storage = new MemoryStorage();
    const toggles = new EffectToggleStore(storage);
    const changes: EffectEnabledChange[] = [];
    toggles.subscribe((change) => changes.push(change));

    toggles.setEnabled("photo", "a.jpg", "grain", false);
    toggles.toggle("post", null, "tone");
    toggles.setEnabled("photo", null, "grain", false);
    expect(toggles.isEnabled("photo", "a.jpg", "grain")).toBe(false);
    expect(toggles.isEnabled("photo", "b.jpg", "grain")).toBe(true);
    expect(toggles.isEnabled("photo", null, "grain")).toBe(true);
    expect(toggles.isEnabled("post", "a.jpg", "tone")).toBe(false);
    expect(changes).toEqual([
      { scope: "photo", path: "a.jpg", id: "grain" },
      { scope: "post", path: null, id: "tone" },
    ]);
    expect(storage.read("warble.disabledEffects.v1")).toEqual({ post: ["tone"], photo: { "a.jpg": ["grain"] } });

    const restored = new EffectToggleStore(storage);
    expect(restored.isEnabled("photo", "a.jpg", "grain")).toBe(false);
    restored.toggle("photo", "a.jpg", "grain");
    expect(storage.read("warble.disabledEffects.v1")).toEqual({ post: ["tone"], photo: {} });
  });
});

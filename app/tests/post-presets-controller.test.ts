import { EditingContext } from "@warble/editing";
import { defaultGrain } from "@warble/render";
import { describe, expect, it } from "vitest";
import { PostPresetsController } from "../src/editor/post/post-presets-controller";
import type { DialogOptions } from "../src/platform/desktop";
import { InMemoryEditRepository } from "./support/in-memory-edit-repository";

function setup(confirmDelete = true) {
  const { post, presets } = EditingContext.create(new InMemoryEditRepository(), null);
  const view = { updates: 0 };
  const questions: Array<{ text: string; options: DialogOptions }> = [];
  const controller = new PostPresetsController(
    { requestUpdate: () => void view.updates++ },
    post,
    presets,
    {
      ask: async (text, options) => {
        questions.push({ text, options });
        return confirmDelete;
      },
    },
  );
  const setGrainAmount = (amount: number) => post.setEffect("grain", { ...defaultGrain(), amount });
  return { post, presets, view, questions, controller, setGrainAmount };
}

describe("PostPresetsController", () => {
  it("saves the committed settings under the entered name and clears the name", () => {
    const { presets, controller, setGrainAmount } = setup();
    setGrainAmount(40);

    controller.setName("   ");
    expect(controller.canSave).toBe(false);
    controller.save();
    expect(presets.presets).toEqual([]);

    controller.setName(" Grainy ");
    controller.save();
    expect(controller.presets.map((preset) => preset.name)).toEqual(["Grainy"]);
    expect(controller.presets[0].values.grain.amount).toBe(40);
    expect(controller.name).toBe("");
  });

  it("marks the preset that equals the committed settings, also while another one is previewed", () => {
    const { post, presets, controller, setGrainAmount } = setup();
    setGrainAmount(40);
    const grainy = presets.save("Grainy", post.committed)!;
    setGrainAmount(0);
    const clean = presets.save("Clean", post.committed)!;
    post.setEnabled(false);

    expect([controller.isActive(grainy), controller.isActive(clean)]).toEqual([false, true]);

    controller.preview(grainy);
    expect(post.settings.grain.amount).toBe(40);
    expect([controller.isActive(grainy), controller.isActive(clean)]).toEqual([false, true]);
    controller.stopPreview();
    expect(post.settings.grain.amount).toBe(0);

    controller.apply(grainy);
    expect(post.committed.grain.amount).toBe(40);
    expect(post.enabled).toBe(true);
    expect([controller.isActive(grainy), controller.isActive(clean)]).toEqual([true, false]);
  });

  it("deletes a preset only after the confirmation", async () => {
    const declined = setup(false);
    const kept = declined.presets.save("Grainy", declined.post.committed)!;
    await declined.controller.remove(kept);
    expect(declined.presets.presets).toHaveLength(1);
    expect(declined.questions).toEqual([
      { text: "Delete the preset “Grainy”?", options: { title: "Delete preset", kind: "warning" } },
    ]);

    const confirmed = setup(true);
    const removed = confirmed.presets.save("Grainy", confirmed.post.committed)!;
    confirmed.controller.preview(removed);
    await confirmed.controller.remove(removed);
    expect(confirmed.presets.presets).toEqual([]);
    expect(confirmed.post.settings).toEqual(confirmed.post.committed);
  });

  it("redraws on preset and Post changes while connected and ends a preview when disconnected", () => {
    const { post, presets, view, controller, setGrainAmount } = setup();
    const preset = presets.save("Grainy", { ...post.committed, grain: { ...defaultGrain(), amount: 40 } })!;

    controller.connect();
    view.updates = 0;
    setGrainAmount(10);
    presets.save("Other", post.committed);
    expect(view.updates).toBe(2);

    controller.preview(preset);
    controller.disconnect();
    expect(post.settings.grain.amount).toBe(10);
    view.updates = 0;
    setGrainAmount(20);
    expect(view.updates).toBe(0);
  });
});

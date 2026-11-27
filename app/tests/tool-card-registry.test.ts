import { EditingContext, EditTool, ToolRegistry, type ToolHost } from "@warble/editing";
import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { ToolCardRegistry } from "../src/editor/tool-card-registry";
import { toolCards } from "../src/editor/tool-cards";
import { InMemoryEditRepository } from "./support/in-memory-edit-repository";

class RedEyeTool extends EditTool {
  readonly id = "red-eye";

  hasEdits(): boolean {
    return false;
  }

  reset(): void {}
}

function editing(): EditingContext {
  return EditingContext.create(new InMemoryEditRepository(), null);
}

function toolHost(editTarget: string | null): ToolHost {
  return {
    editTarget,
    canvas: null,
    requestUpdate: () => {},
    revealEditPanel: () => {},
    flushActiveEdit: () => {},
    setActiveTool: () => {},
  };
}

function markup(card: TemplateResult): string {
  return card.strings.join("");
}

describe("ToolCardRegistry", () => {
  it("draws a tool with the renderer registered for its id", () => {
    const context = editing();
    const host = toolHost("photo.jpg");
    const redEye = new RedEyeTool("photo", context);
    const card = {} as TemplateResult;
    const drawn: Array<[EditTool, ToolHost]> = [];
    const cards = new ToolCardRegistry()
      .register("other", () => ({}) as TemplateResult)
      .register<RedEyeTool>("red-eye", (tool, drawnHost) => {
        drawn.push([tool, drawnHost]);
        return card;
      });

    expect(cards.render(redEye, host)).toBe(card);
    expect(drawn).toEqual([[redEye, host]]);
    expect(cards.has("red-eye")).toBe(true);
  });

  it("rejects a second card for a tool and a tool without a card", () => {
    const cards = new ToolCardRegistry().register("other", () => ({}) as TemplateResult);

    expect(() => cards.register("other", () => ({}) as TemplateResult)).toThrow(/already registered/);
    expect(cards.has("red-eye")).toBe(false);
    expect(() => cards.render(new RedEyeTool("photo", editing()), toolHost(null))).toThrow(/red-eye/);
  });
});

describe("toolCards", () => {
  it("draws every standard tool in the Edit and the Post panel", () => {
    const context = editing();
    const tools = ToolRegistry.standard();
    const drawnTags = (scope: "photo" | "post", editTarget: string | null) =>
      tools
        .createTools(scope, context)
        .map((tool) => markup(toolCards.render(tool, toolHost(editTarget))).match(/<pf-[a-z-]+/g));

    expect(drawnTags("photo", "photo.jpg")).toEqual([
      ["<pf-crop-card"],
      ["<pf-basic-card", "<pf-dynamic-range-card"],
      ["<pf-clarity-card"],
      ["<pf-color-card"],
      ["<pf-curve-card"],
      ["<pf-sharpen-card"],
      ["<pf-grain-card"],
      ["<pf-analog-card"],
    ]);
    expect(drawnTags("post", null)).toEqual([
      ["<pf-bloom-card"],
      ["<pf-basic-card", "<pf-dynamic-range-card"],
      ["<pf-clarity-card"],
      ["<pf-color-card"],
      ["<pf-curve-card"],
      ["<pf-sharpen-card"],
      ["<pf-grain-card"],
      ["<pf-analog-card"],
    ]);
  });
});

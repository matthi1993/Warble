import { defaultBloom, defaultClarity, defaultColor, defaultGrain, defaultTone, type ClaritySettings } from "@warble/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BloomTool,
  ClarityTool,
  ColorTool,
  CropTool,
  EditTool,
  GrainTool,
  ToneTool,
  ToolRegistry,
  type CropEdit,
  type ToolHost,
} from "../src";
import { createEditing, fakeHost } from "./support/fakes";

const frame = { x: 0.1, y: 0.2, width: 0.6, height: 0.4 };

class RedEyeTool extends EditTool {
  readonly id = "red-eye";

  hasEdits(): boolean {
    return false;
  }

  reset(host: ToolHost): void {
    host.requestUpdate();
  }
}

describe("effect tools", () => {
  it("clarity supports photo copy, paste, reset and independent Post reset", () => {
    const { context } = createEditing();
    context.photoEdits.setEffect("first", "clarity", { ...defaultClarity(), clarity: 30 });
    context.post.setEffect("clarity", { ...defaultClarity(), structure: 15 });
    const tool = new ClarityTool("photo", context);
    const host = fakeHost("second");

    const copy = tool.serializeEdit("first") as ClaritySettings;
    tool.applyEdit(host, copy);
    copy.clarity = 90;
    expect(tool.hasEdits("second")).toBe(true);
    expect(tool.value(host).clarity).toBe(30);

    tool.reset(host);
    expect(tool.hasEdits("second")).toBe(false);
    expect(tool.value(host)).toEqual(defaultClarity());
    expect(context.photoEdits.effect("first", "clarity")?.clarity).toBe(30);

    const postTool = new ClarityTool("post", context);
    expect(postTool.value(host).structure).toBe(15);
    postTool.applyEdit(host, copy);
    expect(postTool.value(host).clarity).toBe(0);
    postTool.reset(host);
    expect(context.post.effect("clarity")).toEqual(defaultClarity());
  });

  it("pasting nothing or a neutral value clears the photo's edit", () => {
    const { context } = createEditing();
    const color = new ColorTool("photo", context);
    const host = fakeHost("photo");
    color.change(host, { ...defaultColor(), saturation: 20 });
    expect(color.hasEdits("photo")).toBe(true);
    color.applyEdit(host, defaultColor());
    expect(color.hasEdits("photo")).toBe(false);
    expect(color.serializeEdit("photo")).toBeNull();

    const grain = new GrainTool("photo", context);
    grain.applyEdit(host, { amount: 12 });
    expect(grain.value(host)).toEqual({ ...defaultGrain(), amount: 12 });
    expect(grain.canRevert(host)).toBe(true);
    grain.applyEdit(host, null);
    expect(grain.canRevert(host)).toBe(false);
    expect(grain.canRevert(fakeHost(null))).toBe(false);
  });

  it("tone edits single values and resets its two sections separately", () => {
    const { context } = createEditing();
    const tool = new ToneTool("photo", context);
    const host = fakeHost("photo");
    tool.setKey(host, "exposure", 25);
    tool.setKey(host, "shadows", 10);
    expect(tool.value(host)).toEqual({ ...defaultTone(), exposure: 25, shadows: 10 });

    tool.resetBaseTone(host);
    expect(tool.value(host)).toEqual({ ...defaultTone(), shadows: 10 });
    tool.resetKey(host, "shadows");
    expect(tool.hasEdits("photo")).toBe(false);
    expect(context.photoEdits.effect("photo", "tone")).toBeNull();

    const postTool = new ToneTool("post", context);
    postTool.setKey(host, "whites", 30);
    postTool.setKey(host, "contrast", 5);
    postTool.resetDynamicRange(host);
    expect(context.post.effect("tone")).toEqual({ ...defaultTone(), contrast: 5 });
    expect(tool.hasEdits("photo")).toBe(false);
  });

  it("switches its effect off for the photo it is editing", () => {
    const { context } = createEditing();
    const tool = new ToneTool("photo", context);
    const host = fakeHost("photo");
    tool.toggleEffect(host, "base-tone");
    expect(tool.isEffectDisabled(host, "base-tone")).toBe(true);
    expect(tool.isEffectDisabled(host, "dynamic-range")).toBe(false);
    expect(tool.isEffectDisabled(fakeHost("other"), "base-tone")).toBe(false);
    expect(context.toggles.isEnabled("photo", "photo", "base-tone")).toBe(false);
  });

  it("bloom lives in Post only and can be reverted once any value differs from the defaults", () => {
    const { context } = createEditing();
    const tool = new BloomTool("post", context);
    const host = fakeHost("photo");
    expect(tool.canRevert(host)).toBe(false);
    tool.change(host, { ...defaultBloom(), radius: 80 });
    expect(tool.canRevert(host)).toBe(true);
    expect(tool.hasEdits()).toBe(false);
    tool.change(host, { ...defaultBloom(), strength: 40 });
    expect(tool.hasEdits()).toBe(true);
    expect(tool.serializeEdit("photo")).toBeNull();
    tool.reset(host);
    expect(context.post.effect("bloom")).toEqual(defaultBloom());
  });
});

describe("ToolRegistry", () => {
  it("Clarity follows Dynamic Range and Analog is last in both scopes", () => {
    const { context } = createEditing();
    const registry = ToolRegistry.standard();
    const ids = (scope: "photo" | "post") => registry.createTools(scope, context).map((tool) => tool.id);
    expect(ids("photo")).toEqual(["crop", "tone", "clarity", "color", "curve", "sharpen", "grain", "analog"]);
    expect(ids("post")).toEqual(["bloom", "tone", "clarity", "color", "curve", "sharpen", "grain", "analog"]);
    expect(registry.get("clarity")?.title).toBe("Clarity / Structure");
    expect(registry.createTools("post", context).every((tool) => tool.scope === "post")).toBe(true);
  });

  it("takes a new tool with one registration, including tools that are not effects", () => {
    const { context } = createEditing();
    const registry = ToolRegistry.standard().register({
      id: "red-eye",
      title: "Red Eye",
      order: 12,
      scopes: ["photo"],
      create: (scope, editing) => new RedEyeTool(scope, editing),
    });
    const tools = registry.createTools("photo", context);
    expect(tools.map((tool) => tool.id).slice(0, 3)).toEqual(["crop", "red-eye", "tone"]);
    expect(registry.forScope("post").some((tool) => tool.id === "red-eye")).toBe(false);
    expect(() => registry.register({ ...registry.get("red-eye")! })).toThrow(/already registered/);
  });
});

describe("CropTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function cropping(target: string | null = "photo") {
    const editing = createEditing();
    const host = fakeHost(target);
    host.frame = frame;
    return { ...editing, host, tool: new CropTool("photo", editing.context) };
  }

  it("saves the canvas frame with its aspect, orientation and rotation on every interaction", () => {
    const { tool, host, context } = cropping();
    tool.setCardOpen(host, true);
    expect(host.activeTool).toBe("crop");
    expect(tool.applyToCanvas()).toEqual({ cropMode: true, cropAspect: 1.5, rotation: 0, horizonMode: false, sizing: "fit" });

    tool.setAspect(host, "16:9");
    tool.setOrientation(host, "portrait");
    tool.rotateQuarterTurn(host, 1);
    tool.setStraighten(host, 3);
    const saved: CropEdit = { ...frame, aspectRatio: "16:9", orientation: "portrait", rotation: 93 };
    expect(context.photoEdits.crop("photo")).toEqual(saved);
    expect(tool.effectiveAspect()).toBeCloseTo(9 / 16);

    let changes = 0;
    context.photoEdits.subscribe(() => (changes += 1));
    tool.onCanvasCropChange(host);
    expect(changes).toBe(0);
    host.frame = { ...frame, width: 0.5 };
    tool.onCanvasCropChange(host);
    expect(context.photoEdits.crop("photo")?.width).toBe(0.5);

    tool.setCardOpen(host, false);
    expect(host.activeTool).toBeNull();
    expect(host.flushes).toBe(1);
    expect(tool.cardOpen).toBe(false);
  });

  it("copies and pastes a crop and picks up the saved crop of the next photo", () => {
    const { tool, host, context } = cropping();
    const crop: CropEdit = { ...frame, aspectRatio: "1:1", orientation: "portrait", rotation: -90 };
    context.photoEdits.setCrop("first", crop);
    const copy = tool.serializeEdit("first");
    tool.applyEdit(host, copy);
    expect(context.photoEdits.crop("photo")).toEqual(crop);
    expect([tool.aspect, tool.orientation, tool.rotation]).toEqual(["1:1", "portrait", -90]);

    tool.applyEdit(host, null);
    expect(tool.hasEdits("photo")).toBe(false);
    context.photoEdits.setCrop("next", { ...crop, aspectRatio: "4:3", rotation: 2 });
    tool.syncFromStore("next");
    expect([tool.aspect, tool.rotation]).toEqual(["4:3", 2]);
  });

  it("turns a drawn horizon into a rotation and lets Escape leave horizon mode first", () => {
    const { tool, host, context } = cropping();
    tool.activate(host);
    tool.toggleHorizonMode(host);
    const event = { key: "Escape", preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    expect(tool.handleKey(event, host)).toBe(true);
    expect(tool.horizonModeActive).toBe(false);
    expect(tool.handleKey(event, host)).toBe(false);
    expect(tool.handleKey({ ...event, key: "Enter" }, host)).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledTimes(3);
    expect(tool.handleKey({ ...event, key: "a", preventDefault: () => expect.unreachable() }, host)).toBe(false);

    tool.toggleHorizonMode(host);
    tool.onCanvasHorizonLine(host, 50);
    expect(tool.rotation).toBe(-40);
    expect(tool.horizonModeActive).toBe(false);
    expect(context.photoEdits.crop("photo")?.rotation).toBe(-40);
    tool.onCanvasHorizonLine(host, Number.NaN);
    expect(tool.rotation).toBe(-40);
    tool.onCanvasOrientationFlip(host);
    expect(tool.orientation).toBe("portrait");
  });

  it("reset ignores the canvas until it has shown the reset frame, then clears the crop", async () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
    const { tool, host, context } = cropping();
    tool.activate(host);
    tool.setAspect(host, "1:1");
    expect(tool.canRevert(host)).toBe(true);

    const reset = tool.reset(host);
    expect([tool.aspect, tool.orientation, tool.rotation]).toEqual(["3:2", "landscape", 0]);
    host.frame = { x: 0, y: 0, width: 1, height: 1 };
    tool.onCanvasCropChange(host);
    expect(context.photoEdits.crop("photo")?.aspectRatio).toBe("1:1");
    frames.shift()!();
    await Promise.resolve();
    frames.shift()!();
    await reset;
    expect(context.photoEdits.crop("photo")).toBeNull();
    expect(tool.canRevert(host)).toBe(false);

    tool.onCanvasCropChange(host);
    expect(context.photoEdits.crop("photo")?.aspectRatio).toBe("3:2");
  });
});

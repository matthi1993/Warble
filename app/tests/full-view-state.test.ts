import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW_STATE, type ViewState } from "@app/state/view-state-store";
import { HdPreloadController } from "@app/views/full-view/hd-preload-controller";
import { MenuController } from "@app/views/full-view/menu-controller";
import { ViewStateController } from "@app/views/full-view/view-state-controller";
import { CountingHost, FakeStage, photo, video } from "./support/full-view-fakes";

function createViewState(persisted: Partial<ViewState>) {
  const host = new CountingHost();
  const menus = new MenuController(host);
  const saved: ViewState[] = [];
  let viewResets = 0;
  const controller = new ViewStateController(
    host,
    { load: async () => persisted, save: async (view) => void saved.push(view) },
    menus,
    () => ({ resetView: () => void viewResets++ }) as never,
  );
  return { controller, menus, saved, resets: () => viewResets };
}

describe("ViewStateController", () => {
  it("saves nothing before the persisted state is read and keeps what was persisted", async () => {
    const { controller, saved } = createViewState({ bg: "white", frameSize: 12 });
    controller.setSmoothing("low");
    expect(saved).toEqual([]);

    await controller.hydrate();
    expect(controller.value).toEqual({ ...DEFAULT_VIEW_STATE, smoothing: "low", bg: "white", frameSize: 12 });
    expect(controller.foregroundCss).toBe("#000");
    expect(saved).toEqual([controller.value]);

    controller.setFrameRadius(8);
    expect(saved[1].frameRadius).toBe(8);
  });

  it("recentres the image when the active size or scale is chosen again", async () => {
    const { controller, menus, saved, resets } = createViewState({});
    await controller.hydrate();
    expect(saved).toEqual([]);

    controller.setSizing("fill");
    expect([saved.length, resets()]).toEqual([1, 0]);
    controller.setSizing("fill");
    controller.setProofingSize(0);
    controller.setFrameSize(0);
    expect([saved.length, resets()]).toEqual([1, 3]);

    menus.toggle("bg");
    controller.setBackground("grey");
    expect(menus.open).toBeNull();
    expect(controller.backgroundCss).toBe("#808080");
  });
});

describe("HdPreloadController", () => {
  function createPreloads(stage: FakeStage, canvasPath: string | null) {
    const updates: Array<[string | null, string[], boolean]> = [];
    const controller = new HdPreloadController(
      stage.model,
      stage.resolver,
      { update: (path, upcoming, ready) => void updates.push([path, [...upcoming], ready]), stop: () => {} },
      () => ({ path: canvasPath, imageReady: true }) as never,
    );
    return { controller, updates };
  }

  it("prepares the next three distinct images, skipping videos, once the open image is on screen", () => {
    const stage = new FakeStage([photo("a"), video("clip"), photo("b"), photo("b"), photo("c"), photo("d"), photo("e")]);
    const { controller, updates } = createPreloads(stage, "a.jpg");
    controller.syncIfInputsChanged();
    controller.syncIfInputsChanged();
    expect(updates).toEqual([["a.jpg", ["b.jpg", "c.jpg", "d.jpg"], true]]);

    stage.sequence.index = 4;
    controller.syncIfInputsChanged();
    expect(updates[1]).toEqual(["c.jpg", ["d.jpg", "e.jpg"], false]);
  });

  it("follows a changed variant and preloads nothing while a video is shown", () => {
    const stage = new FakeStage([photo("a"), photo("b", ["Edit"]), video("clip")]);
    const { controller, updates } = createPreloads(stage, "a.jpg");
    controller.syncIfInputsChanged();
    stage.preferences.set("b.jpg", { format: "jpg", variant: "Edit" });
    controller.syncIfInputsChanged();
    expect(updates).toHaveLength(1);
    controller.variantsChanged();
    controller.syncIfInputsChanged();
    expect(updates[1]).toEqual(["a.jpg", ["b (Edit).jpg"], true]);

    stage.sequence.index = 2;
    controller.syncIfInputsChanged();
    expect(updates[2]).toEqual([null, [], false]);
  });
});

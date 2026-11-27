import { describe, expect, it } from "vitest";
import { SliderDragController, type SliderDragHost } from "../src/ui/controls/slider-drag-controller";

function setup() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { defaultView: window });
  const slider = Object.assign(new EventTarget(), { ownerDocument: document as unknown as Document });
  const host: SliderDragHost = slider;
  const announced: Event[] = [];
  for (const type of ["slider-interaction-start", "slider-interaction-end"]) {
    slider.addEventListener(type, (event) => announced.push(event));
  }
  const release = (type: "pointerup" | "pointercancel", pointerId = 7) => {
    document.dispatchEvent(Object.assign(new Event(type), { pointerId }));
  };
  const types = () => announced.map((event) => event.type);
  return { controller: new SliderDragController(host), window, announced, release, types };
}

const press = {
  button: 0,
  pointerId: 7,
  currentTarget: {
    setPointerCapture(): never {
      throw new Error("native range inputs must own their pointer capture");
    },
  },
};

describe("SliderDragController", () => {
  it("leaves native capture alone and finishes once when released outside the control", () => {
    const { controller, window, announced, release, types } = setup();

    controller.begin(press);
    release("pointerup", 8);
    expect(types()).toEqual(["slider-interaction-start"]);
    release("pointerup");
    release("pointerup");
    expect(types()).toEqual(["slider-interaction-start", "slider-interaction-end"]);
    expect(announced.every((event) => event.bubbles && event.composed)).toBe(true);

    controller.begin(press);
    release("pointercancel");
    expect(types()).toEqual([
      "slider-interaction-start",
      "slider-interaction-end",
      "slider-interaction-start",
      "slider-interaction-end",
    ]);

    controller.begin(press);
    controller.finish();
    release("pointerup");
    expect(announced).toHaveLength(6);
    expect(controller.dragging).toBe(false);

    controller.begin(press);
    window.dispatchEvent(new Event("blur"));
    release("pointerup");
    expect(announced).toHaveLength(8);
    expect(controller.dragging).toBe(false);
  });

  it("starts only with the primary button and tracks one pointer at a time", () => {
    const { controller, release, types } = setup();

    controller.begin({ button: 2, pointerId: 7 });
    expect(types()).toEqual([]);

    controller.begin(press);
    controller.begin({ button: 0, pointerId: 9 });
    release("pointerup", 9);
    expect(types()).toEqual(["slider-interaction-start"]);
    expect(controller.dragging).toBe(true);
  });
});

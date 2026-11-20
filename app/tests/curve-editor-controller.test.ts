import { defaultCurve, identityCurveChannel, type CurveChannel, type CurveEdit } from "@warble/render";
import { describe, expect, it } from "vitest";
import { CurveEditorController, type CurveGridSurface } from "../src/editor/tools/curve/curve-editor-controller";
import { CurveGridGeometry } from "../src/editor/tools/curve/curve-grid-geometry";

/** The grid is 240 wide with 8 padding, so curve value 0 lies at 8, 0.5 at 120 and 1 at 232 (y runs downwards). */
class FakeGrid implements CurveGridSurface {
  capturedPointer: number | null = null;

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 240, height: 240 };
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointer = pointerId;
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointer === pointerId;
  }

  releasePointerCapture(): void {
    this.capturedPointer = null;
  }
}

function setup(value: CurveEdit = defaultCurve()) {
  const state = { value, updates: 0 };
  const changes: CurveEdit[] = [];
  const channelResets: CurveChannel[] = [];
  const controller = new CurveEditorController(
    {
      currentValue: () => state.value,
      requestUpdate: () => {
        state.updates += 1;
      },
      emitChange: (curve) => changes.push(curve),
      emitChannelReset: (channel) => channelResets.push(channel),
    },
    new CurveGridGeometry(),
  );
  const latest = () => changes[changes.length - 1];
  return { state, changes, latest, channelResets, controller, grid: new FakeGrid() };
}

const press = (clientX: number, clientY: number, button = 0) => ({ clientX, clientY, button, pointerId: 3 });
const threePoints = (): CurveEdit => ({
  ...defaultCurve(),
  rgb: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 1 },
  ],
});

describe("CurveEditorController", () => {
  it("inserts a point under the pointer in x order and drags it until release", () => {
    const { state, changes, latest, controller, grid } = setup();

    expect(controller.insertPoint(press(120, 64), grid)).toBe(true);
    expect(latest().rgb).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.75 },
      { x: 1, y: 1 },
    ]);
    expect(grid.capturedPointer).toBe(3);

    controller.dragTo({ clientX: 176, clientY: 120 }, grid);
    expect(latest().rgb[1]).toEqual({ x: 0.75, y: 0.5 });
    expect(state.value).toEqual(defaultCurve());
    expect(controller.points).toHaveLength(3);

    controller.endDrag({ pointerId: 3 }, grid);
    expect(grid.capturedPointer).toBeNull();
    expect(controller.curve).toBe(state.value);
    controller.dragTo({ clientX: 60, clientY: 60 }, grid);
    expect(changes).toHaveLength(2);
    expect(state.updates).toBeGreaterThan(0);
  });

  it("ignores other mouse buttons and a click right above an existing point", () => {
    const { changes, controller, grid } = setup(threePoints());

    expect(controller.insertPoint(press(60, 60, 2), grid)).toBe(false);
    expect(controller.insertPoint(press(120.5, 30), grid)).toBe(false);
    expect(controller.grabPoint(1, press(120, 120, 2), grid)).toBe(false);
    expect(changes).toEqual([]);
    expect(grid.capturedPointer).toBeNull();
  });

  it("keeps the grab offset and holds an inner point between its neighbours", () => {
    const { changes, latest, controller, grid } = setup(threePoints());

    expect(controller.grabPoint(1, press(123, 118), grid)).toBe(true);
    expect(changes).toEqual([]);
    controller.dragTo({ clientX: 179, clientY: 118 }, grid);
    expect(latest().rgb[1]).toEqual({ x: 0.75, y: 0.5 });

    controller.dragTo({ clientX: 900, clientY: -50 }, grid);
    expect(latest().rgb[1]).toEqual({ x: 1 - 1 / 255, y: 1 });
    controller.dragTo({ clientX: -900, clientY: 900 }, grid);
    expect(latest().rgb[1]).toEqual({ x: 1 / 255, y: 0 });
  });

  it("moves an end point in height only", () => {
    const { latest, controller, grid } = setup(threePoints());

    controller.grabPoint(0, press(8, 232), grid);
    controller.dragTo({ clientX: 100, clientY: 120 }, grid);
    expect(latest().rgb[0]).toEqual({ x: 0, y: 0.5 });
    controller.endDrag({ pointerId: 3 }, grid);

    controller.grabPoint(2, press(232, 8), grid);
    controller.dragTo({ clientX: 100, clientY: 120 }, grid);
    expect(latest().rgb[2]).toEqual({ x: 1, y: 0.5 });
  });

  it("removes inner points but never the end points", () => {
    const { changes, controller } = setup(threePoints());

    controller.removePoint(0);
    controller.removePoint(2);
    expect(changes).toEqual([]);
    controller.removePoint(1);
    expect(changes).toEqual([defaultCurve()]);
  });

  it("edits and resets the selected channel without touching the others", () => {
    const { state, changes, latest, channelResets, controller, grid } = setup(threePoints());

    controller.selectChannel("r");
    controller.resetChannel("r");
    expect(changes).toEqual([]);

    controller.insertPoint(press(120, 64), grid);
    controller.endDrag({ pointerId: 3 }, grid);
    expect(latest().r).toHaveLength(3);
    expect(latest().rgb).toEqual(threePoints().rgb);

    controller.resetChannel("rgb");
    expect(latest()).toEqual({ ...state.value, rgb: identityCurveChannel() });
    expect(channelResets).toEqual(["rgb"]);
  });
});

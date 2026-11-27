import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERACTION_RENDER_SCALE, RenderQuality } from "../src";

describe("RenderQuality", () => {
  let changes: number;
  let quality: RenderQuality;

  beforeEach(() => {
    vi.useFakeTimers();
    changes = 0;
    quality = new RenderQuality(() => changes++);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reduces resolution while edits keep arriving and restores it 120 ms after the last one", () => {
    for (let change = 0; change < 120; change++) {
      quality.editChanged();
      expect(vi.getTimerCount()).toBe(1);
    }
    expect(quality.scale).toBe(INTERACTION_RENDER_SCALE);
    expect(changes).toBe(1);
    vi.advanceTimersByTime(119);
    expect(quality.reduced).toBe(true);
    vi.advanceTimersByTime(1);
    expect(quality.scale).toBe(1);
    expect(changes).toBe(2);
  });

  it("holds the reduced resolution during a slider gesture and restores it on release", () => {
    quality.beginEdit();
    for (let change = 0; change < 100; change++) quality.editChanged();
    expect(vi.getTimerCount()).toBe(0);
    expect(quality.reduced).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(quality.reduced).toBe(true);
    quality.endEdit();
    expect(quality.reduced).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps full resolution when a slider is pressed and released without a change", () => {
    quality.beginEdit();
    expect(quality.scale).toBe(1);
    quality.endEdit();
    expect(changes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles a wheel zoom after 120 ms but waits for the pointer during a drag", () => {
    quality.viewportChanged(false);
    expect(quality.reduced).toBe(true);
    vi.advanceTimersByTime(120);
    expect(quality.reduced).toBe(false);
    expect(changes).toBe(1);

    quality.viewportChanged(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(quality.reduced).toBe(true);
    quality.viewportSettled();
    expect(quality.reduced).toBe(false);
    expect(changes).toBe(2);
  });

  it("does not announce a settle when the viewport was not moving", () => {
    quality.viewportSettled();
    expect(changes).toBe(0);
  });

  it("reset cancels both timers and restores full resolution without announcing it", () => {
    quality.editChanged();
    quality.viewportChanged(false);
    expect(vi.getTimerCount()).toBe(2);
    changes = 0;
    quality.reset();
    expect(vi.getTimerCount()).toBe(0);
    expect(quality.scale).toBe(1);
    expect(changes).toBe(0);
  });
});

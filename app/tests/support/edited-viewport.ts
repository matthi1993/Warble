import { expect } from "vitest";
import type { RenderRequest } from "@warble/render";
import { fakeBitmap } from "./viewer-fakes";
import { createViewer } from "./viewer-harness";

/** A connected viewer showing an edited 2400×1600 full-resolution photo fitted into a 1200×800 canvas. */
export function editedViewport() {
  const fixture = createViewer();
  const full = fakeBitmap(2400, 1600);
  fixture.connect();
  fixture.host.path = "photo";
  fixture.sources.setFull("photo", full);
  fixture.scene.fit();
  return {
    ...fixture,
    full,
    draw: () => fixture.scene.redraw(),
    renderedSize: () => [fixture.pipeline.lastRender.outputWidth, fixture.pipeline.lastRender.outputHeight],
  };
}

export function expectInteractionPreview(render: RenderRequest): void {
  expect(render.outputWidth).toBeGreaterThanOrEqual(600);
  expect(render.outputWidth).toBeLessThan(1200);
  expect(render.outputHeight).toBeGreaterThanOrEqual(400);
  expect(render.outputHeight).toBeLessThan(800);
  expect(render.outputWidth / render.outputHeight).toBe(1.5);
  expect(render.effectSize).toEqual({ width: 1200, height: 800 });
}

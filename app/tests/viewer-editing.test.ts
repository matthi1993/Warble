import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editedViewport, expectInteractionPreview } from "./support/edited-viewport";
import { fakeBitmap } from "./support/viewer-fakes";
import { createViewer, installBrowser, uninstallBrowser } from "./support/viewer-harness";

function zoomedFullResolutionPhoto() {
  const fixture = createViewer();
  const hd = fakeBitmap(1920, 1280);
  const full = fakeBitmap(6000, 4000);
  fixture.connect();
  fixture.host.path = "photo";
  fixture.host.editing = true;
  fixture.sources.setHd("photo", hd);
  fixture.sources.setFull("photo", full);
  fixture.scene.viewport.userInteracted = true;
  fixture.scene.viewport.scale = 1;
  return { ...fixture, hd, full, sliderChanged: () => fixture.edits.listener!.onEffects() };
}

describe("viewer while editing", () => {
  beforeEach(() => void installBrowser());
  afterEach(uninstallBrowser);

  it("editing preserves the full-resolution source and viewport throughout slider changes", () => {
    const { host, scene, sources, full, sliderChanged } = zoomedFullResolutionPhoto();
    expect(sources.current).toBe(full);
    for (let tick = 0; tick < 120; tick++) {
      sliderChanged();
      expect(scene.geometry.image()!.source).toBe(full);
      expect(vi.getTimerCount()).toBe(1);
    }
    expect(scene.viewport.scale).toBe(1);
    vi.advanceTimersByTime(120);
    expect(scene.quality.reduced).toBe(false);
    expect(sources.current).toBe(full);
    expect(scene.viewport.scale).toBe(1);
    expect(host.editing).toBe(true);
  });

  it("slider release restores full rendering immediately without switching sources during a paused drag", () => {
    const { viewer, scene, sources, full, sliderChanged } = zoomedFullResolutionPhoto();
    viewer.beginEditInteraction();
    for (let change = 0; change < 100; change++) sliderChanged();
    expect(sources.current).toBe(full);
    expect(vi.getTimerCount()).toBe(0);
    expect(scene.quality.reduced).toBe(true);
    viewer.endEditInteraction();
    expect(scene.quality.reduced).toBe(false);
    expect(sources.current).toBe(full);
    expect(scene.viewport.scale).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    sliderChanged();
    vi.advanceTimersByTime(119);
    expect(scene.quality.reduced).toBe(true);
    vi.advanceTimersByTime(1);
    expect(scene.quality.reduced).toBe(false);
    expect(sources.current).toBe(full);
  });

  it("rotated full-resolution sources remain stable across repeated slider drags", () => {
    const { viewer, edits, scene, pipeline, rotations, sliderChanged } = zoomedFullResolutionPhoto();
    edits.cropIsEnabled = true;
    edits.savedCrop = { x: 0, y: 0, width: 1, height: 1, rotation: 10 };
    edits.listener!.onEdit("photo");
    const fullSource = scene.geometry.image()!.source;
    expect(fullSource).toBe(rotations[0]);
    const releases = pipeline.releases;
    for (let drag = 0; drag < 10; drag++) {
      expect(scene.geometry.image()!.source).toBe(fullSource);
      viewer.beginEditInteraction();
      sliderChanged();
      expect(scene.geometry.image()!.source).toBe(fullSource);
      viewer.endEditInteraction();
    }
    expect(rotations).toHaveLength(1);
    expect(pipeline.releases).toBe(releases);
  });

  it("clicking a slider without changing its value keeps full rendering quality", () => {
    const { viewer, scene, draw, renderedSize } = editedViewport();
    viewer.beginEditInteraction();
    draw();
    expect(scene.quality.reduced).toBe(false);
    expect(renderedSize()).toEqual([1200, 800]);
    expect(vi.getTimerCount()).toBe(0);
    viewer.endEditInteraction();
  });

  it("slider previews retain detail from the full source even when an HD bitmap is available", () => {
    const { viewer, edits, sources, pipeline, full, draw, renderedSize } = editedViewport();
    sources.setHd("photo", fakeBitmap(600, 400));
    viewer.beginEditInteraction();
    edits.listener!.onEffects();
    draw();
    expect(pipeline.lastRender.source).toBe(full);
    expectInteractionPreview(pipeline.lastRender);
    viewer.endEditInteraction();
    draw();
    expect(renderedSize()).toEqual([1200, 800]);
  });

  it("a saved crop change returns to fit but a tone edit keeps the user's zoom", () => {
    const { edits, scene } = zoomedFullResolutionPhoto();
    edits.listener!.onEdit("photo");
    expect(scene.viewport.scale).toBe(1);
    edits.cropIsEnabled = true;
    edits.savedCrop = { x: 0, y: 0, width: 0.5, height: 0.5 };
    edits.listener!.onEdit("photo");
    expect(scene.viewport.userInteracted).toBe(false);
    expect(scene.viewport.scale).toBe(scene.viewport.fitScale);
    expect(scene.viewport.fitScale).toBe(0.4);
  });

  it("the Post switch and comparing with the original change the rendered recipe", () => {
    const { host, edits, pipeline, draw } = editedViewport();
    const analog = { vignette: 20, halation: 0, chromaticAberration: 0 };
    edits.layers = { photo: { analog }, post: { analog: { ...analog, vignette: 10 } } };
    draw();
    expect(pipeline.lastRender.recipe).toEqual(edits.layers);
    edits.listener!.onPostEnabled(false);
    draw();
    expect(pipeline.lastRender.recipe).toEqual({ photo: edits.layers.photo, post: {} });
    host.previewOriginal = true;
    draw();
    expect(pipeline.lastRender.recipe).toEqual({ photo: {}, post: {} });
  });
});

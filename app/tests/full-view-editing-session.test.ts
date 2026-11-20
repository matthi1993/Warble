import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditingContext, RecipeBuilder, ToolRegistry, type CropEdit } from "@warble/editing";
import type { Photo } from "@warble/library";
import { EditClipboard } from "@app/views/full-view/edit-clipboard";
import { EditingSessionController } from "@app/views/full-view/editing-session-controller";
import { OriginalPreviewController } from "@app/views/full-view/original-preview-controller";
import { FakeStage, photo, settle, video } from "./support/full-view-fakes";
import { InMemoryEditRepository } from "./support/in-memory-edit-repository";

const CROP: CropEdit = { x: 0.1, y: 0.1, width: 0.6, height: 0.4, aspectRatio: "3:2", orientation: "landscape", rotation: 2 };

function createEditing(): EditingContext {
  return EditingContext.create(new InMemoryEditRepository(), null);
}

function createSession(photos: Photo[], editing = createEditing(), clipboard = new EditClipboard()) {
  const stage = new FakeStage(photos);
  const view = {
    updates: 0,
    reveals: 0,
    requestUpdate: () => void view.updates++,
    revealEditPanel: () => void view.reveals++,
    canvas: () => null,
  };
  const session = new EditingSessionController(view, stage.model, {
    editing,
    tools: ToolRegistry.standard(),
    clipboard,
  });
  const compare = new OriginalPreviewController(view, stage.model, new RecipeBuilder(editing));
  return { session, compare, stage, view, editing };
}

function editPhoto(editing: EditingContext, path: string): void {
  editing.photoEdits.setEffect(path, "tone", { ...editing.effects.defaults("tone"), exposure: 0.5 });
  editing.photoEdits.setEffect(path, "sharpen", { strength: 0.4, radius: 2, threshold: 0 });
  editing.photoEdits.setCrop(path, CROP);
}

describe("EditingSessionController", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 0;
    });
  });
  afterEach(() => void vi.unstubAllGlobals());

  it("pastes the copied edits of one photo onto another and leaves its other tools alone", () => {
    const { session, stage, editing } = createSession([photo("a"), photo("b")]);
    const { photoEdits } = editing;
    editPhoto(editing, "a.jpg");
    photoEdits.setEffect("b.jpg", "grain", editing.effects.defaults("grain"));

    expect(session.copyEdits()).toBe(true);
    stage.sequence.index = 1;
    expect(session.pasteEdits()).toBe(true);

    expect(photoEdits.effect("b.jpg", "tone")).toEqual(photoEdits.effect("a.jpg", "tone"));
    expect(photoEdits.effect("b.jpg", "sharpen")).toEqual({ strength: 0.4, radius: 2, threshold: 0 });
    expect(photoEdits.crop("b.jpg")).toEqual(CROP);
    expect(photoEdits.hasEffect("b.jpg", "grain")).toBe(true);
    expect(photoEdits.hasEffect("b.jpg", "curve")).toBe(false);
  });

  it("keeps copied edits for a full view that is opened later", () => {
    const editing = createEditing();
    const clipboard = new EditClipboard();
    const first = createSession([photo("a")], editing, clipboard);
    editPhoto(editing, "a.jpg");
    first.session.copyEdits();
    editing.photoEdits.setEffect("a.jpg", "sharpen", null);

    const later = createSession([photo("b")], editing, clipboard);
    expect(later.session.pasteEdits()).toBe(true);
    expect(editing.photoEdits.effect("b.jpg", "sharpen")).toEqual({ strength: 0.4, radius: 2, threshold: 0 });
  });

  it("has nothing to copy from a video and nothing to paste before a copy", () => {
    const empty = createSession([photo("a")]);
    expect(empty.session.pasteEdits()).toBe(false);

    const clip = createSession([video("clip")]);
    expect(clip.session.copyEdits()).toBe(false);
    expect(clip.session.hasAnyEdit()).toBe(false);
    expect(clip.compare.available).toBe(false);
  });

  it("reverts every tool of the displayed photo and nothing else", async () => {
    const { session, editing } = createSession([photo("a"), photo("b")]);
    editPhoto(editing, "a.jpg");
    editPhoto(editing, "b.jpg");
    expect(session.hasAnyEdit()).toBe(true);

    await session.resetAll();
    expect(session.hasAnyEdit()).toBe(false);
    expect(editing.photoEdits.hasEdits("a.jpg")).toBe(false);
    expect(editing.photoEdits.hasEdits("b.jpg")).toBe(true);
  });

  it("lets one tool own the canvas at a time and releases it again", async () => {
    const { session, view } = createSession([photo("a")]);
    expect(session.canvasOverrides()).toEqual({});

    session.toggleToolById("crop");
    expect(view.reveals).toBe(1);
    expect(session.activeTool()?.id).toBe("crop");
    expect(session.canvasOverrides().cropMode).toBe(true);

    session.toggleToolById("crop");
    expect(session.activeTool()).toBeNull();
    session.toggleToolById("crop");
    session.deactivateActiveTool();
    expect(session.canvasOverrides()).toEqual({});
    await settle();
  });

  it("opens and closes a tool card from its shortcut", () => {
    const { session, view } = createSession([photo("a")]);
    const tone = session.tools.find((tool) => tool.id === "tone")!;
    session.toggleCard("tone");
    expect([tone.cardOpen, view.reveals]).toEqual([true, 1]);
    session.toggleCard("tone");
    expect(tone.cardOpen).toBe(false);
  });

  it("compares with the original only while the photo has visible edits", () => {
    const { compare, editing } = createSession([photo("a")]);
    editing.post.setEnabled(false);
    expect(compare.begin()).toBe(false);
    expect(compare.showing).toBe(false);

    editPhoto(editing, "a.jpg");
    expect(compare.begin()).toBe(true);
    expect(compare.showing).toBe(true);
    compare.show(false);
    expect(compare.showing).toBe(false);
  });

  it("refreshes for saved edits of the displayed photo, Post changes and toggles until disconnected", () => {
    const { session, view, editing } = createSession([photo("a"), photo("b")]);
    const tone = { ...editing.effects.defaults("tone"), exposure: 0.3 };
    session.connect();

    editing.photoEdits.setEffect("b.jpg", "tone", tone);
    expect(view.updates).toBe(0);
    editing.photoEdits.setEffect("a.jpg", "tone", tone);
    expect(view.updates).toBe(1);
    session.toggleEditsEnabled();
    expect(view.updates).toBe(2);
    expect(session.editsEnabled).toBe(false);
    session.togglePostProcess();
    expect(view.updates).toBe(3);

    session.disconnect();
    editing.photoEdits.setEffect("a.jpg", "tone", null);
    expect(view.updates).toBe(3);
  });
});

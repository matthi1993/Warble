import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadService(path, dependencies) {
  return loadSource(`services/${path}`, dependencies);
}

function loadSource(path, dependencies) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  });
  const exports = {};
  new Function("require", "exports", outputText)((name) => {
    assert.ok(name in dependencies, `Missing dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

function componentDependencies() {
  return {
    lit: {
      LitElement: class extends EventTarget {},
      css: () => "",
      html: (strings, ...values) => ({ strings, values }),
    },
    "lit/decorators.js": {
      customElement: () => (target) => target,
      property: () => () => {},
      state: () => () => {},
    },
  };
}

test("touch hold starts photo dragging while taps and scrolling keep their normal behavior", (t) => {
  const previousWindow = globalThis.window;
  const timers = new Map();
  let timerId = 0;
  globalThis.window = {
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  };
  t.after(() => { globalThis.window = previousWindow; });
  const { PfThumbnailCard } = loadSource("features/image-viewer/pf-thumbnail-card.ts", {
    ...componentDependencies(),
    "@services/images/thumbnail-service": {},
    "@ui/icons/pf-icon": {},
    "@features/rating/pf-rating-overlay": {},
    "@services/images/video-source": {},
  });
  const card = new PfThumbnailCard();
  card.path = "photo.jpg";
  const events = [];
  for (const type of ["photo-pointer-drag-start", "photo-selected", "photo-context-menu", "photo-open"]) {
    card.addEventListener(type, (event) => events.push(event));
  }
  const pointer = {
    pointerType: "touch", button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 100,
    target: { closest: () => null }, currentTarget: { setPointerCapture() {} }, preventDefault() {},
  };
  card.onPointerDown(pointer);
  card.onPointerUp(pointer);
  assert.deepEqual(events.map((event) => event.type), ["photo-selected"]);
  assert.equal(timers.size, 0);
  events.length = 0;
  card.onPointerDown(pointer);
  card.onPointerMove({ ...pointer, clientY: 130 });
  assert.equal(timers.size, 0);
  assert.equal(events.length, 0);
  card.onPointerDown(pointer);
  [...timers.values()][0]();
  assert.deepEqual(events.map((event) => event.type), ["photo-pointer-drag-start"]);
  assert.deepEqual(events[0].detail, { path: "photo.jpg", pointerId: 1, x: 100, y: 100 });
  let prevented = false;
  card.onTouchMove({ cancelable: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  card.suppressContextMenuUntil = 0;
  card.onContextMenu(pointer);
  card.suppressClickUntil = 0;
  card.onPointerUp(pointer);
  card.onClick({ type: "click" });
  assert.deepEqual(events.map((event) => event.type), ["photo-pointer-drag-start"]);
  prevented = false;
  card.onTouchMove({ cancelable: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  card.onPointerDown(pointer);
  card.cancelLongPress();
  assert.equal(timers.size, 0);
});

test("auto rotation follows the viewport with side panels open and resets zoom when the iPad turns", (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { innerWidth: 1366, innerHeight: 1024, devicePixelRatio: 2 };
  globalThis.document = {
    createElement: () => ({ getContext: () => ({ translate() {}, rotate() {}, drawImage() {} }) }),
  };
  t.after(() => { globalThis.window = previousWindow; globalThis.document = previousDocument; });
  const { PfImageCanvas } = loadSource("features/image-viewer/pf-image-canvas.ts", {
    ...componentDependencies(),
    "@services/images/thumbnail-service": {},
    "@services/images/hd-image-cache": {},
    "@services/images/full-image-cache": {},
    "./canvas-state-adapter": { canvasState: { getPostProcess: () => ({}), cropEnabled: () => false } },
    "./canvas/decoder-bootstrap": {},
    "@features/editor/rendering/render-pipeline": { EditorRenderPipeline: class {} },
    "@features/editor/registry": {},
    "./canvas/crop-geometry": {},
    "./canvas/view-sizing": loadSource("features/image-viewer/canvas/view-sizing.ts", {}),
  });
  const viewer = new PfImageCanvas();
  viewer.autoRotate = true;
  viewer.bitmap = { width: 4000, height: 6000 };
  viewer.canvas = { width: 800, height: 1200, getBoundingClientRect: () => ({ width: 400, height: 600 }) };
  viewer.draw = () => {};
  viewer.onResize();
  assert.equal(viewer.effectiveSource().width, 6000);
  assert.equal(viewer.effectiveSource().height, 4000);
  viewer.userInteracted = true;
  viewer.scale = 3;
  viewer.offsetX = 100;
  viewer.offsetY = 200;
  window.innerWidth = 1024;
  window.innerHeight = 1366;
  viewer.onResize();
  assert.equal(viewer.effectiveSource().source, viewer.bitmap);
  assert.equal(viewer.scale, viewer.fitScale);
  assert.equal(viewer.offsetX, 0);
  assert.equal(viewer.offsetY, 0);
  viewer.editing = true;
  window.innerWidth = 1366;
  window.innerHeight = 1024;
  assert.equal(viewer.effectiveSource().source, viewer.bitmap);
});

test("iPad contain and cover fit every viewport orientation, including low resolution previews", () => {
  const { imageViewScale } = loadSource("features/image-viewer/canvas/view-sizing.ts", {});
  for (const [width, height] of [[1024, 1366], [1366, 1024], [768, 1024], [1024, 768]]) {
    for (const dpr of [1, 2, 3]) {
      const viewport = { width: width * dpr, height: height * dpr };
      for (const image of [{ width: 320, height: 213 }, { width: 213, height: 320 },
        { width: 6000, height: 4000 }, { width: 4000, height: 6000 }]) {
        const contain = imageViewScale("fit", image, viewport);
        const cover = imageViewScale("fill", image, viewport);
        const tolerance = 1e-6;
        assert.ok(image.width * contain <= viewport.width + tolerance);
        assert.ok(image.height * contain <= viewport.height + tolerance);
        assert.ok(Math.abs(image.width * contain - viewport.width) < tolerance ||
          Math.abs(image.height * contain - viewport.height) < tolerance);
        assert.ok(image.width * cover >= viewport.width - tolerance);
        assert.ok(image.height * cover >= viewport.height - tolerance);
      }
    }
  }
});

test("hybrid covers matching portrait and landscape shapes, and contains when cropping would be excessive", () => {
  const { imageViewScale } = loadSource("features/image-viewer/canvas/view-sizing.ts", {});
  for (const [image, viewport] of [
    [{ width: 3000, height: 2000 }, { width: 1366, height: 1024 }],
    [{ width: 2000, height: 3000 }, { width: 1024, height: 1366 }],
  ]) {
    assert.equal(imageViewScale("hybrid", image, viewport), imageViewScale("fill", image, viewport));
    const flipped = { width: viewport.height, height: viewport.width };
    assert.equal(imageViewScale("hybrid", image, flipped), imageViewScale("fit", image, flipped));
  }
});

test("bulk ratings and labels preserve other values, publish a complete selection, and persist every target", async () => {
  const calls = [];
  const domain = loadSource("domain/rating/types.ts", {});
  const store = loadService("rating/rating-store.ts", {
    "@tauri-apps/api/core": {
      invoke: async (_, args) => { calls.push(args); return 123; },
    },
    "@domain/rating": domain,
    "@domain/rating/shortcuts": { KEY_TO_LABEL: { 6: "green" } },
  });
  store.setPhotosLabels(["first"], "red");
  store.setPhotoStars("second", 2);
  await store.flushPhotoRatings();
  const snapshots = [];
  const unsubscribe = store.subscribePhotoRatings((path) => {
    snapshots.push({ path, first: store.getPhotoRating("first"), second: store.getPhotoRating("second") });
  });
  store.setPhotosStars(["first", "second", "first"], 4);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].path, "");
  assert.equal(snapshots[0].first.rating, 4);
  assert.equal(snapshots[0].second.rating, 4);
  assert.equal(store.getPhotoRating("first").label, "red");
  store.setPhotosLabels(["first", "second"], "blue");
  assert.equal(store.getPhotoRating("first").rating, 4);
  assert.equal(store.getPhotoRating("second").rating, 4);
  unsubscribe();
  await store.flushPhotoRatings();
  assert.deepEqual(calls.slice(2).map(({ path, rating, label }) => ({ path, rating, label })), [
    { path: "first", rating: 4, label: "red" },
    { path: "second", rating: 4, label: "" },
    { path: "first", rating: 4, label: "blue" },
    { path: "second", rating: 4, label: "blue" },
  ]);
  store.setPhotosLabels(["first"], "green");
  store.applyRatingShortcuts(["first", "second"], "6");
  assert.equal(store.getPhotoRating("first").label, "green");
  assert.equal(store.getPhotoRating("second").label, "green");
  store.applyRatingShortcuts(["first", "second"], "6");
  assert.equal(store.getPhotoRating("first").label, "");
  assert.equal(store.getPhotoRating("second").label, "");
  store.setPhotosStars(["first", "second"], 0);
  await store.flushPhotoRatings();
  assert.equal(store.getPhotoRating("first").rating, 0);
  assert.equal(store.getPhotoRating("second").rating, 0);
  assert.equal(calls.at(-1).label, "");
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("right panel applies mixed ratings and labels to the selection, clears shared values, and isolates full view", () => {
  const domain = loadSource("domain/rating/types.ts", {});
  const ratings = new Map([
    ["first", { rating: 4, label: "green" }],
    ["second", { rating: 2, label: "red" }],
    ["unselected", { rating: 5, label: "blue" }],
  ]);
  const ratingStore = {
    getPhotoRating: (path) => ratings.get(path),
    setPhotosStars: (paths, rating) => paths.forEach((path) => ratings.set(path, { ...ratings.get(path), rating })),
    setPhotosLabels: (paths, label) => paths.forEach((path) => ratings.set(path, { ...ratings.get(path), label })),
  };
  const { PfDetailPanel } = loadSource("app/detail-panel.ts", {
    lit: { LitElement: class {}, css: () => "", html: (strings, ...values) => ({ strings, values }) },
    "lit/decorators.js": { customElement: () => (target) => target, property: () => () => {}, state: () => () => {} },
    "@domain/photo": { fileForSelection: () => null },
    "@domain/exif": { buildExifSections: () => [] },
    "@domain/rating": domain,
    "@services/exif/exif-service": {},
    "@services/rating/rating-store": ratingStore,
    "@services/library/variant-store": {},
    "./views/full-view/variant-selector": { currentSelection: () => null },
    "../ui/controls/pf-icon-button": {},
    "@features/image-viewer/pf-image-canvas": {},
    "@features/image-viewer/pf-video-view": {},
    "@services/images/video-source": { isVideoPath: () => false },
  });
  const panel = new PfDetailPanel();
  panel.photo = { path: "first", filename: "First" };
  panel.selectionPaths = ["first", "second"];
  function buttons(template, marker) {
    if (Array.isArray(template)) return template.flatMap((child) => buttons(child, marker));
    if (!template?.strings) return [];
    if (template.strings.join("").includes(marker)) return [template];
    return template.values.flatMap((child) => buttons(child, marker));
  }
  function click(button) {
    button.values.find((value) => typeof value === "function")();
  }
  click(buttons(panel.render(), "★</button>")[3]);
  assert.equal(ratings.get("first").rating, 4);
  assert.equal(ratings.get("second").rating, 4);
  click(buttons(panel.render(), "★</button>")[3]);
  assert.equal(ratings.get("first").rating, 0);
  assert.equal(ratings.get("second").rating, 0);
  click(buttons(panel.render(), "aria-pressed=")[0]);
  assert.equal(ratings.get("first").label, "green");
  assert.equal(ratings.get("second").label, "green");
  click(buttons(panel.render(), "aria-pressed=")[0]);
  assert.equal(ratings.get("first").label, "");
  assert.equal(ratings.get("second").label, "");
  panel.fullViewOpen = true;
  click(buttons(panel.render(), "★</button>")[4]);
  assert.equal(ratings.get("first").rating, 5);
  assert.equal(ratings.get("second").rating, 0);
  assert.deepEqual(ratings.get("unselected"), { rating: 5, label: "blue" });
});

function thumbnailServices() {
  const calls = [];
  const requests = [];
  const invoke = (command, args) => {
    calls.push({ command, ...args });
    if (command !== "get_thumbnail") return Promise.resolve();
    const request = deferred();
    requests.push(request);
    return request.promise;
  };
  const tasks = loadService("tasks/task-manager.ts", { "@tauri-apps/api/core": { invoke } });
  const thumbnails = loadService("images/thumbnail-service.ts", {
    "@tauri-apps/api/core": { invoke },
    "./video-source": { isVideoPath: (path) => path.endsWith(".mov") },
    "@services/tasks/task-manager": tasks,
  });
  return { calls, requests, tasks, thumbnails };
}

test("shared thumbnails follow the highest live consumer priority", async () => {
  const { calls, requests, thumbnails } = thumbnailServices();
  const prefetch = thumbnails.requestThumbnail("photo.jpg", false, "normal");
  const visible = thumbnails.requestThumbnail("photo.jpg");
  const opened = thumbnails.requestThumbnail("photo.jpg", true);
  assert.equal(requests.length, 1);
  assert.deepEqual(calls.map((call) => call.priority), ["normal", "high", "urgent"]);
  visible.setPriority("normal");
  assert.equal(calls.length, 3);
  opened.cancel();
  assert.equal(calls.at(-1).priority, "normal");
  visible.setPriority("high");
  assert.equal(calls.at(-1).priority, "high");
  visible.cancel();
  assert.equal(calls.at(-1).priority, "normal");
  assert.equal(calls.some((call) => call.command === "cancel_image_request"), false);
  requests[0].resolve(new ArrayBuffer(8));
  await prefetch.promise;
  const count = calls.length;
  prefetch.cancel();
  assert.equal(calls.length, count);
  await thumbnails.requestThumbnail("photo.jpg").promise;
  assert.equal(requests.length, 1);
});

test("cancelled thumbnails cannot overwrite a replacement request's cache", async () => {
  const { calls, requests, thumbnails } = thumbnailServices();
  const stale = thumbnails.requestThumbnail("photo.jpg");
  stale.cancel();
  stale.cancel();
  assert.equal(calls.filter((call) => call.command === "cancel_image_request").length, 1);
  const replacement = thumbnails.requestThumbnail("photo.jpg");
  const freshBytes = new ArrayBuffer(12);
  requests[1].resolve(freshBytes);
  await replacement.promise;
  requests[0].resolve(new ArrayBuffer(4));
  await stale.promise;
  assert.equal(await thumbnails.requestThumbnail("photo.jpg").promise, freshBytes);
});

test("cached thumbnail URLs survive card reuse and stay alive until the last card releases them", async () => {
  const { requests, thumbnails } = thumbnailServices();
  const request = thumbnails.requestThumbnail("photo.jpg");
  const bytes = new ArrayBuffer(8);
  requests[0].resolve(bytes);
  await request.promise;
  assert.equal(thumbnails.getCachedThumbnail("photo.jpg"), bytes);
  const first = thumbnails.acquireThumbnailImage(bytes);
  first.release();
  const second = thumbnails.acquireThumbnailImage(bytes);
  assert.equal(second.url, first.url);
  const third = thumbnails.acquireThumbnailImage(bytes);
  const revoked = [];
  const revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
  try {
    thumbnails.dropAllThumbnailState();
    assert.equal(thumbnails.getCachedThumbnail("photo.jpg"), null);
    assert.equal(revoked.length, 0);
    second.release();
    assert.equal(revoked.length, 0);
    third.release();
    third.release();
    assert.deepEqual(revoked, [first.url]);
  } finally {
    URL.revokeObjectURL = revoke;
  }
});

test("auto rotate persists independently of sizing and migrates the old auto mode", async () => {
  let persisted = { sizing: "auto" };
  const preferences = loadService("view-state/view-state-service.ts", {
    "@tauri-apps/api/core": {
      invoke: async (command, args) => {
        if (command === "set_view_state") persisted = args.view;
        return persisted;
      },
    },
  });
  let view = await preferences.loadViewState();
  assert.equal(view.sizing, "fit");
  assert.equal(view.autoRotate, true);
  await preferences.saveViewState({ ...preferences.DEFAULT_VIEW_STATE, sizing: "hybrid", autoRotate: true });
  view = await preferences.loadViewState();
  assert.equal(view.sizing, "hybrid");
  assert.equal(view.autoRotate, true);
  await preferences.saveViewState({ ...view, sizing: "fill", autoRotate: false });
  view = await preferences.loadViewState();
  assert.equal(view.sizing, "fill");
  assert.equal(view.autoRotate, false);
});

test("thumbnail warmup skips videos and stops without cancelling visible consumers", async () => {
  const { calls, requests, thumbnails } = thumbnailServices();
  const stop = thumbnails.prefetchThumbnails(["clip.mov", "photo.jpg", "other.jpg"]);
  const visible = thumbnails.requestThumbnail("photo.jpg");
  stop();
  assert.equal(calls.some((call) => call.command === "cancel_image_request"), false);
  requests[0].resolve(new ArrayBuffer(4));
  await visible.promise;
  await Promise.resolve();
  assert.equal(requests.length, 1);
});

test("task changes publish one snapshot per microtask", async () => {
  const { tasks } = thumbnailServices();
  const snapshots = [];
  tasks.subscribeTasks((active) => snapshots.push(active));
  const first = tasks.beginTask({ kind: "thumbnail", label: "First", priority: "normal" });
  tasks.beginTask({ kind: "thumbnail", label: "Visible", priority: "high" });
  first.finish();
  assert.equal(snapshots.length, 1);
  await Promise.resolve();
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[1].map((task) => task.label), ["Visible"]);
});

test("metadata warmup starts immediately, reuses known metadata, and rejects stopped results", async () => {
  const requests = [];
  const warmed = [];
  const cancelled = [];
  let nextId = 1;
  const { PhotoProcessingPipeline } = loadService("library/photo-processing-pipeline.ts", {
    "@tauri-apps/api/core": {
      invoke: (_, args) => {
        const request = deferred();
        requests.push({ ...request, ...args });
        return request.promise;
      },
    },
    "@services/images/thumbnail-service": {
      prefetchThumbnails: (paths) => { warmed.push(paths); return () => {}; },
    },
    "@services/tasks/task-manager": {
      beginTask: () => ({ update() {}, finish() {} }),
      nextRequestId: () => nextId++,
      cancelTaskRequest: (id) => cancelled.push(id),
    },
  });
  const pipeline = new PhotoProcessingPipeline();
  const photos = [{ path: "known.jpg", filename: "known" }, { path: "new.jpg", filename: "new" }];
  pipeline.seed([{ path: "known.jpg", dateTaken: "2026-10-07" }]);
  const results = [];
  const start = () => pipeline.start(photos, (batch) => results.push(...batch),
    () => photos.map((photo) => photo.path), () => {});
  start();
  assert.deepEqual(warmed[0], ["known.jpg", "new.jpg"]);
  assert.deepEqual(requests[0].photoPaths, ["new.jpg"]);
  pipeline.stop();
  start();
  requests[0].resolve([{ path: "new.jpg", dateTaken: "2000-01-01" }]);
  await Promise.resolve();
  assert.deepEqual(cancelled, [requests[0].requestId]);
  assert.equal(results.length, 0);
  assert.equal(requests.length, 2);
  requests[1].resolve([{ path: "new.jpg", dateTaken: "2026-10-07" }]);
  await Promise.resolve();
  assert.deepEqual(pipeline.missingMetadataPaths(photos), []);
  assert.equal(results[0].dateTaken, "2026-10-07");
  start();
  assert.equal(requests.length, 2);
  pipeline.invalidate(["new.jpg"]);
  start();
  pipeline.invalidate(["new.jpg"]);
  requests[2].resolve([{ path: "new.jpg", dateTaken: "2000-01-01" }]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(requests.length, 4);
  assert.equal(results.length, 1);
  requests[3].resolve([{ path: "new.jpg", dateTaken: "2026-10-08" }]);
  await Promise.resolve();
  assert.equal(pipeline.enrich(photos)[1].filterInfo.dateTaken, "2026-10-08");
});

test("slow photo saves stay ordered, update the preview immediately, and preserve a final revert", async (t) => {
  const previousWindow = globalThis.window;
  const timers = new Map();
  let timerId = 0;
  globalThis.window = {
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  };
  t.after(() => { globalThis.window = previousWindow; });
  const calls = [];
  const requests = [];
  const store = loadService("edits/edits-store.ts", {
    "@tauri-apps/api/core": { invoke: (command, args) => {
      calls.push({ command, ...args });
      const request = deferred();
      requests.push(request);
      return request.promise;
    } },
    "@domain/edits": {
      isToneZero: (value) => !value || value.exposure === 0,
      isCurveZero: (value) => !value,
      isColorZero: (value) => !value,
      normalizeColor: (value) => value,
    },
  });
  const previews = [];
  store.subscribePhotoEdits((path) => previews.push(store.getPhotoEdit(path)?.tone?.exposure ?? 0));
  const settle = () => new Promise(setImmediate);
  store.setPhotoTone("photo", { exposure: 10 });
  assert.deepEqual(previews, [10]);
  assert.equal(calls.length, 0);
  const first = store.flushPhotoEdit("photo");
  await settle();
  store.setPhotoTone("photo", { exposure: 20 });
  const second = store.flushPhotoEdit("photo");
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(previews, [10, 20]);
  requests[0].resolve();
  await settle();
  assert.equal(calls[1].tone.exposure, 20);
  store.setPhotoTone("photo", null);
  const revert = store.flushPhotoEdit("photo");
  assert.deepEqual(previews, [10, 20, 0]);
  await settle();
  assert.equal(calls.length, 2);
  requests[1].resolve();
  await settle();
  assert.equal(calls[2].command, "clear_photo_edit");
  requests[2].resolve();
  await Promise.all([first, second, revert]);
  assert.equal(store.getPhotoEdit("photo"), null);
  assert.equal(timers.size, 0);
});

test("the editor keeps its HD texture through slider pauses and restores the original when closed", (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  t.after(() => { globalThis.document = previousDocument; });
  let invalidations = 0;
  const { PfImageCanvas } = loadSource("features/image-viewer/pf-image-canvas.ts", {
    ...componentDependencies(),
    "@services/images/thumbnail-service": {},
    "@services/images/hd-image-cache": {},
    "@services/images/full-image-cache": {},
    "./canvas-state-adapter": { canvasState: { getPostProcess: () => ({}), cropEnabled: () => false } },
    "./canvas/decoder-bootstrap": {},
    "@features/editor/rendering/render-pipeline": {
      EditorRenderPipeline: class { invalidate() { invalidations++; } },
    },
    "@features/editor/registry": {},
    "./canvas/crop-geometry": {},
    "./canvas/view-sizing": {},
  });
  const viewer = new PfImageCanvas();
  viewer.path = "photo";
  viewer.enableFullRes = true;
  viewer.bitmap = { width: 1920, height: 1280 };
  viewer.fullBitmap = { width: 6000, height: 4000 };
  viewer.fullBitmapForPath = "photo";
  assert.equal(viewer.currentBitmap, viewer.fullBitmap);
  viewer.editing = true;
  for (let tick = 0; tick < 120; tick++) {
    viewer.markEditingActive();
    assert.equal(viewer.effectiveSource().source, viewer.bitmap);
  }
  assert.equal(invalidations, 0);
  assert.equal(viewer.editSettleTimer, null);
  viewer.editing = false;
  assert.equal(viewer.currentBitmap, viewer.fullBitmap);
});

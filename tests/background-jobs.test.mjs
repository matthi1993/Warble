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

function clarityFixture() {
  const domain = loadSource("domain/edits/effects.ts", {});
  const { clarityShader } = loadSource("features/editor/tools/clarity/clarity.shader.ts", { "@domain/edits": domain });
  return { domain, clarityShader };
}

function analogFixture() {
  const domain = loadSource("domain/edits/effects.ts", {});
  const shader = loadSource("features/editor/tools/analog/analog.shader.ts", { "@domain/edits": domain });
  return { domain, ...shader };
}

test("removed Clarity and Analog controls are dropped from saved values and amounts default safely", () => {
  const { domain, analogShader } = analogFixture();
  assert.deepEqual(domain.normalizeClarity({ clarity: 25, structure: -20, scale: 90, noiseProtection: 100, haloProtection: 100 }),
    { clarity: 25, structure: -20 });
  assert.deepEqual(domain.normalizeAnalog({ dust: 45, vignette: -20, halation: 1000, scratches: 70, vignetteBlur: 90, extra: 30 }),
    { vignette: 0, halation: 100, chromaticAberration: 0 });
  assert.equal(analogShader.isActive(domain.normalizeAnalog({ dust: 80, scratches: 70 })), false);
  assert.equal(analogShader.isActive(domain.defaultAnalog()), false);
  for (const key of Object.keys(domain.defaultAnalog())) {
    assert.equal(analogShader.isActive({ ...domain.defaultAnalog(), [key]: 20 }), true);
  }
});

test("Analog effects persist per photo, preserve other effects, and can be cleared independently", async (t) => {
  const { domain } = analogFixture();
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
  globalThis.localStorage = { getItem: () => null };
  t.after(() => { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; });
  let persisted = JSON.stringify({ first: { analog: { vignette: 35 }, clarity: { clarity: 20, scale: 90 } } });
  const store = loadService("effects/effects-store.ts", {
    "@domain/edits": domain,
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      if (command === "get_photo_effects") return persisted;
      assert.equal(command, "set_photo_effects");
      persisted = args.effectsJson;
    } },
  });
  await store.loadPhotoEffects();
  assert.deepEqual(store.getPhotoClarity("first"), { clarity: 20, structure: 0 });
  assert.deepEqual(store.getPhotoAnalog("first"), { ...domain.defaultAnalog(), vignette: 35 });
  const value = { ...domain.defaultAnalog(), halation: 40, chromaticAberration: 60 };
  store.setPhotoAnalog("second", value);
  value.halation = 99;
  assert.equal(store.getPhotoAnalog("second").halation, 40);
  await store.flushPhotoEffects();
  await store.reloadPhotoEffects();
  assert.equal(store.hasEffects("second"), true);
  assert.equal(store.getPhotoAnalog("second").chromaticAberration, 60);
  store.setPhotoAnalog("first", null);
  assert.equal(store.getPhotoClarity("first").clarity, 20);
  store.setPhotoAnalog("second", null);
  assert.equal(store.hasEffects("second"), false);
  await store.flushPhotoEffects();
  assert.equal(JSON.parse(persisted).second, undefined);
});

test("Analog runs after all edits, samples the edited targets, reuses them, and releases them when disabled", (t) => {
  const { domain, ...shader } = analogFixture();
  const { AnalogRenderPass } = loadSource("features/editor/rendering/analog-render-pass.ts", {
    "@domain/edits": domain, "../tools/analog/analog.shader": shader,
  });
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0 }) };
  t.after(() => { globalThis.document = previousDocument; });
  let nextId = 0;
  const handle = () => ({ id: ++nextId });
  let framebuffer = null;
  let program = null;
  let activeUnit = 0;
  const bound = new Map();
  const uniforms = new Map();
  const draws = [];
  const uploads = [];
  const deletedTextures = [];
  const deletedFramebuffers = [];
  const mipmaps = [];
  const gl = new Proxy({
    TEXTURE0: 0, TEXTURE1: 1,
    createShader: handle, shaderSource() {}, compileShader() {}, getShaderParameter: () => true, deleteShader() {},
    createProgram: handle, attachShader() {}, linkProgram() {}, getProgramParameter: () => true, deleteProgram() {},
    createVertexArray: handle, bindVertexArray() {}, deleteVertexArray() {},
    createBuffer: handle, bindBuffer() {}, bufferData() {}, deleteBuffer() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    createTexture: handle, texParameteri() {}, pixelStorei() {}, generateMipmap: () => mipmaps.push(bound.get(activeUnit)),
    activeTexture: unit => { activeUnit = unit; },
    bindTexture: (_, texture) => bound.set(activeUnit, texture),
    texImage2D: (...args) => uploads.push({ texture: bound.get(activeUnit), data: args.at(-1) }),
    deleteTexture: texture => deletedTextures.push(texture),
    createFramebuffer: handle,
    bindFramebuffer: (_, target) => { framebuffer = target; },
    framebufferTexture2D() {}, checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE",
    deleteFramebuffer: target => deletedFramebuffers.push(target),
    viewport() {}, useProgram: value => { program = value; },
    getUniformLocation: (_, name) => name,
    uniform1f: (name, value) => uniforms.set(name, value),
    uniform1i: (name, value) => uniforms.set(name, value),
    uniform1ui: (name, value) => uniforms.set(name, value),
    uniform2f: (name, ...values) => uniforms.set(name, values),
    drawArrays: () => draws.push({ framebuffer, texture: bound.get(0), program, uniforms: new Map(uniforms) }),
  }, { get: (target, key) => key in target ? target[key] : key });
  const { EditorRenderPipeline } = loadSource("features/editor/rendering/render-pipeline.ts", {
    "@domain/edits": domain,
    "./shader-composer": { TOOL_SHADER_MODULES: [] },
    "../tools/grain/grain.shader": {}, "./analog-render-pass": { AnalogRenderPass },
  });
  const pipeline = new EditorRenderPipeline();
  pipeline.gl = gl;
  pipeline.program = { editor: true };
  const source = { width: 2400, height: 1600 };
  const values = { photo: { analog: { ...domain.defaultAnalog(), vignette: 40 }, color: { blackAndWhite: true } },
    post: { analog: { ...domain.defaultAnalog(), halation: 50 } } };
  const render = () => pipeline.render(source, values, { sx: 600, sy: 400, sw: 1200, sh: 800 }, 600, 400);
  render();
  assert.equal(draws.length, 3);
  assert.equal(draws[0].program, pipeline.program);
  assert.ok(draws[0].framebuffer);
  assert.ok(draws[1].framebuffer);
  assert.notEqual(draws[0].framebuffer, draws[1].framebuffer);
  assert.equal(draws[2].framebuffer, null);
  assert.notEqual(draws[1].texture, draws[0].texture);
  assert.notEqual(draws[2].texture, draws[1].texture);
  assert.equal(draws[1].uniforms.get("u_vignette"), 0.4);
  assert.equal(draws[2].uniforms.get("u_halation"), 0.5);
  assert.equal(draws[2].uniforms.get("u_vignette"), 0);
  assert.equal(draws[2].uniforms.get("u_monochrome"), 1);
  assert.deepEqual(draws[2].uniforms.get("u_srcOffset"), [0.25, 0.25]);
  assert.deepEqual(draws[2].uniforms.get("u_srcScale"), [0.5, 0.5]);
  assert.equal(uploads.length, 3);
  assert.deepEqual(mipmaps, [draws[0].texture, draws[2].texture]);
  render();
  assert.equal(uploads.length, 3);
  values.photo.analog = domain.defaultAnalog();
  values.post.analog = domain.defaultAnalog();
  const before = draws.length;
  render();
  assert.equal(draws.length, before + 1);
  assert.equal(draws.at(-1).framebuffer, null);
  assert.equal(deletedFramebuffers.length, 2);
  assert.equal(deletedTextures.length, 2);
  pipeline.invalidate();
  assert.equal(deletedTextures.length, 3);
  pipeline.dispose();
});

test("clarity protects noise and strong edges, preserves monochrome and cannot clip color channels", () => {
  const { clarityShader, domain } = clarityFixture();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = (min, max, value) => {
    const t = clamp((value - min) / (max - min), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const detailBody = clarityShader.functions.match(/float clarityDetail\([^)]*\)\s*\{([^}]+)\}/)[1];
  const detail = new Function("difference", "haloProtection", "noiseProtection", "smoothstep",
    detailBody.replace(/\bfloat\s+/g, "let ").replace(/\babs\(/g, "Math.abs("));
  const unprotected = detail(0.25, 0, 0, smoothstep);
  assert.ok(unprotected > 0);
  assert.ok(detail(0.25, 1, 0, smoothstep) < unprotected);
  assert.ok(detail(0.002, 0, 1, smoothstep) < detail(0.002, 0, 0, smoothstep));
  assert.equal(detail(0, 0.6, 0.2, smoothstep), 0);
  assert.equal(detail(-0.1, 0.6, 0.2, smoothstep), -detail(0.1, 0.6, 0.2, smoothstep));

  const blendBody = clarityShader.functions.match(/vec3 clarityBlend\([^)]*\)\s*\{([^}]+)\}/)[1];
  const blend = new Function("current", "delta", "smoothstep", "clamp", blendBody
    .replace(/\bfloat\s+/g, "let ")
    .replace("dot(current, LUMA)", "(current[0] * 0.2126 + current[1] * 0.7152 + current[2] * 0.0722)")
    .replace(/current\.([rgb])/g, (_, channel) => `current[${"rgb".indexOf(channel)}]`)
    .replace(/\bmin\(/g, "Math.min(").replace(/\bmax\(/g, "Math.max(")
    .replace("return current + vec3(protectedDelta);", "return current.map(channel => channel + protectedDelta);"));
  const apply = (rgb, delta) => blend(rgb, delta, smoothstep, clamp);
  assert.deepEqual(apply([0.5, 0.5, 0.5], 0), [0.5, 0.5, 0.5]);
  assert.ok(apply([0.5, 0.5, 0.5], 0.1)[0] > 0.5);
  assert.ok(apply([0.5, 0.5, 0.5], -0.1)[0] < 0.5);
  for (const rgb of [[0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [0.9, 0.2, 0.1]]) {
    for (const delta of [-2, -0.1, 0, 0.1, 2]) {
      const result = apply(rgb, delta);
      assert.ok(result.every(channel => channel >= 0 && channel <= 1));
      if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) assert.equal(new Set(result).size, 1);
    }
  }
  assert.deepEqual(apply([0, 0, 0], 1), [0, 0, 0]);
  assert.deepEqual(apply([1, 1, 1], -1), [1, 1, 1]);
  assert.equal(clarityShader.isActive(domain.defaultClarity()), false);
  assert.equal(clarityShader.isActive({ ...domain.defaultClarity(), structure: -50 }), true);
  assert.equal(clarityShader.isActive({ ...domain.defaultClarity(), clarity: 40 }), true);

  const uniforms = new Map();
  clarityShader.bind({
    sourceScaleX: 0.5, sourceScaleY: 0.5, outputWidth: 1200, outputHeight: 800,
    set1f: (name, value) => uniforms.set(name, value),
    set2f: (name, ...values) => uniforms.set(name, values),
  }, { ...domain.defaultClarity(), structure: -50 }, undefined);
  assert.equal(uniforms.get("u_editStructure"), -0.5);
  assert.equal(uniforms.get("u_postStructure"), 0);
  assert.deepEqual(uniforms.get("u_clarityStep"), [0.5 / 1200, 0.5 / 800]);
});

test("clarity-only photo effects persist, survive other effect resets and reload with defaults for older data", async (t) => {
  const { domain } = clarityFixture();
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
  globalThis.localStorage = { getItem: () => null };
  t.after(() => { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; });
  let persisted = JSON.stringify({ old: { grain: { amount: 20 } }, photo: { clarity: { clarity: 40 } } });
  const store = loadService("effects/effects-store.ts", {
    "@domain/edits": domain,
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      if (command === "get_photo_effects") return persisted;
      assert.equal(command, "set_photo_effects");
      persisted = args.effectsJson;
    } },
  });
  await store.loadPhotoEffects();
  assert.equal(store.getPhotoClarity("old"), null);
  assert.deepEqual(store.getPhotoGrain("old"), { ...domain.defaultGrain(), amount: 20 });
  assert.deepEqual(store.getPhotoClarity("photo"), { ...domain.defaultClarity(), clarity: 40 });
  store.setPhotoClarity("new", { ...domain.defaultClarity(), structure: -25 });
  store.setPhotoSharpen("new", domain.defaultSharpen());
  store.setPhotoSharpen("new", null);
  assert.equal(store.hasEffects("new"), true);
  await store.flushPhotoEffects();
  assert.equal(JSON.parse(persisted).new.clarity.structure, -25);
  await store.reloadPhotoEffects();
  assert.equal(store.getPhotoClarity("new").structure, -25);
  store.setPhotoClarity("new", null);
  assert.equal(store.hasEffects("new"), false);
  assert.equal(store.getPhotoEffects("new"), null);
  store.setPhotoClarity("old", domain.defaultClarity());
  store.setPhotoClarity("old", null);
  assert.equal(store.getPhotoGrain("old").amount, 20);
  await store.flushPhotoEffects();
  assert.equal(JSON.parse(persisted).new, undefined);
});

test("clarity and Analog persist in Post settings and presets while older presets stay neutral", async (t) => {
  const { domain } = clarityFixture();
  const previousStorage = globalThis.localStorage;
  const storage = new Map([["warble.postProcess.v4", JSON.stringify({ enabled: false })]]);
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  t.after(() => { globalThis.localStorage = previousStorage; });
  const edits = {
    ...domain, defaultTone: () => ({}), defaultColor: () => ({}), defaultCurve: () => ({}), normalizeColor: value => value,
  };
  const store = loadService("post-process/post-process-store.ts", {
    "@domain/edits": edits, "@services/effects/effects-store": domain,
  });
  assert.deepEqual(store.getPostProcess().clarity, domain.defaultClarity());
  assert.deepEqual(store.getPostProcess().analog, domain.defaultAnalog());
  store.setPostClarity({ ...domain.defaultClarity(), clarity: 35, structure: 20 });
  store.setPostAnalog({ ...domain.defaultAnalog(), vignette: 65, halation: 25 });
  assert.equal(JSON.parse(storage.get("warble.postProcess.v4")).clarity.clarity, 35);
  assert.equal(JSON.parse(storage.get("warble.postProcess.v4")).analog.vignette, 65);
  const presets = loadService("post-process/post-process-presets-store.ts", {
    "./post-process-store": store, "@domain/edits": edits,
    "@tauri-apps/api/core": { invoke: async (command) => command === "get_post_process_presets" ? null : undefined },
  });
  await presets.loadPostProcessPresets();
  const saved = presets.savePostProcessPreset("Texture", store.getPostProcess());
  store.resetPostClarity();
  store.resetPostAnalog();
  assert.equal(saved.values.clarity.clarity, 35);
  assert.deepEqual(store.getPostProcess().clarity, domain.defaultClarity());
  assert.equal(JSON.parse(presets.exportPostProcessPresets()).postProcess[0].values.clarity.structure, 20);
  assert.equal(JSON.parse(presets.exportPostProcessPresets()).postProcess[0].values.analog.halation, 25);
  const restored = presets.settingsFromPostProcessPreset(saved, store.getPostProcess());
  store.setPostProcess(restored);
  assert.equal(store.getPostProcess().clarity.structure, 20);
  assert.equal(store.getPostProcess().analog.vignette, 65);
  assert.equal(presets.importPostProcessPresets(JSON.stringify([{ name: "Legacy", values: { tone: {} } }])), 1);
  assert.deepEqual(presets.getPostProcessPresets().at(-1).values.clarity, domain.defaultClarity());
  assert.deepEqual(presets.getPostProcessPresets().at(-1).values.analog, domain.defaultAnalog());
});

test("clarity supports photo copy, paste, reset and independent Post reset", () => {
  const { domain } = clarityFixture();
  const { ClarityTool, readClarityToolValue } = loadSource("features/editor/tools/clarity/clarity.logic.ts", {
    lit: componentDependencies().lit,
    "@domain/edits": domain,
    "../../tool": loadSource("features/editor/tool.ts", {}),
    "./clarity.ui": {},
  });
  const photos = new Map([["first", { ...domain.defaultClarity(), clarity: 30 }]]);
  let post = { ...domain.defaultClarity(), structure: 15 };
  const state = {
    getPhotoClarity: path => photos.get(path) ?? null,
    setPhotoClarity: (path, value) => value ? photos.set(path, value) : photos.delete(path),
    getPostProcess: () => ({ clarity: post }),
    resetPostClarity: () => { post = domain.defaultClarity(); },
  };
  const tool = new ClarityTool("photo", state);
  const host = { editTarget: "second", requestUpdate() {} };
  const copy = tool.serializeEdit("first");
  tool.applyEdit(host, copy);
  copy.clarity = 90;
  assert.equal(tool.hasEdits("second"), true);
  assert.equal(readClarityToolValue("photo", "second", state).clarity, 30);
  tool.reset(host);
  assert.equal(tool.hasEdits("second"), false);
  assert.equal(photos.get("first").clarity, 30);
  assert.equal(readClarityToolValue("post", "second", state).structure, 15);
  new ClarityTool("post", state).reset(host);
  assert.deepEqual(post, domain.defaultClarity());
});

test("Clarity follows Dynamic Range and Analog is last in both scopes, with independent effect toggles", () => {
  const { domain, clarityShader } = clarityFixture();
  const clarityLogic = loadSource("features/editor/tools/clarity/clarity.logic.ts", {
    lit: componentDependencies().lit, "@domain/edits": domain,
    "../../tool": loadSource("features/editor/tool.ts", {}), "./clarity.ui": {},
  });
  const dependencies = {
    "@domain/edits": { defaultTone: () => ({}) },
    "./tools/clarity/clarity.logic": clarityLogic,
    "./tools/clarity/clarity.shader": { clarityShader },
    "./tools/analog/analog.shader": analogFixture(),
    "./tools/analog/analog.logic": loadSource("features/editor/tools/analog/analog.logic.ts", {
      lit: componentDependencies().lit, "@domain/edits": domain,
      "../../tool": loadSource("features/editor/tool.ts", {}), "./analog.ui": {},
    }),
  };
  for (const id of ["crop", "tone", "color", "curve", "sharpen", "grain", "bloom"]) {
    const name = id[0].toUpperCase() + id.slice(1);
    dependencies[`./tools/${id}/${id}.logic`] = {
      [`${name}Tool`]: class { constructor() { this.id = id; } },
      [`read${name}ToolValue`]: () => null,
    };
    dependencies[`./tools/${id}/${id}.shader`] = { [`${id}Shader`]: { id, isActive: () => false } };
  }
  const registry = loadSource("features/editor/registry.ts", dependencies);
  const disabled = new Set();
  const value = { ...domain.defaultClarity(), clarity: 40 };
  const analog = { ...domain.defaultAnalog(), vignette: 40 };
  const state = {
    isEffectEnabled: (scope, path, id) => !disabled.has(`${scope}:${id}`),
    getPhotoClarity: () => value, getPhotoAnalog: () => analog,
    getPostProcess: () => ({ clarity: value, analog }),
  };
  for (const scope of ["photo", "post"]) {
    const tools = registry.createEditorTools(scope, state);
    assert.equal(tools.findIndex(tool => tool.id === "clarity"), tools.findIndex(tool => tool.id === "tone") + 1);
    assert.equal(tools.at(-1).id, "analog");
    const values = registry.readEditorToolValues(scope, "photo", state);
    assert.equal(values.clarity, value);
    assert.equal(values.analog, analog);
    assert.equal(registry.hasActiveEditorToolValues(values), true);
    disabled.add(`${scope}:clarity`);
    assert.equal(registry.readEditorToolValues(scope, "photo", state).clarity, undefined);
    disabled.add(`${scope}:analog`);
    assert.equal(registry.readEditorToolValues(scope, "photo", state).analog, undefined);
  }
  disabled.add("photo:all");
  assert.deepEqual(registry.readEditorToolValues("photo", "photo", state), {});
  const composer = loadSource("features/editor/rendering/shader-composer.ts", { "../registry": registry });
  assert.match(composer.composeToolStage("photo"), /toolApplyClarity\(color, u_editClarity/);
  assert.match(composer.composeToolStage("post"), /toolApplyClarity\(color, u_postClarity/);
});

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

function imageViewer(t, dependencies = {}) {
  const previousWindow = globalThis.window;
  const previousRaf = globalThis.requestAnimationFrame;
  const timers = new Map();
  const delays = new Map();
  let timerId = 0;
  globalThis.window = {
    setTimeout: (callback, delay) => { timers.set(++timerId, callback); delays.set(timerId, delay); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  };
  globalThis.requestAnimationFrame = () => 0;
  t.after(() => { globalThis.window = previousWindow; globalThis.requestAnimationFrame = previousRaf; });
  const { PfImageCanvas } = loadSource("features/image-viewer/pf-image-canvas.ts", {
    ...componentDependencies(),
    "@services/images/thumbnail-service": {},
    "@services/images/hd-image-cache": {},
    "@services/images/full-image-cache": {},
    "./canvas-state-adapter": { canvasState: { getPostProcess: () => ({}), cropEnabled: () => false } },
    "./canvas/decoder-bootstrap": {},
    "@features/editor/rendering/render-pipeline": { EditorRenderPipeline: class { invalidate() {} } },
    "@features/editor/registry": {},
    "./canvas/crop-geometry": {},
    "./canvas/view-sizing": {},
    ...dependencies,
  });
  const viewer = new PfImageCanvas();
  viewer.recomputeFit = () => {};
  viewer.scheduleDraw = () => {};
  viewer.draw = () => {};
  viewer.warmupTonePipeline = () => {};
  const runTimer = (id) => {
    const callback = timers.get(id);
    assert.ok(callback, "expected a pending timer");
    timers.delete(id);
    callback();
  };
  return { viewer, timers, delays, runTimer };
}

test("editing preserves the full-resolution source and viewport throughout slider changes", (t) => {
  const { viewer, timers, runTimer } = imageViewer(t);
  viewer.path = "photo";
  viewer.editing = true;
  viewer.bitmap = { width: 1920, height: 1280 };
  viewer.fullBitmap = { width: 6000, height: 4000 };
  viewer.fullBitmapForPath = "photo";
  viewer.userInteracted = true;
  viewer.scale = 1;
  assert.equal(viewer.currentBitmap, viewer.fullBitmap);
  for (let tick = 0; tick < 120; tick++) {
    viewer.markEditingActive();
    assert.equal(viewer.effectiveSource().source, viewer.fullBitmap);
    assert.equal(timers.size, 1);
  }
  assert.equal(viewer.scale, 1);
  runTimer(viewer.editSettleTimer);
  assert.equal(viewer.currentBitmap, viewer.fullBitmap);
  assert.equal(viewer.scale, 1);
  assert.equal(viewer.editing, true);
});

test("turning full resolution on loads the current photo and turning it off cancels the upgrade", async (t) => {
  const pending = deferred();
  const requests = [];
  const { viewer, timers, runTimer } = imageViewer(t, {
    "@services/images/full-image-cache": {
      getFullImage: () => null,
      loadFullImage: (path, options) => { requests.push({ path, ...options }); return pending.promise; },
    },
  });
  viewer.path = "photo";
  viewer.loadAbort = new AbortController();
  viewer.enableFullRes = false;
  viewer.willUpdate(new Map([["enableFullRes", true]]));
  assert.equal(timers.size, 0);
  viewer.enableFullRes = true;
  viewer.willUpdate(new Map([["enableFullRes", false]]));
  runTimer(viewer.fullLoadTimer);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "photo");
  viewer.enableFullRes = false;
  viewer.willUpdate(new Map([["enableFullRes", true]]));
  assert.equal(requests[0].signal.aborted, true);
  const staleBitmap = { width: 6000, height: 4000 };
  pending.resolve(staleBitmap);
  await new Promise(setImmediate);
  assert.equal(viewer.fullBitmap, null);
  assert.equal(viewer.fullLoading, false);
  viewer.enableFullRes = true;
  viewer.willUpdate(new Map([["enableFullRes", false]]));
  assert.equal(timers.size, 1);
});

test("navigating after an edit clears its preview state and upgrades the next photo", async (t) => {
  const hd = { width: 1920, height: 1280 };
  const full = { width: 6000, height: 4000 };
  const { viewer, timers, runTimer } = imageViewer(t, {
    "@services/images/hd-image-cache": { getHdImage: () => hd },
    "@services/images/full-image-cache": { getFullImage: () => full },
  });
  viewer.path = "first";
  viewer.editing = true;
  viewer.markEditingActive();
  const oldSettleTimer = viewer.editSettleTimer;
  viewer.path = "second";
  await viewer.startLoad();
  assert.equal(timers.has(oldSettleTimer), false);
  assert.equal(viewer.editingActive, false);
  assert.equal(viewer.currentBitmap, hd);
  runTimer(viewer.fullLoadTimer);
  assert.equal(viewer.currentBitmap, full);
  assert.equal(viewer.fullBitmapForPath, "second");
  assert.equal(viewer.fullLoading, false);
});

function imageCache(path) {
  const requests = [];
  const cancelled = [];
  const priorities = [];
  let nextId = 0;
  const cache = loadService(`images/${path}-image-cache.ts`, {
    "@tauri-apps/api/core": { invoke: (_, args) => {
      const request = deferred();
      requests.push({ ...request, ...args });
      return request.promise;
    } },
    "@tauri-apps/api/event": {},
    "@services/tasks/task-manager": {
      beginTask: () => ({ finish() {}, update() {} }),
      nextRequestId: () => ++nextId,
      cancelTaskRequest: (id) => cancelled.push(id),
      setTaskRequestPriority: (id, priority) => priorities.push({ id, priority }),
      isTaskCancellation: (error) => error.name === "AbortError",
    },
  });
  return { cache, requests, cancelled, priorities };
}

test("a cancelled full-resolution decode cannot evict the active photo or replace a newer result", async () => {
  const { cache, requests, cancelled } = imageCache("full");
  const staleDecode = deferred();
  const staleBytes = new ArrayBuffer(1);
  cache.setFullImageDecoder((bytes) => bytes === staleBytes ? staleDecode.promise : Promise.resolve(bytes));
  const abort = new AbortController();
  const stale = cache.loadFullImage("first", { signal: abort.signal });
  requests[0].resolve(staleBytes);
  await Promise.resolve();
  abort.abort();
  await assert.rejects(stale, { name: "AbortError" });
  assert.equal(cancelled.length, 1);
  const activeBitmap = { width: 6000, height: 4000, closed: false, close() { this.closed = true; } };
  const active = cache.loadFullImage("second");
  requests[1].resolve(activeBitmap);
  await active;
  const staleBitmap = { closed: false, close() { this.closed = true; } };
  staleDecode.resolve(staleBitmap);
  await new Promise(setImmediate);
  assert.equal(staleBitmap.closed, true);
  assert.equal(activeBitmap.closed, false);
  assert.equal(cache.getFullImage("second"), activeBitmap);
  assert.equal(cache.getFullImage("first"), null);
});

test("HD requests for separate viewers do not cancel each other", async () => {
  const { cache, requests, cancelled } = imageCache("hd");
  cache.setHdImageDecoder(async (bitmap) => bitmap);
  const first = cache.loadHdImage("first");
  const second = cache.loadHdImage("second");
  const firstBitmap = { width: 1920, height: 1280 };
  const secondBitmap = { width: 1280, height: 1920 };
  requests[0].resolve(firstBitmap);
  requests[1].resolve(secondBitmap);
  assert.deepEqual(await Promise.all([first, second]), [firstBitmap, secondBitmap]);
  assert.deepEqual(cancelled, []);
});

test("bloom survives Tone and runs once before photo and Post color adjustments, including both black-and-white conversions", () => {
  const config = loadSource("domain/edits/adjustment-config.ts", {});
  const glsl = loadSource("features/editor/rendering/glsl.ts", {});
  const { toneShader } = loadSource("features/editor/tools/tone/tone.shader.ts", {
    "../../rendering/glsl": glsl,
    "@domain/edits": { ...config, defaultTone: () => ({}), isToneZero: () => true },
  });
  const { bloomShader } = loadSource("features/editor/tools/bloom/bloom.shader.ts", {
    "@domain/edits": { defaultBloom: () => ({ threshold: 70, radius: 30, softness: 50, spread: 50 }) },
  });
  const { colorShader } = loadSource("features/editor/tools/color/color.shader.ts", {
    "../../rendering/glsl": glsl,
    "@domain/edits": config,
  });
  const composer = loadSource("features/editor/rendering/shader-composer.ts", {
    "../registry": { EDITOR_TOOLS: [{ shader: toneShader }, { shader: colorShader }, { shader: bloomShader }] },
  });
  const { EditorRenderPipeline } = loadSource("features/editor/rendering/render-pipeline.ts", {
    "@domain/edits": loadSource("domain/edits/effects.ts", {}),
    "./shader-composer": composer,
    "../tools/grain/grain.shader": {},
    "./analog-render-pass": {},
  });
  const shader = EditorRenderPipeline.prototype.fragmentSource();
  const main = shader.slice(shader.indexOf("void main()"));
  const bloom = main.indexOf("color = toolApplyBloom(color)");
  assert.ok(bloom >= 0);
  assert.equal(main.match(/toolApplyBloom\(color\)/g).length, 1);
  const applyPhotoTone = new Function("color", "toolApplyTone",
    `${toneShader.photoApply.replace(/\bu_\w+/g, "0")} return color;`);
  const bloomedPixel = [0.35, 0.25, 0.15];
  assert.equal(applyPhotoTone(bloomedPixel, (pixel) => pixel), bloomedPixel);
  assert.ok(main.indexOf("color = toolApplyTone(") > bloom);
  for (const operation of ["u_editColorEnabled", "u_editBlackAndWhite", "u_postColorEnabled", "u_postBlackAndWhite"]) {
    assert.ok(main.indexOf(operation) > bloom, `${operation} must process the bloomed image`);
  }
  assert.match(composer.composeToolStage("source"), /if \(u_bloomStrength > 0\.0\)/);
  const strengths = [];
  const context = {
    sourceScaleX: 1, sourceScaleY: 1, outputWidth: 1200, outputHeight: 800,
    set1f: (name, value) => { if (name === "u_bloomStrength") strengths.push(value); }, set2f() {},
  };
  bloomShader.bind(context, undefined, { strength: 65 });
  bloomShader.bind(context, undefined, undefined);
  assert.deepEqual(strengths, [65, 0]);
});

test("shadow lifts keep near-black color noise subdued and preserve luminance and normal colors", () => {
  const config = loadSource("domain/edits/adjustment-config.ts", {});
  const { toneShader } = loadSource("features/editor/tools/tone/tone.shader.ts", {
    "../../rendering/glsl": loadSource("features/editor/rendering/glsl.ts", {}),
    "@domain/edits": { ...config, defaultTone: () => ({}), isToneZero: () => true },
  });
  const body = toneShader.functions.match(/vec3 toolRemapToneLuma\([^)]*\)\s*\{([^}]+)\}/)?.[1];
  assert.ok(body);
  const remapChannel = new Function("col", "sourceLuma", "targetLuma", body
    .replace(/\bfloat\s+/g, "let ")
    .replace(/\bvec3\(/g, "(")
    .replace(/\bmax\(/g, "Math.max("));
  const luma = (rgb) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  const remap = (rgb, target) => rgb.map((channel) => remapChannel(channel, luma(rgb), target));
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10,
    `expected ${actual} to be close to ${expected}`);

  for (const target of [0.12, 0.22, 0.34]) {
    assert.deepEqual(remap([0, 0, 0], target), [target, target, target]);
    for (const pixel of [[1 / 255, 0, 0], [0, 1 / 255, 0], [0, 0, 1 / 255],
      [1 / 255, 0, 2 / 255], [0.01, 0.01, 0.01]]) {
      const lifted = remap(pixel, target);
      near(luma(lifted), target);
      assert.ok(Math.max(...lifted) - Math.min(...lifted) < 0.06);
      assert.ok(lifted.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1));
    }
  }
  for (const pixel of [[0.2, 0.1, 0.05], [0.05, 0.1, 0.3], [0.1, 0.2, 0.1]]) {
    for (const target of [0, luma(pixel) / 2, luma(pixel), luma(pixel) + 0.22]) {
      const adjusted = remap(pixel, target);
      pixel.forEach((channel, index) => near(adjusted[index], channel * target / luma(pixel)));
    }
  }
  for (const pixel of [[0, 0, 0], [1e-8, 0, 0], [0, 0, 1e-8]]) {
    remap(pixel, luma(pixel)).forEach((channel, index) => near(channel, pixel[index]));
  }
  const liftedTwice = remap(remap([0, 0, 1 / 255], 0.22), 0.44);
  near(luma(liftedTwice), 0.44);
  assert.ok(Math.max(...liftedTwice) - Math.min(...liftedTwice) < 0.04);
});


test("sliders leave native capture alone and finish once when released outside the control", () => {
  const { PfSlider } = loadSource("ui/controls/pf-slider.ts", componentDependencies());
  const slider = new PfSlider();
  const ownerDocument = new EventTarget();
  ownerDocument.defaultView = new EventTarget();
  slider.ownerDocument = ownerDocument;
  const events = [];
  for (const type of ["slider-interaction-start", "change", "slider-interaction-end"]) {
    slider.addEventListener(type, (event) => events.push(event));
  }
  const pointer = { button: 0, pointerId: 7, currentTarget: {
    setPointerCapture() { assert.fail("native range inputs must own their pointer capture"); },
  } };
  const release = (type, pointerId = 7) => {
    const event = new Event(type);
    event.pointerId = pointerId;
    ownerDocument.dispatchEvent(event);
  };
  slider.onPointerDown(pointer);
  slider.onInput({ target: { value: "35" } });
  release("pointerup", 8);
  assert.deepEqual(events.map((event) => event.type), ["slider-interaction-start", "change"]);
  release("pointerup");
  release("pointerup");
  assert.deepEqual(events.map((event) => event.type), ["slider-interaction-start", "change", "slider-interaction-end"]);
  assert.equal(events[1].detail, 35);
  assert.ok(events.every((event) => event.bubbles && event.composed));
  slider.onPointerDown(pointer);
  release("pointercancel");
  assert.equal(events.at(-1).type, "slider-interaction-end");
  assert.equal(events.length, 5);
  slider.onPointerDown(pointer);
  slider.stopNativeChange({ stopPropagation() {} });
  release("pointerup");
  assert.equal(events.length, 7);
  assert.equal(slider.activePointer, null);
  assert.equal(slider.interactionDocument, null);
  slider.onPointerDown(pointer);
  ownerDocument.defaultView.dispatchEvent(new Event("blur"));
  release("pointerup");
  assert.equal(events.length, 9);
  assert.equal(slider.activePointer, null);
});

test("slider release restores full rendering immediately without switching sources during a paused drag", (t) => {
  const { viewer, timers, delays, runTimer } = imageViewer(t);
  viewer.path = "photo";
  viewer.editing = true;
  viewer.bitmap = { width: 1920, height: 1280 };
  viewer.fullBitmap = { width: 6000, height: 4000 };
  viewer.fullBitmapForPath = "photo";
  viewer.userInteracted = true;
  viewer.scale = 1;
  viewer.beginEditInteraction();
  for (let change = 0; change < 100; change++) viewer.markEditingActive();
  assert.equal(viewer.currentBitmap, viewer.fullBitmap);
  assert.equal(timers.size, 0);
  assert.equal(viewer.editingActive, true);
  viewer.endEditInteraction();
  assert.equal(viewer.editingActive, false);
  assert.equal(viewer.currentBitmap, viewer.fullBitmap);
  assert.equal(viewer.scale, 1);
  assert.equal(timers.size, 0);
  viewer.markEditingActive();
  assert.equal(delays.get(viewer.editSettleTimer), 120);
  runTimer(viewer.editSettleTimer);
  assert.equal(viewer.currentBitmap, viewer.fullBitmap);
});

test("rotated full-resolution sources remain stable across repeated slider drags", (t) => {
  const { viewer } = imageViewer(t);
  viewer.path = "photo";
  viewer.bitmap = { width: 1920, height: 1280 };
  viewer.fullBitmap = { width: 6000, height: 4000 };
  viewer.fullBitmapForPath = "photo";
  viewer.normalizedRotation = () => 10;
  let rotations = 0;
  let invalidations = 0;
  viewer.buildRotatedCache = (bitmap) => {
    rotations++;
    return { canvas: {}, width: bitmap.width, height: bitmap.height };
  };
  viewer.renderPipeline.invalidate = () => invalidations++;
  const fullSource = viewer.effectiveSource().source;
  for (let drag = 0; drag < 10; drag++) {
    assert.equal(viewer.effectiveSource().source, fullSource);
    viewer.beginEditInteraction();
    viewer.markEditingActive();
    assert.equal(viewer.effectiveSource().source, fullSource);
    viewer.endEditInteraction();
  }
  assert.equal(rotations, 1);
  assert.equal(invalidations, 0);
});

function editedViewport(t, dependencies = {}) {
  const renders = [];
  const fixture = imageViewer(t, {
    "./canvas-state-adapter": { canvasState: {
      getPostProcess: () => ({}), cropEnabled: () => false, readValues: () => ({}),
    } },
    "@features/editor/registry": { hasActiveEditorToolValues: () => true },
    "@features/editor/rendering/render-pipeline": { EditorRenderPipeline: class {
      invalidate() {}
      render(source, values, rect, width, height, effectSize) {
        renders.push({ source, values, rect, width, height, effectSize });
        return { width, height };
      }
    } },
    ...dependencies,
  });
  const { viewer } = fixture;
  viewer.path = "photo";
  viewer.fullBitmap = { width: 2400, height: 1600 };
  viewer.fullBitmapForPath = "photo";
  viewer.canvas = {
    width: 1200, height: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    classList: { add() {}, remove() {} }, removeEventListener() {}, releasePointerCapture() {},
  };
  viewer.ctx = {
    save() {}, restore() {}, clearRect() {}, fillRect() {}, beginPath() {}, roundRect() {}, clip() {}, drawImage() {},
  };
  viewer.scale = 0.5;
  viewer.fitScale = 0.5;
  return { ...fixture, renders, draw: () => Object.getPrototypeOf(viewer).draw.call(viewer) };
}

for (const cropped of [false, true]) {
  for (const zoomed of [false, true]) {
    test(`before/after preserves ${zoomed ? "zoom and pan" : "fit"} with ${cropped ? "crop and rotation" : "an uncropped photo"}`, (t) => {
      const { viewer, renders, draw } = editedViewport(t, {
        "./canvas-state-adapter": { canvasState: {
          getPostProcess: () => ({ enabled: true }), cropEnabled: () => true,
          readValues: (scope) => ({ tone: { exposure: scope === "photo" ? 20 : 10 } }),
        } },
        "@features/editor/registry": { hasActiveEditorToolValues: (values) => Object.keys(values).length > 0 },
        "./canvas/crop-geometry": loadSource("features/image-viewer/canvas/crop-geometry.ts", {}),
        "./canvas/view-sizing": loadSource("features/image-viewer/canvas/view-sizing.ts", {}),
      });
      if (cropped) viewer.savedCrop = { x: 0.1, y: 0.2, width: 0.7, height: 0.6, rotation: 10 };
      let rotations = 0;
      viewer.buildRotatedCache = () => {
        rotations++;
        return { canvas: {}, width: 2800, height: 2000 };
      };
      const prototype = Object.getPrototypeOf(viewer);
      viewer.recomputeFit = () => prototype.recomputeFit.call(viewer);
      viewer.recomputeFit();
      viewer.userInteracted = zoomed;
      if (zoomed) {
        viewer.scale = 1.25;
        viewer.offsetX = 170;
        viewer.offsetY = -90;
      }
      const viewport = () => [viewer.scale, viewer.fitScale, viewer.offsetX, viewer.offsetY,
        viewer.userInteracted, viewer.forceFitOnNextRecompute];
      const initialViewport = viewport();
      const source = viewer.effectiveSource();
      const rect = viewer.effectiveRect(source);
      const originalDraws = [];
      viewer.ctx.drawImage = (...args) => originalDraws.push(args);
      viewer.scheduleDraw = draw;
      draw();
      assert.deepEqual(renders.at(-1).values, { photo: { tone: { exposure: 20 } }, post: { tone: { exposure: 10 } } });
      for (const preview of [true, false, true, false]) {
        const rendered = renders.length;
        viewer.previewOriginal = preview;
        viewer.willUpdate(new Map([["previewOriginal", !preview]]));
        assert.deepEqual(viewport(), initialViewport);
        assert.equal(viewer.effectiveSource().source, source.source);
        assert.deepEqual(viewer.effectiveRect(viewer.effectiveSource()), rect);
        if (preview) {
          assert.equal(renders.length, rendered);
          assert.deepEqual(originalDraws.at(-1).slice(0, 5), [source.source, rect.sx, rect.sy, rect.sw, rect.sh]);
        } else {
          assert.equal(renders.length, rendered + 1);
        }
        viewer.onResize();
        assert.deepEqual(viewport(), initialViewport);
      }
      assert.equal(rotations, cropped ? 1 : 0);
    });
  }
}

function assertInteractionPreview(render) {
  assert.ok(render.width >= 600 && render.width < 1200);
  assert.ok(render.height >= 400 && render.height < 800);
  assert.equal(render.width / render.height, 1.5);
  assert.deepEqual(render.effectSize, { width: 1200, height: 800 });
}

test("wheel zoom uses a reduced preview then restores detail using the same full source", (t) => {
  const { viewer, renders, delays, runTimer, draw } = editedViewport(t);
  draw();
  assert.deepEqual([renders.at(-1).width, renders.at(-1).height], [1200, 800]);
  viewer.onWheel({ clientX: 600, clientY: 400, deltaY: -10, preventDefault() {} });
  draw();
  assert.equal(delays.get(viewer.viewportSettleTimer), 120);
  assertInteractionPreview(renders.at(-1));
  assert.equal(renders.at(-1).source, viewer.fullBitmap);
  runTimer(viewer.viewportSettleTimer);
  draw();
  assert.deepEqual([renders.at(-1).width, renders.at(-1).height], [1200, 800]);
  assert.equal(renders.at(-1).source, viewer.fullBitmap);
});

test("pan and pinch keep the lightweight preview until the last pointer ends or cancels", (t) => {
  const { viewer, timers, renders, draw } = editedViewport(t);
  viewer.scale = 0.75;
  viewer.beginPan(600, 400);
  viewer.onPointerMove({ pointerType: "mouse", clientX: 610, clientY: 410 });
  draw();
  assertInteractionPreview(renders.at(-1));
  assert.equal(timers.size, 0);
  viewer.onPointerUp({ pointerType: "mouse", pointerId: 1 });
  draw();
  assert.equal(renders.at(-1).width, 1200);
  viewer.touchPointers.set(1, { x: 400, y: 400 });
  viewer.touchPointers.set(2, { x: 800, y: 400 });
  viewer.beginPinch();
  viewer.onPointerMove({ pointerType: "touch", pointerId: 2, clientX: 900, clientY: 400, preventDefault() {} });
  draw();
  assertInteractionPreview(renders.at(-1));
  viewer.onPointerUp({ pointerType: "touch", pointerId: 2, type: "pointerup" });
  assert.equal(viewer.viewportInteracting, true);
  viewer.onPointerUp({ pointerType: "touch", pointerId: 1, type: "pointercancel" });
  draw();
  assert.equal(renders.at(-1).width, 1200);
  assert.equal(viewer.viewportInteracting, false);
});

test("navigation clears gesture timers and releases the previous photo's GPU textures", async (t) => {
  let invalidations = 0;
  const { viewer, timers } = imageViewer(t);
  viewer.renderPipeline.invalidate = () => invalidations++;
  viewer.markEditingActive();
  viewer.markViewportInteraction();
  assert.equal(timers.size, 2);
  viewer.path = null;
  await viewer.startLoad();
  assert.equal(timers.size, 0);
  assert.equal(viewer.editingActive, false);
  assert.equal(viewer.viewportInteracting, false);
  assert.equal(invalidations, 1);
});

test("the renderer reuses both source textures without uploads or mipmaps and preserves effect sizes in previews", (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0 }) };
  t.after(() => { globalThis.document = previousDocument; });
  const bindings = [];
  const uploads = [];
  const deleted = [];
  const effectSizes = [];
  let mipmaps = 0;
  let textureId = 0;
  let activeUnit = 0;
  let boundTexture;
  const gl = {
    TEXTURE0: 0,
    createTexture: () => ({ id: ++textureId }),
    activeTexture: (unit) => { activeUnit = unit; },
    bindTexture: (_, texture) => { boundTexture = texture; bindings.push({ unit: activeUnit, texture }); },
    texParameteri() {}, pixelStorei() {},
    texImage2D: (...args) => uploads.push({ source: args.at(-1), texture: boundTexture }),
    generateMipmap: () => mipmaps++,
    deleteTexture: (texture) => deleted.push(texture),
    viewport() {}, useProgram() {}, bindVertexArray() {}, drawArrays() {},
    getUniformLocation: () => null, uniform2f() {},
  };
  const { EditorRenderPipeline } = loadSource("features/editor/rendering/render-pipeline.ts", {
    "@domain/edits": loadSource("domain/edits/effects.ts", {}),
    "./shader-composer": { TOOL_SHADER_MODULES: [{ id: "tone", bind: (context) => {
      effectSizes.push([context.outputWidth, context.outputHeight]);
    } }] },
    "../tools/grain/grain.shader": {},
    "./analog-render-pass": {},
  });
  const pipeline = new EditorRenderPipeline();
  pipeline.gl = gl;
  const hd = { width: 1920, height: 1280 };
  const full = { width: 6000, height: 4000 };
  pipeline.warmup(hd);
  pipeline.warmup(full);
  const hdTexture = uploads[0].texture;
  const fullTexture = uploads[1].texture;
  const values = { photo: {}, post: {} };
  for (let frame = 0; frame < 120; frame++) {
    const source = frame % 2 ? full : hd;
    pipeline.render(source, values, { sx: 0, sy: 0, sw: source.width, sh: source.height },
      600, 400, { width: 1200, height: 800 });
    assert.equal(bindings.filter((binding) => binding.unit === 0).at(-1).texture, source === full ? fullTexture : hdTexture);
  }
  assert.equal(uploads.length, 2);
  assert.equal(mipmaps, 2);
  assert.ok(effectSizes.every(([width, height]) => width === 1200 && height === 800));
  pipeline.warmup({ width: 320, height: 213 });
  assert.equal(deleted.length, 1);
  pipeline.invalidate();
  assert.equal(deleted.length, 3);
  pipeline.warmup(full);
  assert.equal(uploads.length, 4);
  pipeline.dispose();
  assert.equal(deleted.length, 4);
});


test("zooming past either wheel limit keeps full quality and does not prolong an existing preview", (t) => {
  const { viewer, timers, draw, renders } = editedViewport(t);
  const wheel = (deltaY) => viewer.onWheel({ clientX: 600, clientY: 400, deltaY, preventDefault() {} });
  for (let event = 0; event < 10; event++) wheel(100);
  assert.equal(viewer.viewportInteracting, false);
  assert.equal(timers.size, 0);
  assert.equal(viewer.userInteracted, false);
  draw();
  assert.deepEqual([renders.at(-1).width, renders.at(-1).height], [1200, 800]);
  wheel(-100);
  assert.equal(viewer.viewportInteracting, true);
  wheel(10000);
  wheel(100);
  assert.equal(viewer.scale, viewer.fitScale);
  assert.equal(viewer.viewportInteracting, false);
  assert.equal(timers.size, 0);
  viewer.scale = 20;
  wheel(-100);
  assert.equal(viewer.viewportInteracting, false);
  assert.equal(timers.size, 0);
});

test("clicking a slider without changing its value keeps full rendering quality", (t) => {
  const { viewer, renders, timers, draw } = editedViewport(t);
  viewer.beginEditInteraction();
  draw();
  assert.equal(viewer.editingActive, false);
  assert.equal(renders.at(-1).width, 1200);
  assert.equal(timers.size, 0);
  viewer.endEditInteraction();
});

test("slider previews retain detail from the full source even when an HD bitmap is available", (t) => {
  const { viewer, renders, draw } = editedViewport(t);
  viewer.bitmap = { width: 600, height: 400 };
  viewer.beginEditInteraction();
  viewer.markEditingActive();
  draw();
  assert.equal(renders.at(-1).source, viewer.fullBitmap);
  assertInteractionPreview(renders.at(-1));
  viewer.endEditInteraction();
  draw();
  assert.deepEqual([renders.at(-1).width, renders.at(-1).height], [1200, 800]);
});

test("panning or pinching beyond fit does not soften an unmoving image", (t) => {
  const { viewer, timers } = editedViewport(t);
  viewer.beginPan(600, 400);
  viewer.onPointerMove({ pointerType: "mouse", clientX: 610, clientY: 410 });
  assert.equal(viewer.viewportInteracting, false);
  viewer.onPointerUp({ pointerType: "mouse", pointerId: 1 });
  viewer.touchPointers.set(1, { x: 400, y: 400 });
  viewer.touchPointers.set(2, { x: 800, y: 400 });
  viewer.beginPinch();
  viewer.onPointerMove({ pointerType: "touch", pointerId: 2, clientX: 700, clientY: 400, preventDefault() {} });
  assert.equal(viewer.scale, viewer.fitScale);
  assert.equal(viewer.viewportInteracting, false);
  assert.equal(timers.size, 0);
});


function hdPreloader() {
  const fixture = imageCache("hd");
  fixture.cache.setHdImageDecoder(async (bitmap) => bitmap);
  const { HdImagePreloader } = loadService("images/hd-image-preloader.ts", {
    "./hd-image-cache": fixture.cache,
    "./video-source": { isVideoPath: (path) => path.endsWith(".mov") },
    "@services/tasks/task-manager": { isTaskCancellation: (error) => error.name === "AbortError" },
  });
  return { ...fixture, preloader: new HdImagePreloader() };
}

function hdBitmap() {
  return { width: 1920, height: 1280, closed: false, close() { this.closed = true; } };
}

test("HD lookahead waits for the open photo and prepares only the next three distinct images sequentially", async () => {
  const { preloader, cache, requests } = hdPreloader();
  const upcoming = ["current", "first", "first", "clip.mov", "second", "third", "fourth"];
  preloader.update("current", upcoming, false);
  assert.equal(requests.length, 0);
  preloader.update("current", upcoming, true);
  for (let index = 0; index < 3; index++) {
    assert.equal(requests.length, index + 1);
    assert.equal(requests[index].photoPath, ["first", "second", "third"][index]);
    assert.equal(requests[index].priority, "background");
    requests[index].resolve(hdBitmap());
    await new Promise(setImmediate);
  }
  assert.equal(requests.length, 3);
  for (const path of ["first", "second", "third"]) assert.ok(cache.getHdImage(path));
  assert.equal(cache.getHdImage("fourth"), null);
  preloader.update("third", [], true);
  assert.equal(requests.length, 3);
  preloader.stop();
});

test("opening a prefetched photo shares its request and promotes it to urgent priority", async () => {
  const { preloader, cache, requests, cancelled, priorities } = hdPreloader();
  preloader.update("current", ["first", "second", "third"], true);
  preloader.update("first", ["second", "third", "fourth"], false);
  const visible = cache.loadHdImage("first");
  assert.equal(requests.length, 1);
  assert.deepEqual(priorities, [{ id: requests[0].requestId, priority: "urgent" }]);
  assert.deepEqual(cancelled, []);
  const bitmap = hdBitmap();
  requests[0].resolve(bitmap);
  assert.equal(await visible, bitmap);
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  preloader.update("first", ["second", "third", "fourth"], true);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].photoPath, "second");
  preloader.stop();
  await new Promise(setImmediate);
});

test("HD lookahead cancels obsolete work on a jump or close and discards late results", async () => {
  const { preloader, cache, requests, cancelled } = hdPreloader();
  preloader.update("current", ["first", "second", "third"], true);
  preloader.update("far", ["next", "last"], false);
  await new Promise(setImmediate);
  assert.deepEqual(cancelled, [requests[0].requestId]);
  requests[0].resolve(hdBitmap());
  await new Promise(setImmediate);
  assert.equal(cache.getHdImage("first"), null);
  assert.equal(requests.length, 1);
  preloader.update("far", ["next", "last"], true);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].photoPath, "next");
  preloader.stop();
  requests[1].resolve(hdBitmap());
  await new Promise(setImmediate);
  assert.equal(cache.getHdImage("next"), null);
  assert.equal(requests.length, 2);
});

test("cancelling visible or background HD consumers preserves shared work at the remaining priority", async () => {
  const { cache, requests, cancelled, priorities } = imageCache("hd");
  cache.setHdImageDecoder(async (bitmap) => bitmap);
  const backgroundAbort = new AbortController();
  const visibleAbort = new AbortController();
  const background = cache.loadHdImage("first", { priority: "background", signal: backgroundAbort.signal });
  const visible = cache.loadHdImage("first", { signal: visibleAbort.signal });
  visibleAbort.abort();
  await assert.rejects(visible, { name: "AbortError" });
  assert.deepEqual(priorities.map((entry) => entry.priority), ["urgent", "background"]);
  assert.deepEqual(cancelled, []);
  const replacement = cache.loadHdImage("first");
  backgroundAbort.abort();
  await assert.rejects(background, { name: "AbortError" });
  assert.deepEqual(cancelled, []);
  const bitmap = hdBitmap();
  requests[0].resolve(bitmap);
  assert.equal(await replacement, bitmap);
  assert.equal(requests.length, 1);
});

test("HD lookahead keeps all three upcoming previews and protects the open bitmap from eviction", async () => {
  const { preloader, cache, requests } = hdPreloader();
  const currentRequest = cache.loadHdImage("current");
  const current = hdBitmap();
  requests[0].resolve(current);
  await currentRequest;
  preloader.update("current", ["first", "second", "third"], true);
  for (let index = 1; index <= 3; index++) {
    requests[index].resolve(hdBitmap());
    await new Promise(setImmediate);
  }
  for (let index = 0; index < 4; index++) {
    const extra = cache.loadHdImage(`extra-${index}`, { priority: "background" });
    requests.at(-1).resolve(hdBitmap());
    await extra;
  }
  assert.equal(current.closed, false);
  assert.equal(cache.getHdImage("current"), current);
  preloader.stop();
  for (let index = 4; index < 9; index++) {
    const extra = cache.loadHdImage(`extra-${index}`, { priority: "background" });
    requests.at(-1).resolve(hdBitmap());
    await extra;
  }
  assert.equal(current.closed, true);
});

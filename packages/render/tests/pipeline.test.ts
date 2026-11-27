import { describe, expect, it } from "vitest";
import {
  AdjustmentStage,
  AnalogStage,
  EffectRegistry,
  RenderPipeline,
  ShaderEffect,
  defaultAnalog,
  type EffectUniforms,
  type ImageSource,
  type RenderRecipe,
} from "../src";
import { FakeGl } from "./fake-gl";

const image = (width: number, height: number) => ({ width, height }) as unknown as ImageSource;

class SizeRecordingEffect extends ShaderEffect<object> {
  readonly id = "tone";
  readonly shader = { declarations: "", functions: "", photoApply: "", postApply: "" };
  readonly sizes: Array<[number, number]> = [];

  defaults(): object {
    return {};
  }

  isNeutral(): boolean {
    return true;
  }

  bind(uniforms: EffectUniforms): void {
    this.sizes.push([uniforms.outputWidth, uniforms.outputHeight]);
  }
}

describe("RenderPipeline", () => {
  it("runs analog after the adjustments on reused targets and releases them when disabled", () => {
    const gl = new FakeGl();
    const stages = [new AdjustmentStage([]), new AnalogStage("photo"), new AnalogStage("post")];
    const pipeline = new RenderPipeline(stages, gl.canvas());
    const source = image(2400, 1600);
    const active: RenderRecipe = {
      photo: { analog: { ...defaultAnalog(), vignette: 40 }, color: { blackAndWhite: true } as never },
      post: { analog: { ...defaultAnalog(), halation: 50 } },
    };
    const render = (recipe: RenderRecipe) =>
      pipeline.render({ source, recipe, region: { x: 600, y: 400, width: 1200, height: 800 }, outputWidth: 600, outputHeight: 400 });

    render(active);
    const [adjust, photoAnalog, postAnalog] = gl.draws;
    expect(gl.draws).toHaveLength(3);
    expect(adjust.framebuffer).toBeTruthy();
    expect(photoAnalog.framebuffer).toBeTruthy();
    expect(photoAnalog.framebuffer).not.toBe(adjust.framebuffer);
    expect(postAnalog.framebuffer).toBeNull();
    expect(photoAnalog.texture).not.toBe(adjust.texture);
    expect(postAnalog.texture).not.toBe(photoAnalog.texture);
    expect(photoAnalog.program).not.toBe(adjust.program);
    expect(photoAnalog.uniforms.get("u_vignette")).toBe(0.4);
    expect(postAnalog.uniforms.get("u_halation")).toBe(0.5);
    expect(postAnalog.uniforms.get("u_vignette")).toBe(0);
    expect(postAnalog.uniforms.get("u_monochrome")).toBe(1);
    expect(postAnalog.uniforms.get("u_srcOffset")).toEqual([0.25, 0.25]);
    expect(postAnalog.uniforms.get("u_srcScale")).toEqual([0.5, 0.5]);
    expect(gl.uploads).toHaveLength(3);
    expect(gl.mipmaps).toEqual([adjust.texture, postAnalog.texture]);

    render(active);
    expect(gl.uploads).toHaveLength(3);

    const drawsBefore = gl.draws.length;
    render({ photo: { analog: defaultAnalog() }, post: { analog: defaultAnalog() } });
    expect(gl.draws).toHaveLength(drawsBefore + 1);
    expect(gl.draws[gl.draws.length - 1].framebuffer).toBeNull();
    expect(gl.deletedFramebuffers).toHaveLength(2);
    expect(gl.deletedTextures).toHaveLength(2);

    pipeline.releaseSources();
    expect(gl.deletedTextures).toHaveLength(3);
    pipeline.dispose();
  });

  it("reuses both source textures without uploads and keeps full-quality effect sizes in previews", () => {
    const gl = new FakeGl();
    const effect = new SizeRecordingEffect();
    const pipeline = new RenderPipeline([new AdjustmentStage([effect])], gl.canvas());
    const hd = image(1920, 1280);
    const full = image(6000, 4000);
    pipeline.warmup(hd);
    pipeline.warmup(full);
    const hdTexture = gl.uploads[0].texture;
    const fullTexture = gl.uploads[1].texture;

    for (let frame = 0; frame < 120; frame++) {
      const source = frame % 2 ? full : hd;
      pipeline.render({
        source,
        recipe: { photo: {}, post: {} },
        region: { x: 0, y: 0, width: source.width, height: source.height },
        outputWidth: 600,
        outputHeight: 400,
        effectSize: { width: 1200, height: 800 },
      });
      const sourceBindings = gl.unitBindings.filter((binding) => binding.unit === 0);
      const sourceBinding = sourceBindings[sourceBindings.length - 1];
      expect(sourceBinding.texture).toBe(source === full ? fullTexture : hdTexture);
    }
    expect(gl.uploads).toHaveLength(2);
    expect(gl.mipmaps).toHaveLength(2);
    expect(effect.sizes.every(([width, height]) => width === 1200 && height === 800)).toBe(true);

    pipeline.warmup(image(320, 213));
    expect(gl.deletedTextures).toHaveLength(1);
    pipeline.releaseSources();
    expect(gl.deletedTextures).toHaveLength(3);
    pipeline.warmup(full);
    expect(gl.uploads).toHaveLength(4);
    pipeline.dispose();
    expect(gl.deletedTextures).toHaveLength(4);
  });

  it("reports whether a recipe changes the image", () => {
    const pipeline = new RenderPipeline(RenderPipeline.standardStages(), new FakeGl().canvas());
    expect(pipeline.changesImage({ photo: {}, post: {} })).toBe(false);
    expect(pipeline.changesImage({ photo: { analog: defaultAnalog() }, post: {} })).toBe(false);
    expect(pipeline.changesImage({ photo: {}, post: { analog: { ...defaultAnalog(), vignette: 5 } } })).toBe(true);
    expect(pipeline.changesImage({ photo: { sharpen: { strength: 10, radius: 1, threshold: 0 } }, post: {} })).toBe(true);
  });

  it("returns null when WebGL is unavailable", () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    const pipeline = new RenderPipeline([new AdjustmentStage([])], canvas);
    const source = image(10, 10);
    const request = { source, recipe: { photo: {}, post: {} }, region: { x: 0, y: 0, width: 10, height: 10 }, outputWidth: 10, outputHeight: 10 };
    expect(pipeline.render(request)).toBeNull();
  });
});

describe("EffectRegistry", () => {
  it("applies shader effects in the standard order and knows neutral layers", () => {
    const registry = EffectRegistry.standard();
    expect(registry.shaderEffects.map((effect) => effect.id)).toEqual([
      "tone", "clarity", "color", "curve", "sharpen", "bloom", "grain",
    ]);
    expect(registry.effects.map((effect) => effect.id).pop()).toBe("analog");
    expect(registry.isLayerNeutral({})).toBe(true);
    expect(registry.isLayerNeutral({ grain: { size: 25, amount: 10, fine: 0 } })).toBe(false);
  });
});

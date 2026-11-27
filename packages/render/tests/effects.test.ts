import { describe, expect, it } from "vitest";
import {
  BloomEffect,
  ClarityEffect,
  defaultClarity,
  normalizeAnalog,
  normalizeClarity,
  type EffectUniforms,
} from "../src";
import { clarityShader } from "../src/effects/clarity/clarity-shader";
import { colorShader } from "../src/effects/color/color-shader";
import { bloomShader } from "../src/effects/bloom/bloom-shader";
import { toneShader } from "../src/effects/tone/tone-shader";
import { ProgramComposer } from "../src/pipeline/program-composer";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const smoothstep = (min: number, max: number, value: number) => {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
};
const luma = (rgb: number[]) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;

function recordingUniforms(seen: Map<string, unknown>, size = { width: 1200, height: 800 }): EffectUniforms {
  return {
    sourceScaleX: 0.5,
    sourceScaleY: 0.5,
    outputWidth: size.width,
    outputHeight: size.height,
    set1f: (name, value) => seen.set(name, value),
    set1i: (name, value) => seen.set(name, value),
    set2f: (name, x, y) => seen.set(name, [x, y]),
    set3f: (name, x, y, z) => seen.set(name, [x, y, z]),
    set3fv: (name, value) => seen.set(name, value),
  };
}

function glslBody(source: string, signature: RegExp): string {
  const body = source.match(signature)?.[1];
  if (!body) throw new Error(`GLSL function not found: ${signature}`);
  return body;
}

describe("clarity", () => {
  it("protects noise and strong edges", () => {
    const body = glslBody(clarityShader.functions, /float clarityDetail\([^)]*\)\s*\{([^}]+)\}/);
    const detail = new Function(
      "difference", "haloProtection", "noiseProtection", "smoothstep",
      body.replace(/\bfloat\s+/g, "let ").replace(/\babs\(/g, "Math.abs("),
    );
    const unprotected = detail(0.25, 0, 0, smoothstep);
    expect(unprotected).toBeGreaterThan(0);
    expect(detail(0.25, 1, 0, smoothstep)).toBeLessThan(unprotected);
    expect(detail(0.002, 0, 1, smoothstep)).toBeLessThan(detail(0.002, 0, 0, smoothstep));
    expect(detail(0, 0.6, 0.2, smoothstep)).toBe(0);
    expect(detail(-0.1, 0.6, 0.2, smoothstep)).toBe(-detail(0.1, 0.6, 0.2, smoothstep));
  });

  it("preserves monochrome and cannot clip colour channels", () => {
    const body = glslBody(clarityShader.functions, /vec3 clarityBlend\([^)]*\)\s*\{([^}]+)\}/);
    const blend = new Function("current", "delta", "smoothstep", "clamp", body
      .replace(/\bfloat\s+/g, "let ")
      .replace("dot(current, LUMA)", "(current[0] * 0.2126 + current[1] * 0.7152 + current[2] * 0.0722)")
      .replace(/current\.([rgb])/g, (_, channel) => `current[${"rgb".indexOf(channel)}]`)
      .replace(/\bmin\(/g, "Math.min(").replace(/\bmax\(/g, "Math.max(")
      .replace("return current + vec3(protectedDelta);", "return current.map(channel => channel + protectedDelta);"));
    const apply = (rgb: number[], delta: number): number[] => blend(rgb, delta, smoothstep, clamp);
    expect(apply([0.5, 0.5, 0.5], 0)).toEqual([0.5, 0.5, 0.5]);
    expect(apply([0.5, 0.5, 0.5], 0.1)[0]).toBeGreaterThan(0.5);
    expect(apply([0.5, 0.5, 0.5], -0.1)[0]).toBeLessThan(0.5);
    for (const rgb of [[0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [0.9, 0.2, 0.1]]) {
      for (const delta of [-2, -0.1, 0, 0.1, 2]) {
        const result = apply(rgb, delta);
        expect(result.every((channel) => channel >= 0 && channel <= 1)).toBe(true);
        if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) expect(new Set(result).size).toBe(1);
      }
    }
    expect(apply([0, 0, 0], 1)).toEqual([0, 0, 0]);
    expect(apply([1, 1, 1], -1)).toEqual([1, 1, 1]);
  });

  it("is neutral only at zero and binds both layers with a full-quality step", () => {
    const effect = new ClarityEffect();
    expect(effect.isNeutral(defaultClarity())).toBe(true);
    expect(effect.isNeutral({ ...defaultClarity(), structure: -50 })).toBe(false);
    expect(effect.isNeutral({ ...defaultClarity(), clarity: 40 })).toBe(false);
    const seen = new Map<string, unknown>();
    effect.bind(recordingUniforms(seen), { photo: { ...defaultClarity(), structure: -50 }, post: null });
    expect(seen.get("u_editStructure")).toBe(-0.5);
    expect(seen.get("u_postStructure")).toBe(0);
    expect(seen.get("u_clarityStep")).toEqual([0.5 / 1200, 0.5 / 800]);
  });
});

describe("bloom", () => {
  it("runs once on the source before tone and both colour layers", () => {
    const fragment = new ProgramComposer([toneShader, colorShader, bloomShader]).fragmentSource();
    const main = fragment.slice(fragment.indexOf("void main()"));
    const bloom = main.indexOf("color = toolApplyBloom(color)");
    expect(bloom).toBeGreaterThanOrEqual(0);
    expect(main.match(/toolApplyBloom\(color\)/g)).toHaveLength(1);
    expect(main.indexOf("color = toolApplyTone(")).toBeGreaterThan(bloom);
    for (const operation of ["u_editColorEnabled", "u_editBlackAndWhite", "u_postColorEnabled", "u_postBlackAndWhite"]) {
      expect(main.indexOf(operation)).toBeGreaterThan(bloom);
    }
    expect(bloomShader.sourceApply).toMatch(/if \(u_bloomStrength > 0\.0\)/);
  });

  it("leaves a bloomed pixel untouched when photo tone is neutral", () => {
    const applyPhotoTone = new Function(
      "color", "toolApplyTone",
      `${toneShader.photoApply.replace(/\bu_\w+/g, "0")} return color;`,
    );
    const bloomedPixel = [0.35, 0.25, 0.15];
    expect(applyPhotoTone(bloomedPixel, (pixel: number[]) => pixel)).toBe(bloomedPixel);
  });

  it("takes its strength from the post layer only", () => {
    const effect = new BloomEffect();
    const strengths: unknown[] = [];
    const seen = new Map<string, unknown>();
    const uniforms = recordingUniforms(seen);
    effect.bind(uniforms, { photo: { ...effect.defaults(), strength: 90 }, post: { ...effect.defaults(), strength: 65 } });
    strengths.push(seen.get("u_bloomStrength"));
    effect.bind(uniforms, { photo: null, post: null });
    strengths.push(seen.get("u_bloomStrength"));
    expect(strengths).toEqual([65, 0]);
  });
});

describe("tone shadow lifts", () => {
  const body = glslBody(toneShader.functions, /vec3 toolRemapToneLuma\([^)]*\)\s*\{([^}]+)\}/);
  const remapChannel = new Function("col", "sourceLuma", "targetLuma", body
    .replace(/\bfloat\s+/g, "let ")
    .replace(/\bvec3\(/g, "(")
    .replace(/\bmax\(/g, "Math.max("));
  const remap = (rgb: number[], target: number): number[] =>
    rgb.map((channel) => remapChannel(channel, luma(rgb), target));

  it("keep near-black colour noise subdued while hitting the target luminance", () => {
    for (const target of [0.12, 0.22, 0.34]) {
      expect(remap([0, 0, 0], target)).toEqual([target, target, target]);
      for (const pixel of [[1 / 255, 0, 0], [0, 1 / 255, 0], [0, 0, 1 / 255], [1 / 255, 0, 2 / 255], [0.01, 0.01, 0.01]]) {
        const lifted = remap(pixel, target);
        expect(luma(lifted)).toBeCloseTo(target, 10);
        expect(Math.max(...lifted) - Math.min(...lifted)).toBeLessThan(0.06);
        expect(lifted.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1)).toBe(true);
      }
    }
    const liftedTwice = remap(remap([0, 0, 1 / 255], 0.22), 0.44);
    expect(luma(liftedTwice)).toBeCloseTo(0.44, 10);
    expect(Math.max(...liftedTwice) - Math.min(...liftedTwice)).toBeLessThan(0.04);
  });

  it("scale normal colours proportionally and leave unchanged luminance alone", () => {
    for (const pixel of [[0.2, 0.1, 0.05], [0.05, 0.1, 0.3], [0.1, 0.2, 0.1]]) {
      for (const target of [0, luma(pixel) / 2, luma(pixel), luma(pixel) + 0.22]) {
        const adjusted = remap(pixel, target);
        pixel.forEach((channel, index) => expect(adjusted[index]).toBeCloseTo((channel * target) / luma(pixel), 10));
      }
    }
    for (const pixel of [[0, 0, 0], [1e-8, 0, 0], [0, 0, 1e-8]]) {
      remap(pixel, luma(pixel)).forEach((channel, index) => expect(channel).toBeCloseTo(pixel[index], 10));
    }
  });
});

describe("settings normalisation", () => {
  it("clamps amounts and drops unknown or removed fields", () => {
    expect(normalizeClarity({ clarity: 250, structure: -400, radius: 9 } as never)).toEqual({ clarity: 100, structure: -100 });
    expect(normalizeClarity(null)).toEqual({ clarity: 0, structure: 0 });
    expect(normalizeAnalog({ vignette: -5, halation: Number.NaN, grain: 3 } as never)).toEqual({
      vignette: 0,
      halation: 0,
      chromaticAberration: 0,
    });
  });
});

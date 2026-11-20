import { defaultAnalog, defaultGrain } from "@warble/render";
import { describe, expect, it } from "vitest";
import { EffectCatalog } from "../src";

describe("EffectCatalog", () => {
  const catalog = EffectCatalog.standard();

  it("removed Clarity and Analog controls are dropped from saved values and amounts default safely", () => {
    const clarity = { clarity: 25, structure: -20, scale: 90, noiseProtection: 100, haloProtection: 100 };
    expect(catalog.normalize("clarity", clarity)).toEqual({ clarity: 25, structure: -20 });

    const analog = { dust: 45, vignette: -20, halation: 1000, scratches: 70, vignetteBlur: 90, extra: 30 };
    expect(catalog.normalize("analog", analog)).toEqual({ vignette: 0, halation: 100, chromaticAberration: 0 });

    expect(catalog.isNeutral("analog", catalog.normalize("analog", { dust: 80, scratches: 70 }))).toBe(true);
    expect(catalog.isNeutral("analog", catalog.defaults("analog"))).toBe(true);
    for (const key of Object.keys(defaultAnalog())) {
      expect(catalog.isNeutral("analog", { ...defaultAnalog(), [key]: 20 })).toBe(false);
    }
  });

  it("fills in missing keys of older saved values from the defaults", () => {
    expect(catalog.normalize("grain", { amount: 20 })).toEqual({ ...defaultGrain(), amount: 20 });
    expect(catalog.normalize("grain", null)).toEqual(defaultGrain());
  });

  it("knows the registered effects in render order", () => {
    expect(catalog.ids).toEqual(["tone", "clarity", "color", "curve", "sharpen", "bloom", "grain", "analog"]);
    expect(catalog.has("grain")).toBe(true);
    expect(catalog.has("crop")).toBe(false);
  });
});

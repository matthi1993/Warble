/**
 * Per-hue HSL adjustments — used both as a per-photo edit and as a
 * global post-process pass. The same data shape feeds both shader
 * passes; only the persistence path differs.
 *
 * Eight hue channels cover the colour wheel (matching the Lightroom
 * "Color Mixer" layout). Each one carries hue / saturation /
 * luminance shifts in [-100, 100]. Three global sliders apply on top.
 *
 * The shader (`tone-pipeline.ts`) blends each channel into its immediate
 * neighbours with complementary smoothstep falloffs. The weights form a
 * continuous partition across the hue wheel without long tails into distant
 * colors. A chroma-confidence ramp suppresses unstable hue classification in
 * near-neutral and very dark pixels.
 *
 * Channel order MUST stay in sync with the shader's `centres[]`
 * table and the `uploadColorUniforms` packer.
 */

export type ColorChannel =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "aqua"
  | "blue"
  | "purple"
  | "magenta";

export const COLOR_CHANNELS: readonly ColorChannel[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta",
] as const;

/** Centre hue (degrees) for each channel. Used by the UI to pick
 *  swatch colours; the shader has the same numbers hard-coded. */
export const COLOR_CHANNEL_HUES: Record<ColorChannel, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 240,
  purple: 270,
  magenta: 330,
};

export interface ColorChannelEdit {
  /** Hue shift in [-100, 100] — slider unit maps to ±30° at the
   *  channel centre, scaled by the per-pixel weight in the shader. */
  hue: number;
  /** Saturation shift in [-100, 100] — multiplicative on HSV S
   *  via `1 + slider/100`, clamped to [0, 2]. */
  saturation: number;
  /** Luminance shift in [-100, 100] — multiplicative on HSV V
   *  via `1 + slider/100`, clamped to [0, 2]. */
  luminance: number;
}

export interface ColorEdit {
  /** Global hue shift applied to every pixel on top of the
   *  per-channel weighted shift. Range [-100, 100]. */
  hue: number;
  /** Global saturation shift. Range [-100, 100]. */
  saturation: number;
  /** Global luminance shift. Range [-100, 100]. */
  luminance: number;
  /** Per-channel HSL shifts keyed by {@link COLOR_CHANNELS}. */
  channels: Record<ColorChannel, ColorChannelEdit>;
}

export function defaultColorChannel(): ColorChannelEdit {
  return { hue: 0, saturation: 0, luminance: 0 };
}

export function defaultColor(): ColorEdit {
  const channels = {} as Record<ColorChannel, ColorChannelEdit>;
  for (const k of COLOR_CHANNELS) channels[k] = defaultColorChannel();
  return { hue: 0, saturation: 0, luminance: 0, channels };
}

/** True when every slider is at its neutral position. */
export function isColorZero(c: ColorEdit | null | undefined): boolean {
  if (!c) return true;
  if (c.hue !== 0 || c.saturation !== 0 || c.luminance !== 0) return false;
  for (const k of COLOR_CHANNELS) {
    const ch = c.channels[k];
    if (!ch) continue;
    if (ch.hue !== 0 || ch.saturation !== 0 || ch.luminance !== 0)
      return false;
  }
  return true;
}

/** Defensive sanitiser: accepts arbitrary persisted data and returns
 *  a fully-populated `ColorEdit` with missing fields filled in from
 *  defaults. Useful when migrating older photos / settings that may
 *  not have a colour block yet, or when a future schema adds new
 *  channels we want to backfill. */
export function normalizeColor(input: unknown): ColorEdit {
  const base = defaultColor();
  if (!input || typeof input !== "object") return base;
  const src = input as Partial<ColorEdit> & {
    channels?: Partial<Record<ColorChannel, Partial<ColorChannelEdit>>>;
  };
  base.hue = numOr(src.hue, 0);
  base.saturation = numOr(src.saturation, 0);
  base.luminance = numOr(src.luminance, 0);
  if (src.channels && typeof src.channels === "object") {
    for (const k of COLOR_CHANNELS) {
      const ch = src.channels[k];
      if (!ch || typeof ch !== "object") continue;
      base.channels[k] = {
        hue: numOr(ch.hue, 0),
        saturation: numOr(ch.saturation, 0),
        luminance: numOr(ch.luminance, 0),
      };
    }
  }
  return base;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

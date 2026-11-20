export type ColorChannel =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "aqua"
  | "blue"
  | "purple"
  | "magenta";

/** The order must match the `centres[]` table in the colour shader. */
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

/** Centre hue in degrees; the colour shader hard-codes the same numbers. */
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

/** Every value is a shift in [-100, 100]. */
export interface ColorChannelEdit {
  hue: number;
  saturation: number;
  luminance: number;
}

export interface ColorEdit {
  blackAndWhite: boolean;
  hue: number;
  saturation: number;
  luminance: number;
  channels: Record<ColorChannel, ColorChannelEdit>;
}

export function defaultColorChannel(): ColorChannelEdit {
  return { hue: 0, saturation: 0, luminance: 0 };
}

export function defaultColor(): ColorEdit {
  const channels = {} as Record<ColorChannel, ColorChannelEdit>;
  for (const k of COLOR_CHANNELS) channels[k] = defaultColorChannel();
  return {
    blackAndWhite: false,
    hue: 0,
    saturation: 0,
    luminance: 0,
    channels,
  };
}

export function isColorZero(c: ColorEdit | null | undefined): boolean {
  if (!c) return true;
  if (c.blackAndWhite) return false;
  if (c.hue !== 0 || c.saturation !== 0 || c.luminance !== 0) return false;
  for (const k of COLOR_CHANNELS) {
    const ch = c.channels[k];
    if (!ch) continue;
    if (ch.hue !== 0 || ch.saturation !== 0 || ch.luminance !== 0)
      return false;
  }
  return true;
}

export function normalizeColor(input: unknown): ColorEdit {
  const base = defaultColor();
  if (!input || typeof input !== "object") return base;
  const src = input as Partial<ColorEdit> & {
    channels?: Partial<Record<ColorChannel, Partial<ColorChannelEdit>>>;
  };
  base.blackAndWhite = src.blackAndWhite === true;
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

/**
 * Per-photo tone curve (multi-channel).
 *
 * The curve editor stores a list of (x, y) control points per
 * channel, both in [0, 1]. At render time we expand each channel
 * into a 256-sample LUT (linear interpolation between points) and
 * upload it as a GL texture so the tone shader can apply the curve
 * with a single texture lookup per pixel per channel.
 *
 * We keep five channels:
 *   - `rgb`  — applied to R, G and B identically (overall curve).
 *   - `r/g/b` — applied to each channel individually after `rgb`.
 *   - `luma` — applied as a luminance scale, preserving hue.
 *
 * A channel whose points form the identity line `[(0,0), (1,1)]` is
 * a no-op. `isCurveZero` returns true when every channel is identity
 * — used to decide whether to skip the LUT pass entirely.
 */

export type CurveChannel = "rgb" | "r" | "g" | "b" | "luma";

export const CURVE_CHANNELS: readonly CurveChannel[] = [
  "rgb",
  "r",
  "g",
  "b",
  "luma",
] as const;

export interface CurvePoint {
  /** Input value, [0, 1]. */
  readonly x: number;
  /** Output value, [0, 1]. */
  readonly y: number;
}

export interface CurveEdit {
  readonly rgb: readonly CurvePoint[];
  readonly r: readonly CurvePoint[];
  readonly g: readonly CurvePoint[];
  readonly b: readonly CurvePoint[];
  readonly luma: readonly CurvePoint[];
}

/** Identity curve: maps every input to itself. */
export function identityCurveChannel(): readonly CurvePoint[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];
}

export function defaultCurve(): CurveEdit {
  return {
    rgb: identityCurveChannel(),
    r: identityCurveChannel(),
    g: identityCurveChannel(),
    b: identityCurveChannel(),
    luma: identityCurveChannel(),
  };
}

/** True iff every channel is the identity. */
export function isCurveChannelIdentity(pts: readonly CurvePoint[]): boolean {
  if (pts.length !== 2) return false;
  const [a, b] = pts;
  return (
    Math.abs(a.x - 0) < 1e-6 &&
    Math.abs(a.y - 0) < 1e-6 &&
    Math.abs(b.x - 1) < 1e-6 &&
    Math.abs(b.y - 1) < 1e-6
  );
}

export function isCurveZero(c: CurveEdit | null | undefined): boolean {
  if (!c) return true;
  for (const ch of CURVE_CHANNELS) {
    if (!isCurveChannelIdentity(c[ch])) return false;
  }
  return true;
}

/**
 * Expand a channel's control points into a 256-sample LUT (Uint8Array).
 * Control points are expected to be sorted by `x` ascending and to
 * include endpoints at x=0 and x=1.
 *
 * Interpolation is a monotonic cubic Hermite spline (Fritsch–Carlson),
 * which gives smooth tone transitions between control points without
 * the overshoots that a plain Catmull–Rom would produce — overshoots
 * in a tone curve manifest as "ringing" highlights that are wrong
 * even before they're ugly. The two-point (identity) case degenerates
 * to a straight line, so users only pay for the spline once they've
 * added a third control point.
 */
export function buildChannelLut(pts: readonly CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  if (pts.length === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  // Guarantee endpoints so interpolation covers [0, 1].
  if (sorted[0].x > 0) sorted.unshift({ x: 0, y: sorted[0].y });
  if (sorted[sorted.length - 1].x < 1)
    sorted.push({ x: 1, y: sorted[sorted.length - 1].y });

  const n = sorted.length;
  // Precompute segment slopes d[i] = (y[i+1]-y[i]) / (x[i+1]-x[i]).
  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const slope: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = Math.max(sorted[i + 1].x - sorted[i].x, 1e-6);
    dy[i] = sorted[i + 1].y - sorted[i].y;
    slope[i] = dy[i] / dx[i];
  }
  // Tangents m[i] using the Fritsch–Carlson monotonic scheme.
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      // Local extremum — flat tangent to preserve monotonicity.
      m[i] = 0;
    } else {
      m[i] = (slope[i - 1] + slope[i]) / 2;
    }
  }
  // Adjust tangents where they'd overshoot, per Fritsch–Carlson.
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    while (seg < n - 2 && t > sorted[seg + 1].x) seg++;
    const x0 = sorted[seg].x;
    const y0 = sorted[seg].y;
    const y1 = sorted[seg + 1].y;
    const h = dx[seg];
    const u = (t - x0) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    // Cubic Hermite basis functions.
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const y = h00 * y0 + h10 * h * m[seg] + h01 * y1 + h11 * h * m[seg + 1];
    lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  return lut;
}

/** Pack all five channels into a single 256x2 RGBA texture buffer
 *  (length = 256 * 2 * 4 = 2048 bytes):
 *
 *    row 0  R: r-channel   G: g-channel   B: b-channel   A: rgb-channel
 *    row 1  R: luma        G: 0           B: 0           A: 255
 */
export function buildCurveLutTextureData(c: CurveEdit): Uint8Array {
  const r = buildChannelLut(c.r);
  const g = buildChannelLut(c.g);
  const b = buildChannelLut(c.b);
  const rgb = buildChannelLut(c.rgb);
  const luma = buildChannelLut(c.luma);
  const out = new Uint8Array(256 * 2 * 4);
  for (let i = 0; i < 256; i++) {
    out[i * 4 + 0] = r[i];
    out[i * 4 + 1] = g[i];
    out[i * 4 + 2] = b[i];
    out[i * 4 + 3] = rgb[i];
  }
  const row1 = 256 * 4;
  for (let i = 0; i < 256; i++) {
    out[row1 + i * 4 + 0] = luma[i];
    out[row1 + i * 4 + 1] = 0;
    out[row1 + i * 4 + 2] = 0;
    out[row1 + i * 4 + 3] = 255;
  }
  return out;
}

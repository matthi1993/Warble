/** Format a JavaScript number as an explicitly floating-point GLSL literal. */
export function glslFloat(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot emit non-finite GLSL number: ${value}`);
  }
  return Number.isInteger(value) ? `${value}.0` : String(value);
}


export const CURVE_GRID_SIZE = 240;
const PADDING = 8;
const PLOT_SIZE = CURVE_GRID_SIZE - 2 * PADDING;

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface GridBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ClientPosition {
  readonly clientX: number;
  readonly clientY: number;
}

/** Converts between curve values (0..1, y upwards) and the square SVG grid they are drawn on. */
export class CurveGridGeometry {
  readonly size = CURVE_GRID_SIZE;
  readonly start = PADDING;
  readonly end = CURVE_GRID_SIZE - PADDING;

  toGridX(input: number): number {
    return PADDING + PLOT_SIZE * input;
  }

  toGridY(output: number): number {
    return CURVE_GRID_SIZE - PADDING - PLOT_SIZE * output;
  }

  fromGridX(x: number): number {
    return this.clampToUnit((x - PADDING) / PLOT_SIZE);
  }

  fromGridY(y: number): number {
    return this.clampToUnit(1 - (y - PADDING) / PLOT_SIZE);
  }

  fromClient(position: ClientPosition, bounds: GridBounds): GridPoint {
    return {
      x: ((position.clientX - bounds.left) / bounds.width) * CURVE_GRID_SIZE,
      y: ((position.clientY - bounds.top) / bounds.height) * CURVE_GRID_SIZE,
    };
  }

  private clampToUnit(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}

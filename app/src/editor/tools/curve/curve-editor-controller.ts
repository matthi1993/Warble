import {
  identityCurveChannel,
  isCurveChannelIdentity,
  type CurveChannel,
  type CurveEdit,
  type CurvePoint,
} from "@warble/render";
import type { ClientPosition, CurveGridGeometry, GridBounds, GridPoint } from "./curve-grid-geometry";

const MIN_INSERT_GAP = 2 / 255;
const MIN_NEIGHBOUR_GAP = 1 / 255;

export interface CurveEditorHost {
  currentValue(): CurveEdit;
  requestUpdate(): void;
  emitChange(curve: CurveEdit): void;
  emitChannelReset(channel: CurveChannel): void;
}

export interface CurveGridSurface {
  getBoundingClientRect(): GridBounds;
  setPointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
}

export interface CurvePointer extends ClientPosition {
  readonly button: number;
  readonly pointerId: number;
}

/** Point editing of one curve channel at a time: insert, drag, remove, reset. Never changes the host value itself. */
export class CurveEditorController {
  activeChannel: CurveChannel = "rgb";

  /** Shadows the host value during a drag, because the host's own update arrives a frame after each step. */
  private draft: CurveEdit | null = null;
  private draggedIndex: number | null = null;
  private grabOffset: GridPoint = { x: 0, y: 0 };

  constructor(
    private readonly host: CurveEditorHost,
    private readonly geometry: CurveGridGeometry,
  ) {}

  get curve(): CurveEdit {
    return this.draft ?? this.host.currentValue();
  }

  get points(): readonly CurvePoint[] {
    return this.curve[this.activeChannel];
  }

  selectChannel(channel: CurveChannel): void {
    this.activeChannel = channel;
    this.host.requestUpdate();
  }

  resetChannel(channel: CurveChannel): void {
    const curve = this.curve;
    if (isCurveChannelIdentity(curve[channel])) return;
    this.draft = null;
    this.host.requestUpdate();
    this.host.emitChange({ ...curve, [channel]: identityCurveChannel() });
    this.host.emitChannelReset(channel);
  }

  /** Inserts a point under the pointer and starts dragging it. Returns whether the pointer was taken. */
  insertPoint(pointer: CurvePointer, grid: CurveGridSurface): boolean {
    if (pointer.button !== 0) return false;
    const position = this.geometry.fromClient(pointer, grid.getBoundingClientRect());
    const inserted = { x: this.geometry.fromGridX(position.x), y: this.geometry.fromGridY(position.y) };
    const points = this.points;
    if (points.some((point) => Math.abs(point.x - inserted.x) < MIN_INSERT_GAP)) return false;
    let index = 0;
    while (index < points.length && points[index].x < inserted.x) index++;
    this.beginDrag(index, { x: 0, y: 0 }, [...points.slice(0, index), inserted, ...points.slice(index)]);
    this.emitDraft();
    grid.setPointerCapture(pointer.pointerId);
    return true;
  }

  /** Starts dragging an existing point, keeping the pointer's offset to its centre. Returns whether the pointer was taken. */
  grabPoint(index: number, pointer: CurvePointer, grid: CurveGridSurface): boolean {
    if (pointer.button !== 0) return false;
    const points = this.points;
    const position = this.geometry.fromClient(pointer, grid.getBoundingClientRect());
    const offset = {
      x: this.geometry.toGridX(points[index].x) - position.x,
      y: this.geometry.toGridY(points[index].y) - position.y,
    };
    this.beginDrag(index, offset, points);
    grid.setPointerCapture(pointer.pointerId);
    return true;
  }

  dragTo(pointer: ClientPosition, grid: CurveGridSurface): void {
    if (this.draggedIndex === null) return;
    const index = this.draggedIndex;
    const position = this.geometry.fromClient(pointer, grid.getBoundingClientRect());
    const points = this.points;
    const moved = {
      x: this.allowedInput(points, index, this.geometry.fromGridX(position.x + this.grabOffset.x)),
      y: this.geometry.fromGridY(position.y + this.grabOffset.y),
    };
    this.replaceActivePoints(points.map((point, i) => (i === index ? moved : point)));
    this.emitDraft();
  }

  endDrag(pointer: { readonly pointerId: number }, grid: CurveGridSurface): void {
    if (this.draggedIndex === null) return;
    if (grid.hasPointerCapture(pointer.pointerId)) grid.releasePointerCapture(pointer.pointerId);
    this.draggedIndex = null;
    this.draft = null;
    this.host.requestUpdate();
  }

  /** The two end points anchor the curve and cannot be removed. */
  removePoint(index: number): void {
    const points = this.points;
    if (index === 0 || index === points.length - 1) return;
    this.replaceActivePoints(points.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /** End points stay on their edge but move freely in height; inner points stay between their neighbours. */
  private allowedInput(points: readonly CurvePoint[], index: number, input: number): number {
    if (index === 0) return 0;
    if (index === points.length - 1) return 1;
    const lowest = points[index - 1].x + MIN_NEIGHBOUR_GAP;
    const highest = points[index + 1].x - MIN_NEIGHBOUR_GAP;
    return Math.max(lowest, Math.min(highest, input));
  }

  private beginDrag(index: number, grabOffset: GridPoint, points: readonly CurvePoint[]): void {
    this.draggedIndex = index;
    this.grabOffset = grabOffset;
    this.replaceActivePoints(points);
  }

  private replaceActivePoints(points: readonly CurvePoint[]): void {
    this.draft = { ...this.curve, [this.activeChannel]: points };
    this.host.requestUpdate();
  }

  private emitDraft(): void {
    if (this.draft) this.host.emitChange(this.draft);
  }
}

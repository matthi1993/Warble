export class MenuPlacement {
  constructor(
    private readonly reservedWidth: number,
    private readonly reservedHeight: number,
  ) {}

  style(menu: { x: number; y: number }): string {
    const left = Math.max(0, Math.min(menu.x, window.innerWidth - this.reservedWidth));
    const top = Math.max(0, Math.min(menu.y, window.innerHeight - this.reservedHeight));
    return `left: ${left}px; top: ${top}px;`;
  }
}

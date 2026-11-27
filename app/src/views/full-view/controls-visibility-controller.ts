import type { FullViewEvents } from "./full-view-events";
import type { MenuController } from "./menu-controller";
import type { UpdateHost } from "./update-host";

export class ControlsVisibilityController {
  private controlsHidden = false;

  constructor(
    private readonly host: UpdateHost,
    private readonly menus: MenuController,
    private readonly events: Pick<FullViewEvents, "controlsVisibility">,
  ) {}

  get hidden(): boolean {
    return this.controlsHidden;
  }

  /** Takes over a value written to the element's public property, without announcing it. */
  adopt(hidden: boolean): void {
    this.controlsHidden = hidden;
  }

  hide(): void {
    this.controlsHidden = true;
    this.menus.close();
    this.announce();
  }

  show(): void {
    this.controlsHidden = false;
    this.announce();
  }

  toggle(): void {
    this.controlsHidden = !this.controlsHidden;
    this.menus.close();
    this.announce();
  }

  private announce(): void {
    this.host.requestUpdate();
    this.events.controlsVisibility(this.controlsHidden);
  }
}

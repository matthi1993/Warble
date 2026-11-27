import type { UpdateHost } from "./update-host";

export type FullViewMenu = "bg" | "frame" | "view" | "format" | "variant";

export class MenuController {
  private current: FullViewMenu | null = null;

  constructor(private readonly host: UpdateHost) {}

  get open(): FullViewMenu | null {
    return this.current;
  }

  toggle(menu: FullViewMenu): void {
    this.set(this.current === menu ? null : menu);
  }

  close(): void {
    this.set(null);
  }

  closeOnOutsideClick(eventPath: readonly EventTarget[], view: EventTarget): void {
    if (!this.current || !eventPath.includes(view)) return;
    const insideMenu = eventPath.some(
      (node) => node instanceof HTMLElement && node.classList.contains("menu-wrap"),
    );
    if (!insideMenu) this.close();
  }

  private set(menu: FullViewMenu | null): void {
    if (this.current === menu) return;
    this.current = menu;
    this.host.requestUpdate();
  }
}

/** Publishes the toolbar and footer heights as CSS variables, so immersive side panels can sit between them. */
export class ChromeSizeController {
  private observer: ResizeObserver | null = null;

  constructor(private readonly view: HTMLElement) {}

  observe(root: ParentNode): void {
    const toolbar = root.querySelector<HTMLElement>(".toolbar-wrap");
    const footer = root.querySelector<HTMLElement>(".bottombar-wrap");
    if (!toolbar || !footer) return;
    this.observer = new ResizeObserver(() => {
      this.view.style.setProperty("--pf-fv-toolbar-height", `${toolbar.getBoundingClientRect().height}px`);
      this.view.style.setProperty("--pf-fv-footer-height", `${footer.getBoundingClientRect().height}px`);
    });
    this.observer.observe(toolbar);
    this.observer.observe(footer);
  }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

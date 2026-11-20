import type { PfDetailPanel } from "@app/views/detail";
import type { PfFullView } from "@app/views/full-view";
import type { PfPhotoGrid } from "@app/views/grid";
import type { PfAppSidebar } from "./pf-app-sidebar";
import type { AlbumDropTarget, ShellViews } from "./shell-views";

export interface ShellElement extends HTMLElement {
  readonly renderRoot: HTMLElement | DocumentFragment;
  readonly updateComplete: Promise<boolean>;
}

type ThumbnailCard = HTMLElement & { path: string; reload?(): void };

export class ShellDom implements ShellViews {
  constructor(private readonly element: ShellElement) {}

  get updateComplete(): Promise<boolean> {
    return this.element.updateComplete;
  }

  grid(): PfPhotoGrid | null {
    return this.element.renderRoot.querySelector<PfPhotoGrid>("pf-photo-grid");
  }

  fullView(): PfFullView | null {
    return this.element.renderRoot.querySelector<PfFullView>("pf-full-view");
  }

  detailPanel(): PfDetailPanel | null {
    return this.element.renderRoot.querySelector<PfDetailPanel>("pf-detail-panel");
  }

  albumDropTarget(): AlbumDropTarget | null {
    return this.element.renderRoot.querySelector<PfAppSidebar>("pf-app-sidebar")?.albumDropTarget() ?? null;
  }

  reloadThumbnails(paths?: ReadonlySet<string>): void {
    const cards = this.grid()?.renderRoot.querySelectorAll<ThumbnailCard>("pf-thumbnail-card");
    cards?.forEach((card) => {
      if (!paths || paths.has(card.path)) card.reload?.();
    });
  }

  moveDragPreview(x: number, y: number): void {
    const preview = this.element.renderRoot.querySelector<HTMLElement>(".photo-drag-preview");
    if (!preview) return;
    preview.style.left = `${x}px`;
    preview.style.top = `${y}px`;
  }

  takeKeyboardFocus(): void {
    this.element.tabIndex = -1;
    this.element.focus();
  }
}

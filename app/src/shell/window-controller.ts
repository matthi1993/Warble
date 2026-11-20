import type { AppWindow } from "@app/platform/desktop";
import type { BrowserEnvironment } from "./browser-environment";
import type { ShellState } from "./shell-state";
import type { ShellViews } from "./shell-views";
import type { SidebarSectionsController } from "./sidebar-sections-controller";

const REFOCUS_DELAY_MS = 50;

export class WindowController {
  constructor(
    private readonly state: ShellState,
    private readonly appWindow: AppWindow,
    private readonly environment: Pick<BrowserEnvironment, "isIPad">,
    private readonly sections: SidebarSectionsController,
    private readonly views: Pick<ShellViews, "fullView" | "takeKeyboardFocus">,
  ) {}

  async setFullscreen(enable: boolean): Promise<void> {
    if (this.environment.isIPad) return;
    try {
      await this.appWindow.setFullscreen(enable);
      this.state.change({ windowFullscreen: enable });
    } catch (error) {
      console.error("setFullscreen failed", error);
      return;
    }
    if (enable) return;
    // Leaving fullscreen on macOS can leave the webview without keyboard focus, which breaks every shortcut.
    try {
      await this.appWindow.focus();
    } catch (error) {
      console.warn("setFocus failed", error);
    }
    setTimeout(() => this.views.takeKeyboardFocus(), REFOCUS_DELAY_MS);
  }

  async toggleFullscreen(): Promise<void> {
    await this.setFullscreen(!this.state.windowFullscreen);
  }

  toggleImmersive(): void {
    if (!this.state.immersiveView) this.hideSidebar();
    this.state.change({ immersiveView: !this.state.immersiveView });
  }

  async startSlideshow(): Promise<void> {
    const isIPad = this.environment.isIPad;
    if (!isIPad && !this.state.windowFullscreen) await this.setFullscreen(true);
    if (!isIPad && !this.state.windowFullscreen) return;
    this.hideSidebar();
    this.state.change({ immersiveView: true });
    this.views.fullView()?.startPresentation();
  }

  private hideSidebar(): void {
    this.sections.collapse("folders");
    this.state.change({ sidebarCollapsed: true, mobileSidebarOpen: false });
  }
}

import type { BrowserEnvironment } from "./browser-environment";
import type { ShellState } from "./shell-state";

export class PanelsController {
  constructor(
    private readonly state: ShellState,
    private readonly environment: Pick<BrowserEnvironment, "isNarrowScreen">,
  ) {}

  toggleSidebar(): void {
    const state = this.state;
    if (this.environment.isNarrowScreen) {
      state.change({ detailOpen: false, mobileSidebarOpen: !state.mobileSidebarOpen });
      return;
    }
    state.change({ sidebarCollapsed: !state.sidebarCollapsed });
  }

  closeMobileSidebar(): void {
    this.state.change({ mobileSidebarOpen: false });
  }

  toggleDetail(): void {
    this.state.change({ mobileSidebarOpen: false, detailOpen: !this.state.detailOpen });
  }

  closeDetail(): void {
    this.state.change({ detailOpen: false });
  }
}

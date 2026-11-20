import type { SidebarSection } from "./shell-fields";
import type { ShellState } from "./shell-state";

export class SidebarSectionsController {
  constructor(private readonly state: ShellState) {}

  toggle(section: SidebarSection): void {
    const expanded = new Set(this.state.expandedSections);
    if (expanded.has(section)) expanded.delete(section);
    else expanded.add(section);
    this.state.change({ expandedSections: expanded });
  }

  expand(section: SidebarSection): void {
    this.state.change({ expandedSections: new Set([...this.state.expandedSections, section]) });
  }

  collapse(section: SidebarSection): void {
    const expanded = new Set(this.state.expandedSections);
    expanded.delete(section);
    this.state.change({ expandedSections: expanded });
  }
}

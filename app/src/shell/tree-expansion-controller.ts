import type { UpdateHost } from "./shell-state";

export class TreeExpansionController {
  private expandedKeys = new Set<string>();

  constructor(private readonly host: UpdateHost) {}

  isExpanded(key: string): boolean {
    return this.expandedKeys.has(key);
  }

  toggle(key: string): void {
    const expanded = new Set(this.expandedKeys);
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    this.expandedKeys = expanded;
    this.host.requestUpdate();
  }
}

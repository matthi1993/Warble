import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { DateTreeNode } from "@warble/library";
import { sidebarDaysStyles } from "./sidebar-days.styles";
import { sidebarSectionStyles } from "./sidebar-section.styles";
import { TreeExpansionController } from "./tree-expansion-controller";
import "@ui/icons/pf-icon";

@customElement("pf-sidebar-days")
export class SidebarDays extends LitElement {
  static styles = [sidebarSectionStyles, sidebarDaysStyles];

  @property({ attribute: false }) nodes: DateTreeNode[] = [];
  @property({ type: String }) selectedKey: string | null = null;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) restoringCachedDates = false;
  @property({ type: Boolean }) hasPhotos = false;
  private readonly expansion = new TreeExpansionController(this);

  private renderNode(node: DateTreeNode, depth = 0): ReturnType<typeof html> {
    const expanded = this.expansion.isExpanded(node.key);
    return html`
      <div class=${`date-tree-row ${this.selectedKey === node.key ? "selected" : ""} ${depth === 0 ? "root" : ""}`}>
        ${node.children.length ? html`<button class="date-tree-toggle" type="button" aria-label=${`${expanded ? "Collapse" : "Expand"} ${node.label}`}
          aria-expanded=${expanded} @click=${() => this.expansion.toggle(node.key)}><pf-icon name="chevron-down"></pf-icon></button>`
          : html`<span class="date-tree-toggle"></span>`}
        <button class="date-tree-label" type="button" aria-current=${this.selectedKey === node.key ? "page" : "false"}
          @click=${() => this.dispatchEvent(new CustomEvent("date-select", { detail: { key: node.key }, bubbles: true, composed: true }))}>${node.label}</button>
        <span class="date-tree-count">${node.count}</span>
      </div>
      ${expanded && node.children.length ? html`<div class="date-tree-children">${node.children.map((child) => this.renderNode(child, depth + 1))}</div>` : null}
    `;
  }

  render() {
    return html`
      ${this.loading ? html`<div class="empty">${this.restoringCachedDates ? "Loading saved photo dates…" : "Reading photo dates…"}</div>` : null}
      ${this.nodes.map((node) => this.renderNode(node))}
      ${!this.loading && !this.hasPhotos ? html`<div class="empty">No photos indexed yet.</div>` : null}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-sidebar-days": SidebarDays;
  }
}

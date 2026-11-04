import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DateTreeNode } from "./date-tree";
import { sidebarSectionStyles } from "./sidebar-section-styles";
import "@ui/icons/pf-icon";

@customElement("pf-sidebar-days")
export class SidebarDays extends LitElement {
  static styles = [sidebarSectionStyles, css`
    .date-tree-row {
      display: flex;
      align-items: center;
      min-height: 30px;
      border-radius: var(--pf-radius-md);
      font-size: var(--pf-text-sm);
    }
    .date-tree-row:hover { background: var(--pf-surface-hover); }
    .date-tree-row.selected { background: var(--pf-accent-soft); color: var(--pf-accent-hover); box-shadow: inset 2px 0 var(--pf-accent); }
    .date-tree-row button { background: none; border: 0; color: inherit; cursor: pointer; font: inherit; }
    .date-tree-toggle { width: 24px; height: 30px; padding: 0; display: grid; place-items: center; }
    .date-tree-toggle pf-icon { width: 14px; height: 14px; }
    .date-tree-toggle[aria-expanded="false"] pf-icon { transform: rotate(-90deg); }
    .date-tree-label { flex: 1; min-width: 0; padding: var(--pf-space-1) var(--pf-space-2); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .date-tree-count { color: var(--pf-text-muted); font-size: var(--pf-text-xs); padding-right: var(--pf-space-2); }
    .date-tree-children { padding-left: var(--pf-space-3); margin-top: 2px; }
    .date-tree-row.root .date-tree-label { font-weight: 600; }
  `];

  @property({ attribute: false }) nodes: DateTreeNode[] = [];
  @property({ type: String }) selectedKey: string | null = null;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) restoringCachedDates = false;
  @property({ type: Boolean }) hasPhotos = false;
  @state() private expandedNodes = new Set<string>();

  private toggleNode(key: string): void {
    const expanded = new Set(this.expandedNodes);
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    this.expandedNodes = expanded;
  }

  private renderNode(node: DateTreeNode, depth = 0): ReturnType<typeof html> {
    const expanded = this.expandedNodes.has(node.key);
    return html`
      <div class=${`date-tree-row ${this.selectedKey === node.key ? "selected" : ""} ${depth === 0 ? "root" : ""}`}>
        ${node.children.length ? html`<button class="date-tree-toggle" type="button" aria-label=${`${expanded ? "Collapse" : "Expand"} ${node.label}`}
          aria-expanded=${expanded} @click=${() => this.toggleNode(node.key)}><pf-icon name="chevron-down"></pf-icon></button>`
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

import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "../icons/pf-icon";
import type { IconName } from "../icons/icon-paths";

type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "pf-theme";

function readStoredMode(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

// Apply stored mode as early as possible (module side-effect).
applyMode(readStoredMode());

@customElement("pf-theme-toggle")
export class PfThemeToggle extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      border-radius: var(--pf-radius-md);
      border: 1px solid var(--pf-border);
      background: var(--pf-surface);
      color: var(--pf-text-muted);
      cursor: pointer;
      transition: background var(--pf-transition), color var(--pf-transition),
        border-color var(--pf-transition);
    }
    button:hover {
      background: var(--pf-surface-hover);
      border-color: var(--pf-accent);
      color: var(--pf-accent-hover);
    }
    button:focus-visible {
      outline: 2px solid var(--pf-accent);
      outline-offset: 2px;
    }
    pf-icon {
      font-size: 1.05rem;
    }
  `;

  @state()
  private mode: ThemeMode = readStoredMode();

  private cycle = () => {
    const order: ThemeMode[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(this.mode) + 1) % order.length];
    this.mode = next;
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
    applyMode(next);
  };

  private get icon(): IconName {
    if (this.mode === "light") return "sun";
    if (this.mode === "dark") return "moon";
    return "monitor";
  }

  private get label(): string {
    if (this.mode === "light") return "Theme: Light (click for Dark)";
    if (this.mode === "dark") return "Theme: Dark (click for System)";
    return "Theme: System (click for Light)";
  }

  render() {
    return html`
      <button type="button" @click=${this.cycle} aria-label=${this.label} title=${this.label}>
        <pf-icon name=${this.icon}></pf-icon>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-theme-toggle": PfThemeToggle;
  }
}

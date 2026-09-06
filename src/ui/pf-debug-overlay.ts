/**
 * Floating debug overlay showing the Rust task pool state in real time.
 *
 * Toggled via the macOS Window menu (`debug-stats:toggle` event from
 * the menu handler). When visible, polls `get_task_stats` at ~5 Hz and
 * renders queued + running jobs with their priority, age, and label.
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface JobSnapshot {
  job_id: number;
  label: string;
  priority: "urgent" | "foreground" | "nearby" | "background";
  age_ms: number;
  running: boolean;
  cancelled: boolean;
}

interface FinishedJob {
  job_id: number;
  label: string;
  priority: "urgent" | "foreground" | "nearby" | "background";
  queued_ms: number;
  run_ms: number;
  cancelled: boolean;
}

interface PoolStats {
  fg_workers: number;
  bg_workers: number;
  fg_queued: number;
  nearby_queued: number;
  bg_queued: number;
  fg_running: number;
  nearby_running: number;
  bg_running: number;
  total_submitted: number;
  total_completed: number;
  total_cancelled: number;
  jobs: JobSnapshot[];
  recent: FinishedJob[];
}

const POLL_INTERVAL_MS = 200;
const RECENT_DISPLAY_LIMIT = 200;

@customElement("pf-debug-overlay")
export class PfDebugOverlay extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      top: var(--pf-debug-top, auto);
      left: var(--pf-debug-left, auto);
      bottom: var(--pf-debug-bottom, 16px);
      right: var(--pf-debug-right, 16px);
      width: min(380px, calc(100vw - 32px));
      max-height: min(420px, calc(100vh - 32px));
      z-index: 13000;
      display: none;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #e8e8e8;
      background: rgba(20, 20, 22, 0.92);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      overflow: hidden;
      user-select: text;
    }
    :host([open]) {
      display: flex;
      flex-direction: column;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
      cursor: move;
      user-select: none;
    }
    header .title {
      flex: 1;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-size: 10px;
      color: #b8b8b8;
    }
    header button {
      all: unset;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      color: #b8b8b8;
    }
    header button:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }
    @media (pointer: coarse) {
      header { min-height: 32px; }
      header button { padding: 8px 10px; }
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 2px 12px;
      padding: 6px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      flex: 0 0 auto;
    }
    .summary .row {
      display: flex;
      justify-content: space-between;
    }
    .summary .label {
      color: #888;
    }
    .summary .value {
      color: #f0f0f0;
      font-variant-numeric: tabular-nums;
    }
    .jobs {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 2px 0;
    }
    .empty {
      padding: 12px;
      text-align: center;
      color: #666;
    }
    .job {
      display: grid;
      grid-template-columns: 56px 1fr auto;
      gap: 6px;
      padding: 3px 10px;
      align-items: baseline;
    }
    .job + .job {
      border-top: 1px dashed rgba(255, 255, 255, 0.05);
    }
    .job.running-row {
      background: rgba(120, 200, 120, 0.06);
    }
    .pri {
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 1px 4px;
      border-radius: 3px;
      text-align: center;
      align-self: center;
    }
    .pri.urgent {
      background: rgba(255, 92, 92, 0.18);
      color: #ff8484;
    }
    .pri.foreground {
      background: rgba(120, 180, 255, 0.16);
      color: #9ec5ff;
    }
    .pri.nearby {
      background: rgba(187, 134, 252, 0.18);
      color: #d2adff;
    }
    .pri.background {
      background: rgba(160, 160, 160, 0.16);
      color: #c8c8c8;
    }
    .label {
      color: #f0f0f0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .label.cancelled {
      color: #888;
      text-decoration: line-through;
    }
    .state {
      font-size: 10px;
      color: #888;
      font-variant-numeric: tabular-nums;
    }
    .state.running {
      color: #6fdc6f;
    }
    .state.queued {
      color: #ffd066;
    }
    .state.fast {
      color: #6fdc6f;
    }
    .state.slow {
      color: #ffb454;
    }
    .state.very-slow {
      color: #ff7a7a;
    }
  `;

  @state()
  private open = false;

  @state()
  private stats: PoolStats | null = null;

  private pollTimer: number | null = null;
  private unlistenToggle: UnlistenFn | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragging = false;

  connectedCallback(): void {
    super.connectedCallback();
    void listen("debug-stats:toggle", () => {
      this.open = !this.open;
      this.toggleAttribute("open", this.open);
      if (this.open) this.startPolling();
      else this.stopPolling();
    }).then((un) => {
      this.unlistenToggle = un;
    });
  }

  /** Open from touch-only surfaces such as the iPad settings sheet. */
  show(): void {
    this.open = true;
    this.toggleAttribute("open", true);
    this.startPolling();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopPolling();
    this.unlistenToggle?.();
    this.unlistenToggle = null;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
  }

  private startPolling() {
    if (this.pollTimer !== null) return;
    const tick = async () => {
      try {
        this.stats = await invoke<PoolStats>("get_task_stats");
      } catch (err) {
        console.warn("get_task_stats failed", err);
      }
    };
    void tick();
    this.pollTimer = window.setInterval(tick, POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private close = () => {
    this.open = false;
    this.toggleAttribute("open", false);
    this.stopPolling();
  };

  private onHeaderPointerDown = (ev: PointerEvent) => {
    // Ignore drags that start on the close button.
    if ((ev.target as HTMLElement).closest("button")) return;
    ev.preventDefault();
    const rect = this.getBoundingClientRect();
    this.dragOffsetX = ev.clientX - rect.left;
    this.dragOffsetY = ev.clientY - rect.top;
    this.dragging = true;
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (!this.dragging) return;
    const left = Math.max(
      0,
      Math.min(window.innerWidth - this.offsetWidth, ev.clientX - this.dragOffsetX)
    );
    const top = Math.max(
      0,
      Math.min(window.innerHeight - this.offsetHeight, ev.clientY - this.dragOffsetY)
    );
    this.style.setProperty("--pf-debug-left", `${left}px`);
    this.style.setProperty("--pf-debug-top", `${top}px`);
    this.style.setProperty("--pf-debug-right", "auto");
    this.style.setProperty("--pf-debug-bottom", "auto");
  };

  private onPointerUp = () => {
    this.dragging = false;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
  };

  render() {
    if (!this.open) return nothing;
    const s = this.stats;
    // Combined list: in-flight first (running, then queued), then recent
    // history. Each entry is normalised into a single row shape.
    const rows = s ? buildRows(s) : [];
    return html`
      <header @pointerdown=${this.onHeaderPointerDown}>
        <span class="title">Task Pool</span>
        <button @click=${this.close} aria-label="Close">×</button>
      </header>
      ${s
        ? html`
            <div class="summary">
              <div class="row">
                <span class="label">FG</span>
                <span class="value">
                  ${s.fg_running}/${s.fg_workers} · q${s.fg_queued}
                </span>
              </div>
              <div class="row">
                <span class="label">Near</span>
                <span class="value">${s.nearby_running} · q${s.nearby_queued}</span>
              </div>
              <div class="row">
                <span class="label">BG</span>
                <span class="value">
                  ${s.bg_running}/${s.bg_workers} · q${s.bg_queued}
                </span>
              </div>
              <div class="row">
                <span class="label">Submitted</span>
                <span class="value">${s.total_submitted}</span>
              </div>
              <div class="row">
                <span class="label">Completed</span>
                <span class="value">${s.total_completed}</span>
              </div>
              <div class="row">
                <span class="label">Cancelled</span>
                <span class="value">${s.total_cancelled}</span>
              </div>
              <div class="row">
                <span class="label">In flight</span>
                <span class="value">${s.jobs.length}</span>
              </div>
            </div>
            <div class="jobs">
              ${rows.length === 0
                ? html`<div class="empty">idle</div>`
                : rows.map(
                    (r) => html`
                      <div class="job ${r.kind === "running" ? "running-row" : ""}">
                        <span class="pri ${r.priority}">${priLabel(r.priority)}</span>
                        <span class="label ${r.cancelled ? "cancelled" : ""}">
                          #${r.job_id} ${r.label}
                        </span>
                        <span class="state ${r.stateClass}">${r.stateText}</span>
                      </div>
                    `
                  )}
            </div>
          `
        : html`<div class="empty">loading…</div>`}
    `;
  }
}

interface DisplayRow {
  kind: "running" | "queued" | "finished";
  job_id: number;
  label: string;
  priority: JobSnapshot["priority"];
  cancelled: boolean;
  stateText: string;
  stateClass: string;
}

function buildRows(s: PoolStats): DisplayRow[] {
  const rows: DisplayRow[] = [];
  // Active jobs: running first, then queued. Each input list comes from
  // the Rust snapshot already ordered by submission time.
  const running = s.jobs.filter((j) => j.running);
  const queued = s.jobs.filter((j) => !j.running);
  for (const j of running) {
    rows.push({
      kind: "running",
      job_id: j.job_id,
      label: j.label,
      priority: j.priority,
      cancelled: j.cancelled,
      stateText: `run ${formatAge(j.age_ms)}`,
      stateClass: "running",
    });
  }
  for (const j of queued) {
    rows.push({
      kind: "queued",
      job_id: j.job_id,
      label: j.label,
      priority: j.priority,
      cancelled: j.cancelled,
      stateText: `queue ${formatAge(j.age_ms)}`,
      stateClass: "queued",
    });
  }
  for (const j of s.recent.slice(0, RECENT_DISPLAY_LIMIT)) {
    const queueSuffix = j.queued_ms > 0 ? ` +${formatAge(j.queued_ms)}q` : "";
    rows.push({
      kind: "finished",
      job_id: j.job_id,
      label: j.label,
      priority: j.priority,
      cancelled: j.cancelled,
      stateText: `${formatAge(j.run_ms)}${queueSuffix}`,
      stateClass: runClass(j.run_ms),
    });
  }
  return rows;
}

function priLabel(p: JobSnapshot["priority"]): string {
  switch (p) {
    case "urgent":
      return "URG";
    case "foreground":
      return "FG";
    case "nearby":
      return "NEAR";
    case "background":
      return "BG";
  }
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function runClass(ms: number): string {
  if (ms < 200) return "fast";
  if (ms < 2000) return "";
  if (ms < 5000) return "slow";
  return "very-slow";
}

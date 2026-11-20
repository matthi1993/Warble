import { css } from "lit";

export const settingsStyles = css`
  :host { position: fixed; inset: 0; z-index: 12000; pointer-events: none; }
  .backdrop { position: absolute; inset: 0; display: grid; place-items: center; padding: 20px;
    background: rgba(0,0,0,.55); pointer-events: auto; }
  .sheet { width: min(680px, 100%); max-height: min(860px, calc(100dvh - 40px)); overflow: auto;
    box-sizing: border-box; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-lg);
    background: var(--pf-surface); color: var(--pf-text); box-shadow: 0 20px 60px rgba(0,0,0,.45); }
  header, footer { position: sticky; background: var(--pf-surface); display: flex; align-items: center;
    gap: 12px; padding: 16px 18px; z-index: 1; }
  header { top: 0; border-bottom: 1px solid var(--pf-border); }
  footer { bottom: 0; justify-content: flex-end; border-top: 1px solid var(--pf-border); }
  h2 { margin: 0; flex: 1; font-size: var(--pf-text-lg); }
  main { padding: 20px; display: grid; gap: 16px; background: var(--pf-bg); }
  section { display: grid; gap: 12px; padding: 18px; border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-lg); background: var(--pf-surface); }
  h3 { margin: 0; font-size: var(--pf-text-sm); font-weight: 650; }
  .heading { display: grid; gap: 5px; }
  .row + .row { border-top: 1px solid var(--pf-border); padding-top: 12px; }
  .storage-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .storage-stat { padding: 12px; background: var(--pf-surface-2); border-radius: var(--pf-radius-md); }
  .storage-stat strong { display: block; font-size: var(--pf-text-sm); margin-bottom: 4px; }
  .storage-stat span { color: var(--pf-text-muted); font-size: var(--pf-text-xs); }
  .workspace { border-color: color-mix(in srgb, var(--pf-danger) 25%, var(--pf-border)); }
  @media (max-width: 480px) {
    .backdrop { padding: 10px; }
    .sheet { max-height: calc(100dvh - 20px); }
    main { padding: 12px; }
    section { padding: 14px; }
    .row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    input[type=checkbox] { justify-self: start; }
    select { width: 100%; }
  }
  .note { margin: 0; color: var(--pf-text-muted); font-size: var(--pf-text-xs); line-height: 1.45; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center;
    min-height: 42px; }
  label { font-size: var(--pf-text-sm); }
  label small { display: block; margin-top: 3px; color: var(--pf-text-muted); line-height: 1.35; }
  input[type=checkbox] { width: 20px; height: 20px; accent-color: var(--pf-accent); }
  select, button { min-height: 38px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-md);
    background: var(--pf-surface-2); color: var(--pf-text); padding: 0 11px; font: inherit; }
  button { cursor: pointer; touch-action: manipulation; }
  button.primary { background: var(--pf-accent); color: var(--pf-accent-contrast, white); border-color: transparent; }
  button.danger { color: var(--pf-danger); border-color: var(--pf-danger); }
  button:disabled { opacity: .55; cursor: default; }
  .preset-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .feedback { margin: 0; color: var(--pf-text-muted); font-size: var(--pf-text-xs); }
  .error { color: var(--pf-danger); font-size: var(--pf-text-xs); }
  @media (pointer: coarse) { select, button { min-height: 46px; } .row { min-height: 50px; } }
`;

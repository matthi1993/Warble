import { css } from "lit";

export const metadataEditorStyles = css`
  :host { position: fixed; inset: 0; z-index: 12000; }
  .backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, .65); }
  .sheet { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: min(480px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 32px));
    overflow-y: auto; box-sizing: border-box; border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-lg); background: var(--pf-surface); color: var(--pf-text);
    box-shadow: 0 24px 80px rgba(0,0,0,.5); }
  header, footer { display: flex; align-items: center; justify-content: space-between;
    gap: var(--pf-space-3); padding: var(--pf-space-3) var(--pf-space-4); }
  header { border-bottom: 1px solid var(--pf-border); }
  footer { border-top: 1px solid var(--pf-border); justify-content: flex-end; }
  h2 { font-size: var(--pf-text-lg); margin: 0; }
  main { display: grid; gap: var(--pf-space-3); padding: var(--pf-space-4); }
  p { color: var(--pf-text-muted); font-size: var(--pf-text-sm); margin: 0; }
  label { display: grid; gap: 5px; font-size: var(--pf-text-sm); }
  input { box-sizing: border-box; width: 100%; min-height: 36px; padding: 7px 10px;
    border: 1px solid var(--pf-border); border-radius: var(--pf-radius-md);
    background: var(--pf-surface-2); color: var(--pf-text); font: inherit; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--pf-accent); outline-offset: 2px; }
  button { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-md);
    padding: 8px 12px; background: var(--pf-surface-2); color: var(--pf-text);
    font: inherit; cursor: pointer; }
  button.primary { border-color: var(--pf-accent); background: var(--pf-accent); color: var(--pf-accent-contrast); }
  button:disabled { opacity: .55; cursor: default; }
  .error { color: var(--pf-danger); }
`;

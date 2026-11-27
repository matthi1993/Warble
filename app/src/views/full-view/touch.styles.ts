import { css } from "lit";

export const touchStyles = css`
  /* Touch screens keep the same design but get Apple's 44pt targets and respect the safe areas. */
  @media (pointer: coarse) {
    :host([immersive]) .toolbar {
      padding-top: max(var(--pf-space-2), env(safe-area-inset-top));
      padding-left: max(var(--pf-space-3), env(safe-area-inset-left));
      padding-right: max(var(--pf-space-3), env(safe-area-inset-right));
    }
    :host([immersive]) .bottombar {
      padding-bottom: max(var(--pf-space-2), env(safe-area-inset-bottom));
      padding-left: max(var(--pf-space-3), env(safe-area-inset-left));
      padding-right: max(var(--pf-space-3), env(safe-area-inset-right));
    }
    .menu-trigger,
    .menu-item,
    .footer-btn {
      min-height: 44px;
    }
    .edit-side-rail {
      flex-basis: 44px;
      width: 44px;
    }
    :host([immersive]) .edit-side-rail {
      width: 44px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .footer-btn-spinner {
      animation-duration: 1.4s;
    }
  }
`;

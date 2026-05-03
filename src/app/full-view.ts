/**
 * Modal full-screen photo viewer.
 *
 * Loads encoded image bytes via {@link "../ui/photos/pf-image-canvas"} which
 * paints a thumbnail first and then swaps in the full decoded bitmap, plus
 * offers wheel zoom, drag-pan, and double-click 100%↔fit.
 *
 * Close is intentionally idempotent and bullet-proof:
 *   - ESC always closes in one keypress (we never trap it on the way out).
 *   - The toolbar X is a plain native `<button>` (no shadow-DOM custom
 *     element layered on top), so click/touch events can't be eaten by a
 *     web-component's internals.
 */
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import type { Photo } from "./types";
import {
  availableFormats,
  availableVariants,
  fileForSelection,
  primarySelection,
  type PhotoFormat,
} from "./photo-variant";
import {
  getVariantOverride,
  setVariantOverride,
  subscribeVariantOverrides,
} from "./variant-store";
import { prefetchHdImages } from "./hd-image-cache";
import {
  ASPECT_RATIO_LABELS,
  ASPECT_RATIO_VALUES,
  defaultTone,
  flushPhotoEdit,
  getPhotoEdit,
  hasEdits,
  isToneZero,
  setPhotoCrop,
  setPhotoTone,
  subscribePhotoEdits,
  TONE_KEYS,
  type AspectRatioKey,
  type CropEdit,
  type Orientation,
  type ToneEdit,
} from "./edit-store";
import "../ui/controls/pf-icon-button";
import "../ui/controls/pf-slider";
import "../ui/icons/pf-icon";
import "../ui/photos/pf-image-canvas";
import type {
  ImageFit,
  ImageSizing,
  PfImageCanvas,
} from "../ui/photos/pf-image-canvas";

type BgColor = "black" | "grey" | "white";

/** Compare two crop edits for equality, with a small epsilon on the
 *  floating-point frame coordinates and rotation. Used to dedupe
 *  no-op writes that the canvas dispatches on benign prop refreshes. */
function cropEditsEqual(a: CropEdit, b: CropEdit): boolean {
  const eps = 1e-4;
  return (
    a.aspectRatio === b.aspectRatio &&
    a.orientation === b.orientation &&
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps &&
    Math.abs((a.rotation ?? 0) - (b.rotation ?? 0)) < eps
  );
}

interface ExifMetadata {
  cameraMake?: string | null;
  cameraModel?: string | null;
  cameraSerial?: string | null;
  software?: string | null;
  lensMake?: string | null;
  lensModel?: string | null;
  lensSerial?: string | null;
  iso?: string | null;
  shutterSpeed?: string | null;
  aperture?: string | null;
  focalLength?: string | null;
  focalLength35mm?: string | null;
  exposureCompensation?: string | null;
  exposureProgram?: string | null;
  exposureMode?: string | null;
  meteringMode?: string | null;
  whiteBalance?: string | null;
  flash?: string | null;
  pixelWidth?: number | null;
  pixelHeight?: number | null;
  orientation?: string | null;
  colorSpace?: string | null;
  dateTaken?: string | null;
  artist?: string | null;
  copyright?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAltitude?: string | null;
}

@customElement("pf-full-view")
export class PfFullView extends LitElement {
  static styles = css`
    :host {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--pf-fv-bg, #000);
      color: var(--pf-fv-fg, #fff);
      outline: none;
    }
    :host([fullscreen]) {
      position: fixed;
      inset: 0;
      z-index: 1000;
      width: 100vw;
      height: 100vh;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2) var(--pf-space-3);
      background: var(--pf-surface);
      color: var(--pf-text);
      border-bottom: 1px solid var(--pf-border);
    }
    .toolbar-left,
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      flex: 1 1 0;
      min-width: 0;
    }
    .toolbar-right {
      justify-content: flex-end;
    }
    .toolbar-center {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      flex: 0 0 auto;
    }
    /* Symmetric placeholder bar at the bottom — same vertical footprint
       as the toolbar so the stage's centre lines up with the viewport's
       centre. When the toolbar fades on idle, this bar fades with it,
       keeping the image visually anchored. */
    .bottombar {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2) var(--pf-space-3);
      background: var(--pf-surface);
      color: var(--pf-text);
      border-top: 1px solid var(--pf-border);
      min-height: 32px;
      box-sizing: border-box;
    }
    .bottombar .menu-popup {
      top: auto;
      bottom: calc(100% + 6px);
    }
    .filename {
      font-size: var(--pf-text-sm);
      font-weight: 600;
      color: var(--pf-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1 1 auto;
      min-width: 0;
    }
    .counter {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      font-variant-numeric: tabular-nums;
    }
    .group {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: var(--pf-surface-2);
      border-radius: var(--pf-radius-md);
    }
    .format-switch {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: var(--pf-surface-2);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
    }
    .format-switch button {
      background: transparent;
      color: var(--pf-text);
      border: none;
      padding: 2px 10px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
      white-space: nowrap;
    }
    .format-switch button[aria-pressed="true"] {
      background: var(--pf-accent-soft);
      color: var(--pf-accent);
    }
    .menu-wrap {
      position: relative;
      display: inline-flex;
    }
    .menu-trigger {
      background: var(--pf-surface-2);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      padding: 4px 10px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      border-radius: var(--pf-radius-md);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .menu-trigger:hover {
      background: var(--pf-surface-hover);
      border-color: var(--pf-accent);
    }
    .menu-trigger .swatch {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 1px solid var(--pf-border-strong);
    }
    .menu-popup {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      background: var(--pf-surface);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      box-shadow: var(--pf-shadow-md);
      padding: 4px;
      z-index: 5;
      min-width: 140px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .menu-item {
      background: transparent;
      color: var(--pf-text);
      border: none;
      padding: 6px 10px;
      text-align: left;
      font-size: var(--pf-text-xs);
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .menu-item:hover {
      background: var(--pf-surface-hover);
    }
    .menu-item[aria-pressed="true"] {
      background: var(--pf-accent-soft);
      color: var(--pf-accent);
    }
    .edit-mark {
      color: var(--pf-accent);
      font-weight: 700;
      line-height: 1;
    }
    .swatch {
      width: 1.4rem;
      height: 1.4rem;
      border-radius: var(--pf-radius-sm);
      border: 1px solid var(--pf-border-strong);
      cursor: pointer;
      padding: 0;
    }
    .swatch.black {
      background: #000;
    }
    .swatch.grey {
      background: #808080;
    }
    .swatch.white {
      background: #fff;
    }
    .swatch[aria-pressed="true"] {
      outline: 2px solid var(--pf-accent);
      outline-offset: 1px;
    }
    .seg {
      background: transparent;
      color: var(--pf-text);
      border: none;
      padding: 4px 10px;
      font-size: var(--pf-text-xs);
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
    }
    .seg[aria-pressed="true"] {
      background: var(--pf-accent-soft);
      color: var(--pf-accent);
    }
    .stage {
      flex: 1;
      position: relative;
      overflow: hidden;
      background: var(--pf-fv-bg, #000);
      min-height: 0;
    }
    /* Row that holds the stage and the floating side panel.
       The panel is positioned absolutely within this row so the
       stage always renders at full width regardless of whether the
       panel is currently visible. */
    .stage-row {
      flex: 1;
      display: flex;
      min-height: 0;
      min-width: 0;
      position: relative;
    }
    pf-image-canvas {
      position: absolute;
      inset: 0;
    }
    /* In fullscreen, the toolbar and bottombar overlay the stage so that
       fit/proof calculations operate on the full viewport, not the
       reduced area left between the bars. The bars still fade out on
       idle but never resize the canvas underneath. */
    :host([fullscreen]) .toolbar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 3;
      background: color-mix(in srgb, var(--pf-surface) 88%, transparent);
      backdrop-filter: blur(6px);
    }
    :host([fullscreen]) .bottombar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 3;
      background: color-mix(in srgb, var(--pf-surface) 88%, transparent);
      backdrop-filter: blur(6px);
    }
    .nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 48px;
      height: 48px;
      border-radius: 999px;
      border: none;
      background: rgba(0, 0, 0, 0.45);
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background var(--pf-transition);
      z-index: 2;
    }
    .nav:hover {
      background: rgba(0, 0, 0, 0.75);
    }
    .nav:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .nav.prev {
      left: var(--pf-space-3);
    }
    .nav.next {
      right: var(--pf-space-3);
    }
    .nav pf-icon {
      font-size: 1.5rem;
    }
    /* Native close button, never a custom element — guarantees clicks
       reach this handler even if shadow-DOM children get weird. */
    .close-btn {
      background: var(--pf-surface-2);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
    }
    .close-btn:hover {
      background: var(--pf-surface-hover);
      border-color: var(--pf-accent);
    }
    .close-btn svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
    }
    .hint {
      position: absolute;
      bottom: var(--pf-space-3);
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.6);
      color: rgba(255, 255, 255, 0.85);
      font-size: var(--pf-text-xs);
      padding: 4px 10px;
      border-radius: var(--pf-radius-sm);
      pointer-events: none;
      opacity: 0;
      transition: opacity 200ms ease;
    }
    .stage:hover .hint {
      opacity: 1;
    }
    :host([fullscreen][idle]) .toolbar,
    :host([fullscreen][idle]) .bottombar,
    :host([fullscreen][idle]) .nav,
    :host([fullscreen][idle]) .hint {
      opacity: 0;
      pointer-events: none;
    }
    .toolbar,
    .bottombar,
    .nav,
    .hint {
      transition: opacity 200ms ease;
    }
    :host([fullscreen][idle]) {
      cursor: none;
    }
    .edit-btn {
      background: var(--pf-surface-2);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      cursor: pointer;
      transition: background var(--pf-transition);
    }
    .edit-btn:hover {
      background: var(--pf-surface-hover);
      border-color: var(--pf-accent);
    }
    .edit-btn[aria-pressed="true"] {
      background: var(--pf-accent);
      color: var(--pf-on-accent);
      border-color: transparent;
    }
    .edit-btn pf-icon {
      font-size: 1rem;
    }
    /* Sub-toolbar that appears directly below the main toolbar while
       editing. In windowed mode it sits in the document flow between
       the main toolbar and the stage; in fullscreen the main toolbar
       floats over the stage so we float this one too, anchored just
       below. */
    .edit-toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2) var(--pf-space-3);
      background: #181818;
      color: #fff;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      flex-wrap: wrap;
    }
    .edit-toolbar .spacer {
      flex: 1 1 auto;
    }
    :host([fullscreen]) .edit-toolbar {
      position: absolute;
      top: 49px; /* match toolbar height */
      left: 0;
      right: 0;
      z-index: 3;
      background: rgba(24, 24, 24, 0.92);
      backdrop-filter: blur(6px);
    }
    :host([fullscreen][idle]) .edit-toolbar {
      opacity: 0;
      pointer-events: none;
    }
    .edit-toolbar .edit-group {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: var(--pf-radius-md);
    }
    .edit-toolbar .edit-group button {
      background: transparent;
      color: #fff;
      border: none;
      padding: 4px 10px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
      white-space: nowrap;
    }
    .edit-toolbar .edit-group button:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .edit-toolbar .edit-group button[aria-pressed="true"] {
      background: rgba(255, 255, 255, 0.22);
    }
    .edit-toolbar .edit-action {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: var(--pf-radius-md);
      padding: 4px 12px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      cursor: pointer;
    }
    .edit-toolbar .edit-action:hover {
      background: rgba(255, 255, 255, 0.18);
    }
    .edit-toolbar .edit-action.primary {
      background: var(--pf-accent, #4a90e2);
      border-color: transparent;
    }
    .edit-toolbar .edit-action.danger {
      color: #ff8080;
      border-color: rgba(255, 128, 128, 0.4);
    }
    .edit-toolbar .sep {
      width: 1px;
      height: 20px;
      background: rgba(255, 255, 255, 0.16);
    }
    .edit-toolbar .tool-btn {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--pf-radius-md);
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      cursor: pointer;
      transition: background var(--pf-transition);
    }
    .edit-toolbar .tool-btn:hover {
      background: rgba(255, 255, 255, 0.16);
    }
    .edit-toolbar .tool-btn:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .edit-toolbar .tool-btn:disabled:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .edit-toolbar .tool-btn[aria-pressed="true"] {
      background: var(--pf-accent, #4a90e2);
      border-color: transparent;
    }
    .edit-toolbar .tool-btn.primary {
      background: var(--pf-accent, #4a90e2);
      border-color: transparent;
    }
    .edit-toolbar .tool-btn.primary:hover {
      background: var(--pf-accent-hover, #4a90e2);
    }
    .edit-toolbar .tool-btn pf-icon {
      font-size: 1rem;
    }
    .edit-toolbar,
    .edit-btn {
      transition: opacity 200ms ease;
    }
    /* Right-side editor panel: a floating overlay anchored to the
       right edge of the stage-row in both windowed and fullscreen
       modes. It only becomes visible (and clickable) once the user
       hovers near the right edge or moves over the panel itself; the
       overlay also collapses immediately when the cursor leaves the
       rail+panel area in fullscreen. */
    .edit-side-panel {
      flex: 0 0 280px;
      max-width: 90vw;
      background: var(--pf-surface);
      border-left: 1px solid var(--pf-border);
      color: var(--pf-text);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
      min-height: 0;
    }
    /* Permanent thin rail that hosts the panel's expand/collapse
       toggle. Mirrors the folder sidebar's left rail — the toggle
       lives with the panel rather than in the main toolbar so the
       affordance and the panel feel like a unit. */
    .edit-side-rail {
      flex: 0 0 32px;
      border-left: 1px solid var(--pf-border);
      background: var(--pf-surface);
      color: var(--pf-text);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: var(--pf-space-2);
      box-sizing: border-box;
    }
    /* In windowed mode the panel is in flex flow alongside the stage
       and is shown only when the user has explicitly expanded it via
       the rail's toggle. The rail itself stays visible. */
    :host(:not([fullscreen]):not([edit-panel-open])) .edit-side-panel {
      display: none;
    }
    /* In fullscreen, float over the stage and fade in/out via the
       edit-panel-visible host attribute. Both rail and panel are
       part of the same overlay. */
    :host([fullscreen]) .edit-side-rail,
    :host([fullscreen]) .edit-side-panel {
      position: absolute;
      top: 49px;
      bottom: 49px;
      flex: none;
      z-index: 5;
      background: color-mix(in srgb, var(--pf-surface) 92%, transparent);
      backdrop-filter: blur(6px);
      opacity: 0;
      transform: translateX(8px);
      pointer-events: none;
      transition: opacity 200ms ease, transform 200ms ease;
    }
    :host([fullscreen]) .edit-side-rail {
      right: 280px;
      width: 32px;
      height: auto;
    }
    :host([fullscreen]) .edit-side-panel {
      right: 0;
      width: 280px;
    }
    :host([fullscreen][edit-panel-visible]) .edit-side-rail,
    :host([fullscreen][edit-panel-visible]) .edit-side-panel {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }
    .edit-side-panel-body {
      flex: 1 1 auto;
      /* min-height: 0 lets this flex item shrink below its content
         height so overflow-y can actually scroll. Without it, the
         cards push the body taller than the panel and visually
         collide with the footer / each other. */
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2);
    }
    /* Edit cards keep their natural (open) height — no flex-shrink —
       so opening a card simply makes the body scroll instead of
       squashing siblings. This is what keeps the Basic edits panel
       reachable while the Crop card is expanded. */
    .edit-side-panel-body > .edit-card {
      flex: 0 0 auto;
    }
    /* Footer with Before/After (left) and Revert-all (right). */
    .edit-side-panel-footer {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2);
      border-top: 1px solid var(--pf-border);
      background: var(--pf-surface-2);
    }
    .edit-side-panel-footer .footer-btn {
      background: var(--pf-surface);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      padding: 4px 10px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background var(--pf-transition);
    }
    .edit-side-panel-footer .footer-btn:hover {
      background: var(--pf-surface-hover);
      border-color: var(--pf-accent);
    }
    .edit-side-panel-footer .footer-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .edit-side-panel-footer .footer-btn:disabled:hover {
      background: var(--pf-surface);
      border-color: var(--pf-border);
    }
    .edit-side-panel-footer .footer-btn[aria-pressed="true"] {
      background: var(--pf-accent);
      color: var(--pf-on-accent);
      border-color: transparent;
    }
    .edit-side-panel-footer .footer-btn pf-icon {
      font-size: 0.95rem;
    }
    /* Reset button styling — reuse the .tool-btn look from the
       former edit toolbar so the visual remains familiar. */
    .edit-side-panel .tool-btn {
      background: var(--pf-surface-2);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      cursor: pointer;
      transition: background var(--pf-transition);
    }
    .edit-side-panel .tool-btn:hover {
      background: var(--pf-surface-hover);
      border-color: var(--pf-accent);
    }
    .edit-side-panel .tool-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .edit-side-panel .tool-btn:disabled:hover {
      background: var(--pf-surface-2);
      border-color: var(--pf-border);
    }
    .edit-side-panel .tool-btn pf-icon {
      font-size: 1rem;
    }
    /* Aspect-ratio + orientation buttons: same visual as the old
       edit-toolbar groups, but stacked vertically inside the card
       and allowed to wrap. */
    .edit-side-panel .edit-group {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: var(--pf-surface-2);
      border-radius: var(--pf-radius-md);
    }
    .edit-side-panel .edit-group.edit-group-wrap {
      flex-wrap: wrap;
    }
    .edit-side-panel .edit-group button {
      background: transparent;
      color: var(--pf-text);
      border: none;
      padding: 4px 10px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
      white-space: nowrap;
    }
    .edit-side-panel .edit-group button:hover {
      background: var(--pf-surface-hover);
    }
    .edit-side-panel .edit-group button[aria-pressed="true"] {
      background: var(--pf-accent-soft);
      color: var(--pf-accent);
    }
    .edit-side-panel .crop-tools-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--pf-space-3);
      margin-top: var(--pf-space-1);
    }
    .edit-side-panel .crop-tool-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: var(--pf-surface-2);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      cursor: pointer;
      transition:
        background 80ms ease,
        border-color 80ms ease;
    }
    .edit-side-panel .crop-tool-btn:hover {
      background: var(--pf-surface-hover);
      border-color: var(--pf-accent);
    }
    .edit-side-panel .crop-tool-btn[aria-pressed="true"] {
      background: var(--pf-accent-soft);
      border-color: var(--pf-accent);
      color: var(--pf-accent);
    }
    .edit-side-panel .crop-tool-btn pf-icon {
      width: 18px;
      height: 18px;
    }
    .edit-side-panel .rotation-row {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      margin-top: var(--pf-space-1);
    }
    .edit-side-panel .rotation-row .rotation-label {
      flex: 0 0 auto;
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      min-width: 56px;
    }
    .edit-side-panel .rotation-row .rotation-value {
      flex: 0 0 auto;
      font-variant-numeric: tabular-nums;
      font-size: var(--pf-text-xs);
      min-width: 36px;
      text-align: right;
    }
    .edit-side-panel .rotation-row pf-slider {
      flex: 1 1 auto;
    }
    /* Hover hot-zone on the right edge in fullscreen mode so the
       floating panel can be summoned without grazing the right edge
       precisely. Inert (and not rendered) in windowed mode where the
       panel is permanently in flow. */
    .edit-panel-hotzone {
      position: absolute;
      top: 0;
      bottom: 0;
      right: 0;
      width: 80px;
      z-index: 4;
      pointer-events: auto;
    }
    :host(:not([fullscreen])) .edit-panel-hotzone {
      display: none;
    }
    :host([fullscreen][idle]) .edit-panel-hotzone {
      pointer-events: none;
    }
    .edit-card {
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      background: var(--pf-surface-2);
      overflow: hidden;
    }
    .edit-card-header {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1 1 auto;
      min-width: 0;
      background: transparent;
      color: var(--pf-text);
      border: none;
      padding: 8px 10px;
      font-size: var(--pf-text-sm);
      font-weight: 600;
      letter-spacing: 0.02em;
      cursor: pointer;
      text-align: left;
    }
    .edit-card-header-row {
      display: flex;
      align-items: stretch;
      width: 100%;
    }
    .card-revert {
      flex: 0 0 auto;
      background: transparent;
      color: var(--pf-text-muted);
      border: none;
      border-left: 1px solid var(--pf-border);
      padding: 0 10px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .card-revert:hover {
      background: var(--pf-surface-hover);
      color: var(--pf-text);
    }
    .card-revert:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .card-revert:disabled:hover {
      background: transparent;
      color: var(--pf-text-muted);
    }
    .card-revert pf-icon {
      font-size: 0.9rem;
    }
    .edit-card-header:hover {
      background: var(--pf-surface-hover);
    }
    .edit-card-header pf-icon {
      font-size: 0.9rem;
      transition: transform 150ms ease;
    }
    .edit-card[data-open="false"] .edit-card-header pf-icon {
      transform: rotate(-90deg);
    }
    .edit-card-body {
      padding: 6px 10px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .edit-card[data-open="false"] .edit-card-body {
      display: none;
    }
    .slider-row {
      display: grid;
      grid-template-columns: 1fr auto;
      column-gap: 8px;
      row-gap: 2px;
      align-items: center;
    }
    .slider-row .slider-label {
      font-size: var(--pf-text-xs);
      color: var(--pf-text);
      grid-column: 1;
    }
    .slider-row .slider-value {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      font-variant-numeric: tabular-nums;
      grid-column: 2;
      min-width: 3ch;
      text-align: right;
      cursor: pointer;
    }
    .slider-row .slider-value:hover {
      color: var(--pf-text);
    }
    .slider-row input[type="range"] {
      grid-column: 1 / span 2;
      width: 100%;
      margin: 0;
      accent-color: var(--pf-accent);
    }
    .slider-row input[type="range"]:focus-visible {
      outline: 1px solid var(--pf-accent);
      outline-offset: 2px;
    }
    .slider-row .slider-input {
      grid-column: 1 / span 2;
      width: 100%;
    }
    /* Compact key/value table for EXIF metadata. Labels in a fixed
       narrow column, values truncate with ellipsis if they overflow. */
    .exif-list {
      display: grid;
      grid-template-columns: 110px 1fr;
      column-gap: 10px;
      row-gap: 4px;
      margin: 0;
      padding: 0;
    }
    .exif-list dt {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      align-self: center;
      margin: 0;
    }
    .exif-list dd {
      font-size: var(--pf-text-xs);
      color: var(--pf-text);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .exif-section {
      font-size: var(--pf-text-xs);
      font-weight: 600;
      color: var(--pf-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 10px 0 4px;
    }
    .exif-section:first-child {
      margin-top: 0;
    }
    .exif-empty {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      padding: 4px 0;
    }
  `;

  @property({ attribute: false })
  photos: Photo[] = [];

  @property({ type: Number })
  index = 0;

  @property({ type: Boolean, reflect: true })
  fullscreen = false;

  @state()
  private bg: BgColor = "black";

  @state()
  private fit: ImageFit = "contain";

  @state()
  private sizing: ImageSizing = "fit";

  /** Suppresses the persistence side-effect during the initial hydrate
   * from the DB so we don't write back the same value we just read. */
  private hydrated = false;

  @state()
  private openMenu: "bg" | "fit" | "sizing" | "format" | "variant" | null = null;

  /** Bumped when the shared variant store changes so we re-render. */
  @state()
  private variantTick = 0;

  private unsubscribeStore: (() => void) | null = null;

  @property({ type: Boolean, reflect: true })
  idle = false;

  /** Reflects whether the floating edit panel is currently revealed in
   * fullscreen. Driven by cursor proximity to the right edge or hover
   * over the panel itself. Inert in windowed mode. */
  @property({ type: Boolean, reflect: true, attribute: "edit-panel-visible" })
  editPanelVisible = false;

  /** Whether the edit panel is expanded in windowed (non-fullscreen)
   * mode. The user toggles it explicitly via the toolbar button —
   * mirroring the folder sidebar's expand/collapse model. In
   * fullscreen mode this is ignored; the panel reveals on hover. */
  @property({ type: Boolean, reflect: true, attribute: "edit-panel-open" })
  editPanelOpenWindowed = false;

  /** Press-and-hold preview of the original (un-edited) image. While
   * held, the canvas bypasses crop + tone so the user can compare. */
  @state()
  private previewOriginal = false;

  // --- Edit (crop) state -----------------------------------------------
  /** Edit affordances are always available for JPEGs; toggling is
   * implicit on selection format. The right-side panel is summoned by
   * cursor proximity to the right edge in either windowed or fullscreen
   * mode, so there is no explicit edit toggle. */
  private get editMode(): boolean {
    return this.isJpegSelection();
  }

  /**
   * Currently-active edit tool. `null` means no tool is active and the
   * canvas is in normal viewing mode; non-null means the tool's
   * parameters are visible and the canvas is in that tool's
   * interactive mode.
   */
  @state()
  private activeEditTool: "crop" | null = null;

  /** Whether the "Crop" disclosure card in the side panel is open.
   * Opening the card activates the crop tool on the canvas; closing
   * it deactivates the tool. */
  @state()
  private cropCardOpen = false;

  @state()
  private editAspect: AspectRatioKey = "3:2";

  @state()
  private editOrientation: Orientation = "landscape";

  /** Live straighten/rotation in degrees applied during a crop edit.
   * Mirrors the persisted `crop.rotation` while the crop card is
   * open; written back to the store after every interaction. */
  @state()
  private editRotation = 0;

  /** When `true`, the canvas is in horizon-pick mode: the next pointer
   * drag inside the image draws a reference line and its angle is
   * folded into `editRotation`. */
  @state()
  private horizonModeActive = false;

  /** Bumped when the edit store changes so the "Edit" button reflects
   * whether the current photo has a saved crop. */
  @state()
  private editsTick = 0;

  /** Live tonal-edit state mirrored from the edit store. The slider
   * UI binds to this directly so the user sees immediate feedback;
   * each change is also pushed straight back to the store, which
   * triggers a canvas redraw via the same subscription path. */
  @state()
  private tone: ToneEdit = defaultTone();

  /** Path the `tone` mirror was hydrated from, so we can refresh it
   * when the active photo or its variant changes. */
  private toneForPath: string | null = null;

  /** Whether the "Basic" disclosure card is open. Persisted only in
   * memory — opens by default each session. */
  @state()
  private basicCardOpen = true;

  /** Whether the "Info" (EXIF) disclosure card is open. Defaults open. */
  @state()
  private infoCardOpen = true;

  /** Cached EXIF metadata for the active photo. `null` while loading
   * or if the read failed; an empty record means no fields available. */
  @state()
  private exif: ExifMetadata | null = null;

  /** Path the cached EXIF was read for, so we can refresh on
   * navigation / variant switch. */
  private exifForPath: string | null = null;

  private exifLoadGen = 0;

  private unsubscribeEdits: (() => void) | null = null;

  private idleTimer: number | null = null;

  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  private onMouseMoveGlobal = (e: MouseEvent) => {
    // In fullscreen the floating edit rail+panel reveal when the
    // cursor approaches the right edge or hovers the rail/panel
    // itself, and hide immediately when the cursor leaves that area.
    if (this.editMode && this.fullscreen) {
      const nearRight = e.clientX > window.innerWidth - 80;
      const overRailOrPanel = this.cursorOverEditRailOrPanelXY(
        e.clientX,
        e.clientY
      );
      this.editPanelVisible = nearRight || overRailOrPanel;
    }

    if (!this.fullscreen) return;

    // Cursor over chrome (toolbar / bottombar / left or right side
    // panels) keeps controls visible: cancel any pending hide and
    // never start a new countdown until the cursor returns to the
    // canvas. The countdown only ticks while the cursor is moving
    // over the image itself.
    const onCanvas = this.cursorOnCanvasArea(e.clientX, e.clientY);
    if (!onCanvas) {
      if (this.idleTimer !== null) {
        window.clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      if (this.idle) this.idle = false;
      return;
    }

    // While idle (controls hidden) require the cursor to enter a
    // chrome zone to bring them back, so casual movement over the
    // image doesn't reveal them.
    if (this.idle) return;

    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.idle = true;
      this.openMenu = null;
    }, 1000);
  };
  private onDocClick = (e: MouseEvent) => {
    if (!this.openMenu) return;
    const path = e.composedPath();
    if (!path.includes(this)) return;
    // If click is outside any menu-wrap, close.
    const insideMenu = path.some(
      (n) => n instanceof HTMLElement && n.classList?.contains("menu-wrap")
    );
    if (!insideMenu) this.openMenu = null;
  };

  connectedCallback(): void {
    super.connectedCallback();
    // Listen on capture so nothing in our own subtree can swallow ESC.
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("mousemove", this.onMouseMoveGlobal);
    window.addEventListener("click", this.onDocClick, { capture: true });
    this.unsubscribeStore = subscribeVariantOverrides(() => {
      this.variantTick++;
    });
    this.unsubscribeEdits = subscribePhotoEdits((path) => {
      this.editsTick++;
      // Broadcast notifications (path === "") fire after the initial
      // store load — re-pull the tone for the active photo so the
      // sliders reflect what was persisted from a previous session.
      if (path === "") {
        this.toneForPath = null;
      }
    });
    this.tabIndex = -1;
    queueMicrotask(() => this.focus());
    void this.hydrateViewState();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // Flush any pending tone edit before tearing down.
    if (this.toneForPath) void flushPhotoEdit(this.toneForPath);
    window.removeEventListener("keydown", this.onKeyDown, { capture: true } as unknown as EventListenerOptions);
    window.removeEventListener("mousemove", this.onMouseMoveGlobal);
    window.removeEventListener("click", this.onDocClick, { capture: true } as unknown as EventListenerOptions);
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeEdits?.();
    this.unsubscribeEdits = null;
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private bumpIdle() {
    if (this.idle) this.idle = false;
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    // The 1s timer covers two related effects, both fullscreen-only:
    //   1. Fade the floating toolbar/bottombar.
    //   2. Collapse the floating right-side edit panel — but only
    //      if the cursor is currently over the canvas (not hovering
    //      the panel itself).
    if (!this.fullscreen) return;
    this.idleTimer = window.setTimeout(() => {
      this.idle = true;
      this.openMenu = null;
    }, 1000);
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("bg")) {
      this.style.setProperty("--pf-fv-bg", this.bgCss(this.bg));
      this.style.setProperty(
        "--pf-fv-fg",
        this.bg === "white" ? "#000" : "#fff"
      );
    }
    if ((changed.has("bg") || changed.has("fit") || changed.has("sizing")) &&
      this.hydrated
    ) {
      void this.persistViewState();
    }
    if (changed.has("fullscreen")) {
      if (this.fullscreen) {
        this.bumpIdle();
      } else {
        if (this.idleTimer !== null) {
          window.clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        this.idle = false;
      }
      // Toggling fullscreen changes the stage's effective size (the
      // toolbar/bottombar move from in-flow to absolutely positioned
      // overlays). Snap pan/zoom back to fit so the image is always
      // shown fully zoomed out with the correct margin/scale, instead
      // of inheriting a stale absolute scale from the previous layout.
      // Defer past the layout change so the canvas measures the new
      // stage size before refitting.
      requestAnimationFrame(() => {
        const cv = this.renderRoot.querySelector(
          "pf-image-canvas"
        ) as PfImageCanvas | null;
        cv?.resetView();
      });
    }
    if (changed.has("photos") || changed.has("index")) {
      // Flush any debounced tone edit for the photo we're leaving so
      // the last slider tick doesn't get dropped on navigation.
      const prevTarget = this.toneForPath;
      if (prevTarget) void flushPhotoEdit(prevTarget);
      this.schedulePrefetch();
      // Navigation keeps the edit panel available, but any active
      // per-photo crop tool is cancelled and its disclosure card
      // collapsed so the next photo doesn't inherit a stale frame.
      if (this.activeEditTool) {
        this.activeEditTool = null;
      }
      this.cropCardOpen = false;
      // Releasing the before/after preview between photos avoids
      // sticky state if the pointer is captured elsewhere.
      this.previewOriginal = false;
      // Hide the panel between photos so a non-JPEG selection
      // doesn't surface an empty side panel.
      if (!this.isJpegSelection()) {
        this.editPanelVisible = false;
      }
    }
    // Keep the local tone mirror in sync with whatever photo+variant
    // we're now showing (handles navigation, variant switches, and
    // edit-store change notifications via `editsTick`).
    this.syncToneFromStore();
    this.syncExifFromPath();
  }

  /** Refresh `this.tone` from the edit store when the active edit
   * target changes (navigation or variant switch). Crucially we do
   * NOT re-pull on every edit-store notification: while the user is
   * dragging a slider we already own the canonical value, and echoing
   * the store would race and snap the slider to a stale write. */
  private syncToneFromStore() {
    const target = this.editTargetPath();
    if (target == null) {
      if (this.toneForPath !== null) {
        this.tone = defaultTone();
        this.toneForPath = null;
      }
      return;
    }
    if (target === this.toneForPath) return;
    const persisted = getPhotoEdit(target)?.tone ?? null;
    this.tone = persisted ? { ...defaultTone(), ...persisted } : defaultTone();
    this.toneForPath = target;
  }

  /** Re-read EXIF metadata when the active resolved path changes.
   * Backend reads happen on a worker thread so this is non-blocking. */
  private syncExifFromPath() {
    const target = this.editTargetPath();
    if (target == null) {
      if (this.exifForPath !== null) {
        this.exif = null;
        this.exifForPath = null;
      }
      return;
    }
    if (target === this.exifForPath) return;
    this.exifForPath = target;
    this.exif = null;
    const gen = ++this.exifLoadGen;
    void invoke<ExifMetadata>("get_exif_metadata", { photoPath: target })
      .then((meta) => {
        if (gen !== this.exifLoadGen) return;
        this.exif = meta ?? {};
      })
      .catch((err) => {
        if (gen !== this.exifLoadGen) return;
        console.warn("Failed to read EXIF metadata", err);
        this.exif = {};
      });
  }

  /**
   * Ask the shared full-image LRU to keep the current photo and its
   * neighbours warm. Priority radiates outwards from the active index
   * (current, +1, -1, +2, -2, …) so forward scrolling — the common
   * case — is favoured slightly. The cache caps total entries on its
   * own; we just request more than the cache can hold and let it pick.
   */
  private schedulePrefetch() {
    const total = this.photos.length;
    if (total === 0) return;
    const i = this.index;
    if (i < 0 || i >= total) return;
    const order: string[] = [this.photos[i].path];
    // Up to 19 neighbours — cache holds 20 entries total.
    for (let d = 1; d < total && order.length < 20; d++) {
      const fwd = i + d;
      if (fwd < total) order.push(this.photos[fwd].path);
      if (order.length >= 20) break;
      const back = i - d;
      if (back >= 0) order.push(this.photos[back].path);
    }
    prefetchHdImages(order);
  }

  private bgCss(bg: BgColor): string {
    return bg === "black" ? "#000" : bg === "white" ? "#fff" : "#808080";
  }

  /** Read the persisted background + fit selection from the SQLite
   * `app_settings` row (`view_state`). Missing rows or fields fall
   * back to the constructor defaults so first-run shows a black
   * background with `contain` fit. */
  private async hydrateViewState() {
    try {
      const persisted = await invoke<{
        bg?: string | null;
        fit?: string | null;
        sizing?: string | null;
      } | null>("get_view_state");
      if (persisted) {
        if (persisted.bg === "black" || persisted.bg === "grey" || persisted.bg === "white") {
          this.bg = persisted.bg;
        }
        if (
          persisted.fit === "contain" ||
          persisted.fit === "tight" ||
          persisted.fit === "proof"
        ) {
          this.fit = persisted.fit;
        }
        if (
          persisted.sizing === "fit" ||
          persisted.sizing === "fill" ||
          persisted.sizing === "hybrid"
        ) {
          this.sizing = persisted.sizing;
        }
      }
    } catch (err) {
      console.warn("Failed to load view state", err);
    } finally {
      this.hydrated = true;
    }
  }

  private async persistViewState() {
    try {
      await invoke("set_view_state", {
        view: { bg: this.bg, fit: this.fit, sizing: this.sizing },
      });
    } catch (err) {
      console.warn("Failed to persist view state", err);
    }
  }

  private get currentPhoto(): Photo | null {
    if (this.index < 0 || this.index >= this.photos.length) return null;
    return this.photos[this.index] ?? null;
  }

  private handleKey(e: KeyboardEvent) {
    // `f`, `Escape`, and `g` are owned by the app shell so it can
    // coordinate window fullscreen + view stack across grid and full
    // views. We deliberately do not handle them here.
    if (this.activeEditTool) {
      // Esc closes the active tool. Edits are persisted incrementally
      // as the user works, so there is no separate cancel/apply
      // distinction to honour here.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (this.horizonModeActive) {
          this.horizonModeActive = false;
          return;
        }
        this.cropCardOpen = false;
        this.activeEditTool = null;
        const target = this.editTargetPath();
        if (target) void flushPhotoEdit(target);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.cropCardOpen = false;
        this.activeEditTool = null;
        const target = this.editTargetPath();
        if (target) void flushPhotoEdit(target);
        return;
      }
      // Arrows still navigate so the user can step through photos
      // even with a tool open; the active tool is dropped on photo
      // change via willUpdate.
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        this.go(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        this.go(1);
        return;
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      this.go(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      this.go(1);
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      this.cycleFit();
    } else if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      this.cycleBg();
    } else if (e.key === "0") {
      e.preventDefault();
      this.fit = "contain";
    } else if (e.key === "1") {
      e.preventDefault();
      this.fit = "tight";
    } else if (e.key === "2") {
      e.preventDefault();
      this.fit = "proof";
    }
  }

  private cycleFit() {
    const order: ImageFit[] = ["contain", "tight", "proof"];
    const idx = order.indexOf(this.fit);
    this.fit = order[(idx + 1) % order.length];
    this.openMenu = null;
  }

  private cycleBg() {
    const order: BgColor[] = ["black", "grey", "white"];
    const idx = order.indexOf(this.bg);
    this.bg = order[(idx + 1) % order.length];
    this.openMenu = null;
  }

  private go(delta: number) {
    const next = this.index + delta;
    if (next < 0 || next >= this.photos.length) return;
    this.dispatchEvent(
      new CustomEvent("full-view-navigate", {
        detail: { index: next },
        bubbles: true,
        composed: true,
      })
    );
  }

  private close = () => {
    // Dispatch on the host element. `composed: true` so the event escapes
    // shadow DOM; `bubbles: true` so app-shell sees it.
    this.dispatchEvent(
      new CustomEvent("full-view-close", {
        bubbles: true,
        composed: true,
      })
    );
  };

  private toggleFullscreen = () => {
    this.dispatchEvent(
      new CustomEvent("toggle-window-fullscreen", {
        bubbles: true,
        composed: true,
      })
    );
  };

  private setBg = (bg: BgColor) => {
    this.bg = bg;
    this.openMenu = null;
  };

  private setFit = (m: ImageFit) => {
    const same = this.fit === m;
    this.fit = m;
    this.openMenu = null;
    if (same) {
      const cv = this.renderRoot.querySelector(
        "pf-image-canvas"
      ) as PfImageCanvas | null;
      cv?.resetView();
    }
  };

  private setSizing = (s: ImageSizing) => {
    const same = this.sizing === s;
    this.sizing = s;
    this.openMenu = null;
    if (same) {
      const cv = this.renderRoot.querySelector(
        "pf-image-canvas"
      ) as PfImageCanvas | null;
      cv?.resetView();
    }
  };

  private toggleMenu = (which: "bg" | "fit" | "sizing" | "format" | "variant") => {
    this.openMenu = this.openMenu === which ? null : which;
  };

  private currentSelection(
    photo: Photo
  ): { format: PhotoFormat; variant: string } | null {
    const formats = availableFormats(photo);
    if (formats.length === 0) return null;
    const primary = primarySelection(photo);
    const stored = getVariantOverride(photo.path);
    const format = stored?.format ?? primary?.format ?? formats[0];
    const variants = availableVariants(photo, format);
    if (variants.length === 0) return null;
    const requested =
      (stored && stored.format === format ? stored.variant : null) ??
      (primary && primary.format === format ? primary.variant : null) ??
      variants[0].key;
    const final =
      variants.find((v) => v.key === requested)?.key ?? variants[0].key;
    return { format, variant: final };
  }

  private resolvedPath(photo: Photo): string {
    const sel = this.currentSelection(photo);
    if (!sel) return photo.path;
    return fileForSelection(photo, sel.format, sel.variant) ?? photo.path;
  }

  private variantHasEdits(
    photo: Photo,
    format: PhotoFormat,
    variant: string
  ): boolean {
    void this.editsTick;
    const path = fileForSelection(photo, format, variant);
    return path != null && hasEdits(path);
  }

  private setFormat = (format: PhotoFormat) => {
    const photo = this.currentPhoto;
    if (!photo) return;
    const variants = availableVariants(photo, format);
    if (variants.length === 0) return;
    const sel = this.currentSelection(photo);
    const variant =
      variants.find((v) => v.key === sel?.variant)?.key ?? variants[0].key;
    setVariantOverride(photo.path, { format, variant });
    this.openMenu = null;
  };

  private setVariant = (variantKey: string) => {
    const photo = this.currentPhoto;
    if (!photo) return;
    const sel = this.currentSelection(photo);
    if (!sel) return;
    setVariantOverride(photo.path, {
      format: sel.format,
      variant: variantKey,
    });
    this.openMenu = null;
  };

  private bgLabel(bg: BgColor): string {
    return bg.charAt(0).toUpperCase() + bg.slice(1);
  }

  // --- Edit helpers ----------------------------------------------------

  /** Effective aspect ratio (W/H) given the current preset + orientation. */
  private effectiveAspect(): number {
    const a = ASPECT_RATIO_VALUES[this.editAspect];
    return this.editOrientation === "portrait" ? 1 / a : a;
  }

  /** Whether the active selection is a JPEG (only format we edit). */
  private isJpegSelection(): boolean {
    const photo = this.currentPhoto;
    if (!photo) return false;
    const sel = this.currentSelection(photo);
    return sel?.format === "jpg";
  }

  /** The path the canvas is actually displaying — i.e. the resolved
   * variant file. This is what the cache, the Rust full-image
   * command, and therefore the edit store must all agree on. */
  private editTargetPath(): string | null {
    const photo = this.currentPhoto;
    if (!photo) return null;
    return this.resolvedPath(photo);
  }

  /** Currently saved crop on the active photo, if any. */
  private currentSavedCrop(): CropEdit | null {
    void this.editsTick;
    const target = this.editTargetPath();
    if (!target) return null;
    return getPhotoEdit(target)?.crop ?? null;
  }


  private cursorOverEditPanelXY(x: number, y: number): boolean {
    const panel = this.renderRoot.querySelector(
      ".edit-side-panel"
    ) as HTMLElement | null;
    if (!panel) return false;
    const rect = panel.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return (
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    );
  }

  /** True when the cursor sits over the image canvas area, i.e. NOT
   *  over the floating toolbar, bottombar, edit rail/panel, or the
   *  left-edge folder sidebar overlay zone. The idle timer that
   *  fades the chrome only counts down while the cursor is on the
   *  canvas; entering any chrome zone keeps the chrome visible. */
  private cursorOnCanvasArea(x: number, y: number): boolean {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (y < 49) return false;
    if (y > h - 49) return false;
    if (this.editMode) {
      const rightZone = this.editPanelVisible ? 32 + 280 : 80;
      if (x > w - rightZone) return false;
    }
    // Folder sidebar overlay (rail 32 + sidebar 228 = 260) lives on
    // the left edge in fullscreen full-view. Treat the whole zone
    // as chrome so the toolbar/bottombar stay visible while the
    // user works in the sidebar.
    if (x < 260) return false;
    return true;
  }
  private cursorOverEditRailOrPanelXY(x: number, y: number): boolean {
    if (this.cursorOverEditPanelXY(x, y)) return true;
    const rail = this.renderRoot.querySelector(
      ".edit-side-rail"
    ) as HTMLElement | null;
    if (!rail) return false;
    const rect = rail.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return (
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    );
  }

  // --- Before/After preview --------------------------------------------
  private startPreviewOriginal = (e: Event) => {
    if (!this.canPreviewOriginal()) return;
    e.preventDefault();
    this.previewOriginal = true;
    const target = e.currentTarget as HTMLElement;
    if (target && "setPointerCapture" in target && (e as PointerEvent).pointerId != null) {
      try {
        target.setPointerCapture((e as PointerEvent).pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
  };

  private endPreviewOriginal = () => {
    if (!this.previewOriginal) return;
    this.previewOriginal = false;
  };

  private canPreviewOriginal(): boolean {
    void this.editsTick;
    const target = this.editTargetPath();
    return !!target && hasEdits(target);
  }

  private openTool = (tool: "crop") => {
    if (tool === "crop") {
      const saved = this.currentSavedCrop();
      if (saved) {
        this.editAspect = saved.aspectRatio;
        this.editOrientation = saved.orientation;
        this.editRotation = saved.rotation ?? 0;
      } else {
        this.editRotation = 0;
      }
      this.horizonModeActive = false;
      this.cropCardOpen = true;
    }
    this.activeEditTool = tool;
  };

  private toggleCropCard = () => {
    if (this.cropCardOpen) {
      this.cropCardOpen = false;
      this.horizonModeActive = false;
      if (this.activeEditTool === "crop") {
        this.activeEditTool = null;
      }
      // Flush any pending debounced crop writes so the on-disk state
      // matches what the canvas now renders from the saved crop.
      const target = this.editTargetPath();
      if (target) void flushPhotoEdit(target);
    } else {
      this.openTool("crop");
    }
  };

  private setEditAspect = (a: AspectRatioKey) => {
    this.editAspect = a;
    this.persistCropFromCanvas();
  };

  private setEditOrientation = (o: Orientation) => {
    this.editOrientation = o;
    this.persistCropFromCanvas();
  };

  /** When `true`, programmatic resets are in flight and any
   *  `crop-change` dispatched by the canvas (e.g. as a side-effect
   *  of changing rotation/aspect props back to defaults) must be
   *  ignored — otherwise the canvas would re-persist the stale frame
   *  on top of the just-cleared edit. */
  private suppressCropPersist = false;

  /** Pull the current frame from the canvas and persist as the saved
   * crop, debounced via the edit store. Used as the common write
   * path for slider/button/drag events while the crop card is open. */
  private persistCropFromCanvas = () => {
    const target = this.editTargetPath();
    if (!target) return;
    const cv = this.renderRoot.querySelector(
      "pf-image-canvas",
    ) as PfImageCanvas | null;
    const frame = cv?.getCropFrame();
    if (!frame) return;
    const crop: CropEdit = {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      aspectRatio: this.editAspect,
      orientation: this.editOrientation,
      rotation: this.editRotation,
    };
    // Skip writes that don't actually change anything. Prevents the
    // revert button from lighting up just because the canvas
    // re-dispatched the same frame on a benign prop refresh.
    const prev = getPhotoEdit(target)?.crop ?? null;
    if (prev && cropEditsEqual(prev, crop)) return;
    setPhotoCrop(target, crop);
  };

  /** Handler for `crop-change` from the canvas: a frame edge moved. */
  private onCanvasCropChange = () => {
    if (this.suppressCropPersist) return;
    this.persistCropFromCanvas();
  };

  /** Handler for `orientation-flip`: the canvas detected a corner
   * drag that crossed the centre, so swap orientation to match. */
  private onCanvasOrientationFlip = () => {
    this.editOrientation =
      this.editOrientation === "landscape" ? "portrait" : "landscape";
  };

  /** Handler for `horizon-line`: the user drew a reference line; fold
   * its angle into `editRotation` and exit horizon mode. */
  private onCanvasHorizonLine = (e: Event) => {
    const ce = e as CustomEvent<number>;
    const delta = Number(ce.detail);
    if (!Number.isFinite(delta)) return;
    let next = (this.editRotation || 0) + delta;
    // Clamp to (-45..45] which matches the slider's range.
    while (next > 45) next -= 90;
    while (next < -45) next += 90;
    this.editRotation = next;
    this.horizonModeActive = false;
    this.persistCropFromCanvas();
  };

  private toggleHorizonMode = () => {
    this.horizonModeActive = !this.horizonModeActive;
  };

  private rotate90Left = () => {
    // 90° CCW rotation of the crop relative to the bitmap. We treat it
    // as a discrete bump on top of the live straighten value, then let
    // the canvas's rotation cache handle the geometry.
    let next = (this.editRotation || 0) - 90;
    while (next > 180) next -= 360;
    while (next <= -180) next += 360;
    this.editRotation = next;
    this.persistCropFromCanvas();
  };

  private rotate90Right = () => {
    let next = (this.editRotation || 0) + 90;
    while (next > 180) next -= 360;
    while (next <= -180) next += 360;
    this.editRotation = next;
    this.persistCropFromCanvas();
  };

  private onRotationSlider = (e: Event) => {
    const ce = e as CustomEvent<number>;
    const v = Number(ce.detail);
    if (!Number.isFinite(v)) return;
    // Slider only spans -45..45; preserve any 90° increments already
    // stamped in by the rotate-left/right buttons.
    const base = Math.round((this.editRotation || 0) / 90) * 90;
    this.editRotation = base + v;
    this.persistCropFromCanvas();
  };

  /** Drop the persisted crop on the active photo (per-tool revert). */
  private resetCropEdit = async () => {
    const target = this.editTargetPath();
    if (!target) return;
    const saved = getPhotoEdit(target)?.crop ?? null;
    if (!saved) return;
    // Reset the host's UI state to defaults BEFORE clearing the DB.
    // The canvas will re-render with rotation=0 / aspect=default and
    // its willUpdate handlers will dispatch `crop-change` as a side
    // effect; suppress that so we don't re-persist the stale frame on
    // top of the cleared edit.
    this.suppressCropPersist = true;
    this.editAspect = "3:2";
    this.editOrientation = "landscape";
    this.editRotation = 0;
    this.horizonModeActive = false;
    await this.updateComplete;
    const cv = this.renderRoot.querySelector(
      "pf-image-canvas",
    ) as PfImageCanvas | null;
    if (cv) await cv.updateComplete;
    this.suppressCropPersist = false;
    // Now clear the persisted edit. The canvas's edit-store subscriber
    // notices `savedCrop` going from non-null to null and resets its
    // live `cropFrame` so the on-screen crop snaps back to the full
    // image.
    setPhotoCrop(target, null);
  };

  private hasCropEdit(): boolean {
    void this.editsTick;
    const target = this.editTargetPath();
    if (!target) return false;
    return getPhotoEdit(target)?.crop != null;
  }

  /** Reset all tone sliders to zero (per-tool revert). */
  private resetToneEdit = () => {
    const target = this.editTargetPath();
    if (!target) return;
    if (isToneZero(this.tone)) return;
    this.tone = defaultTone();
    this.toneForPath = target;
    setPhotoTone(target, null);
  };

  private hasToneEdit(): boolean {
    return !isToneZero(this.tone);
  }

  /** Drop both crop and tone edits on the active photo. Backs the
   *  panel-footer "Revert all" button. */
  private resetAllEdits = async () => {
    await this.resetCropEdit();
    this.resetToneEdit();
  };

  /** Toggle the edit panel from the rail's button. In windowed mode
   *  this flips the persistent open/closed state. In fullscreen the
   *  panel is normally driven by hover, so the toggle dismisses the
   *  current overlay reveal. */
  private toggleEditPanelWindowed = () => {
    if (this.fullscreen) {
      this.editPanelVisible = false;
      return;
    }
    this.editPanelOpenWindowed = !this.editPanelOpenWindowed;
    this.dispatchEvent(
      new CustomEvent("edit-panel-open-changed", {
        detail: { open: this.editPanelOpenWindowed },
        bubbles: true,
        composed: true,
      })
    );
  };

  // --- Tone slider handlers --------------------------------------------

  private setToneValue = (key: keyof ToneEdit, value: number) => {
    const target = this.editTargetPath();
    if (!target) return;
    const next: ToneEdit = { ...this.tone, [key]: value };
    this.tone = next;
    this.toneForPath = target;
    // The in-memory store update + subscriber notification are
    // synchronous so the canvas redraws with the new tone uniforms
    // immediately; the backend SQLite write is debounced inside the
    // store so a 60 Hz slider drag doesn't queue 60 IPC round-trips.
    setPhotoTone(target, isToneZero(next) ? null : next);
  };

  private resetToneValue = (key: keyof ToneEdit) => {
    if (this.tone[key] === 0) return;
    this.setToneValue(key, 0);
  };

  private toggleBasicCard = () => {
    this.basicCardOpen = !this.basicCardOpen;
  };

  private toggleInfoCard = () => {
    this.infoCardOpen = !this.infoCardOpen;
  };

  /** Build the camera-body label, joining make + model only when the
   * model doesn't already include the make (e.g. "NIKON D850" already
   * starts with "NIKON CORPORATION", so don't double up). */
  private formatCameraName(meta: ExifMetadata): string | null {
    const make = (meta.cameraMake ?? "").trim();
    const model = (meta.cameraModel ?? "").trim();
    if (!make && !model) return null;
    if (!make) return model;
    if (!model) return make;
    if (model.toLowerCase().startsWith(make.toLowerCase())) return model;
    return `${make} ${model}`;
  }

  private formatLensName(meta: ExifMetadata): string | null {
    const make = (meta.lensMake ?? "").trim();
    const model = (meta.lensModel ?? "").trim();
    if (!make && !model) return null;
    if (!make) return model;
    if (!model) return make;
    if (model.toLowerCase().startsWith(make.toLowerCase())) return model;
    return `${make} ${model}`;
  }

  private formatExifDate(raw: string | null | undefined): string | null {
    if (!raw) return null;
    // EXIF DateTimeOriginal is "YYYY:MM:DD HH:MM:SS". Normalise to
    // a more readable "YYYY-MM-DD HH:MM" without TZ guessing.
    const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2})/);
    if (!m) return raw;
    const [, y, mo, d, h, mi] = m;
    return `${y}-${mo}-${d} ${h}:${mi}`;
  }

  private formatGpsCoords(
    lat: number | null | undefined,
    lon: number | null | undefined,
  ): string | null {
    if (lat == null || lon == null) return null;
    return `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
  }

  private formatDimensions(
    w: number | null | undefined,
    h: number | null | undefined,
  ): string | null {
    if (!w || !h) return null;
    const mp = (w * h) / 1_000_000;
    return `${w} × ${h} (${mp.toFixed(1)} MP)`;
  }

  private renderInfoCard() {
    const open = this.infoCardOpen;
    const meta = this.exif;
    const loading = meta === null;
    const cameraName = meta ? this.formatCameraName(meta) : null;
    const lensName = meta ? this.formatLensName(meta) : null;
    const focalDisplay = meta?.focalLength ?? null;
    const focal35 =
      meta?.focalLength35mm && meta.focalLength35mm !== meta.focalLength
        ? meta.focalLength35mm
        : null;
    const dateTaken = this.formatExifDate(meta?.dateTaken);
    const dimensions = this.formatDimensions(
      meta?.pixelWidth,
      meta?.pixelHeight,
    );
    const gps = this.formatGpsCoords(meta?.gpsLatitude, meta?.gpsLongitude);

    type Row = { label: string; value: string };
    const cameraRows: Row[] = [];
    if (cameraName) cameraRows.push({ label: "Camera", value: cameraName });
    if (lensName) cameraRows.push({ label: "Lens", value: lensName });
    if (meta?.cameraSerial)
      cameraRows.push({ label: "Body serial", value: meta.cameraSerial });
    if (meta?.lensSerial)
      cameraRows.push({ label: "Lens serial", value: meta.lensSerial });
    if (meta?.software)
      cameraRows.push({ label: "Software", value: meta.software });

    const exposureRows: Row[] = [];
    if (meta?.iso) exposureRows.push({ label: "ISO", value: meta.iso });
    if (meta?.shutterSpeed)
      exposureRows.push({ label: "Shutter speed", value: meta.shutterSpeed });
    if (meta?.aperture)
      exposureRows.push({ label: "Aperture", value: meta.aperture });
    if (focalDisplay)
      exposureRows.push({ label: "Focal length", value: focalDisplay });
    if (focal35)
      exposureRows.push({ label: "35mm equiv.", value: focal35 });
    if (meta?.exposureCompensation)
      exposureRows.push({
        label: "Exposure comp.",
        value: meta.exposureCompensation,
      });
    if (meta?.exposureMode)
      exposureRows.push({ label: "Exposure mode", value: meta.exposureMode });
    if (meta?.exposureProgram)
      exposureRows.push({
        label: "Exposure program",
        value: meta.exposureProgram,
      });
    if (meta?.meteringMode)
      exposureRows.push({ label: "Metering", value: meta.meteringMode });
    if (meta?.whiteBalance)
      exposureRows.push({ label: "White balance", value: meta.whiteBalance });
    if (meta?.flash) exposureRows.push({ label: "Flash", value: meta.flash });

    const imageRows: Row[] = [];
    if (dimensions)
      imageRows.push({ label: "Dimensions", value: dimensions });
    if (meta?.colorSpace)
      imageRows.push({ label: "Color space", value: meta.colorSpace });
    if (meta?.orientation)
      imageRows.push({ label: "Orientation", value: meta.orientation });

    const captureRows: Row[] = [];
    if (dateTaken) captureRows.push({ label: "Date taken", value: dateTaken });
    if (meta?.artist)
      captureRows.push({ label: "Artist", value: meta.artist });
    if (meta?.copyright)
      captureRows.push({ label: "Copyright", value: meta.copyright });
    if (gps) captureRows.push({ label: "GPS", value: gps });
    if (meta?.gpsAltitude)
      captureRows.push({ label: "Altitude", value: meta.gpsAltitude });

    const sections: Array<{ title: string; rows: Row[] }> = [
      { title: "Camera & lens", rows: cameraRows },
      { title: "Exposure", rows: exposureRows },
      { title: "Image", rows: imageRows },
      { title: "Capture", rows: captureRows },
    ].filter((s) => s.rows.length > 0);

    return html`
      <section class="edit-card" data-open=${open ? "true" : "false"}>
        <div class="edit-card-header-row">
          <button
            type="button"
            class="edit-card-header"
            aria-expanded=${open}
            @click=${this.toggleInfoCard}
          >
            <pf-icon name="chevron-down"></pf-icon>
            <span>Info</span>
          </button>
        </div>
        <div class="edit-card-body">
          ${loading
            ? html`<div class="exif-empty">Reading EXIF…</div>`
            : sections.length === 0
            ? html`<div class="exif-empty">No EXIF metadata.</div>`
            : sections.map(
                (section) => html`
                  <div class="exif-section">${section.title}</div>
                  <dl class="exif-list">
                    ${section.rows.map(
                      (r) => html`
                        <dt>${r.label}</dt>
                        <dd title=${r.value}>${r.value}</dd>
                      `,
                    )}
                  </dl>
                `,
              )}
        </div>
      </section>
    `;
  }

  private renderEditSidePanel() {
    void this.editsTick;
    const canCompare = this.canPreviewOriginal();
    const canRevertAll = this.hasCropEdit() || this.hasToneEdit();
    return html`
      <aside
        class="edit-side-panel"
        aria-label="Edit panel"
        @click=${(e: Event) => e.stopPropagation()}
        @mouseenter=${() => (this.editPanelVisible = true)}
      >
        <div class="edit-side-panel-body">
          ${this.renderInfoCard()}
          ${this.renderCropCard()}
          ${this.renderBasicCard()}
        </div>
        <div class="edit-side-panel-footer">
          <button
            type="button"
            class="footer-btn"
            aria-pressed=${this.previewOriginal}
            aria-label="Compare before and after edits"
            title="Hold to compare before / after edits"
            ?disabled=${!canCompare}
            @pointerdown=${this.startPreviewOriginal}
            @pointerup=${this.endPreviewOriginal}
            @pointercancel=${this.endPreviewOriginal}
            @pointerleave=${this.endPreviewOriginal}
          >
            <pf-icon name="compare"></pf-icon>
            <span>Before / After</span>
          </button>
          <button
            type="button"
            class="footer-btn"
            title="Revert all edits"
            aria-label="Revert all edits"
            ?disabled=${!canRevertAll}
            @click=${this.resetAllEdits}
          >
            <pf-icon name="rotate-ccw"></pf-icon>
            <span>Revert all</span>
          </button>
        </div>
      </aside>
    `;
  }

  private renderCropCard() {
    const open = this.cropCardOpen;
    const aspects: AspectRatioKey[] = [
      "3:2",
      "1:1",
      "4:3",
      "16:9",
      "16:10",
      "panavision",
      "super-panavision",
    ];
    const canRevert = this.hasCropEdit();
    // Slider value = the residual fine-straighten angle in (-45..45].
    // We strip any 90° increments stamped in by the rotate buttons so
    // the slider stays centred at 0 after a 90° rotation.
    const sliderValue = (() => {
      const r = this.editRotation || 0;
      const base = Math.round(r / 90) * 90;
      return Math.max(-45, Math.min(45, r - base));
    })();
    return html`
      <section class="edit-card" data-open=${open ? "true" : "false"}>
        <div class="edit-card-header-row">
          <button
            type="button"
            class="edit-card-header"
            aria-expanded=${open}
            @click=${this.toggleCropCard}
          >
            <pf-icon name="chevron-down"></pf-icon>
            <span>Crop</span>
          </button>
          <button
            type="button"
            class="card-revert"
            title="Revert crop"
            aria-label="Revert crop"
            ?disabled=${!canRevert}
            @click=${this.resetCropEdit}
          >
            <pf-icon name="rotate-ccw"></pf-icon>
          </button>
        </div>
        <div class="edit-card-body">
          <div
            class="edit-group edit-group-wrap"
            role="group"
            aria-label="Aspect ratio"
          >
            ${aspects.map(
              (a) => html`<button
                type="button"
                aria-pressed=${this.editAspect === a}
                @click=${() => this.setEditAspect(a)}
              >
                ${ASPECT_RATIO_LABELS[a]}
              </button>`,
            )}
          </div>
          <div
            class="edit-group edit-group-wrap"
            role="group"
            aria-label="Orientation"
          >
            <button
              type="button"
              aria-pressed=${this.editOrientation === "landscape"}
              @click=${() => this.setEditOrientation("landscape")}
            >
              Landscape
            </button>
            <button
              type="button"
              aria-pressed=${this.editOrientation === "portrait"}
              @click=${() => this.setEditOrientation("portrait")}
            >
              Portrait
            </button>
          </div>
          <div
            class="crop-tools-row"
            role="group"
            aria-label="Rotate"
          >
            <button
              type="button"
              class="crop-tool-btn"
              title="Rotate 90° left"
              aria-label="Rotate 90° left"
              @click=${this.rotate90Left}
            >
              <pf-icon name="rotate-ccw"></pf-icon>
            </button>
            <button
              type="button"
              class="crop-tool-btn"
              title="Straighten by drawing a horizon line"
              aria-label="Straighten by drawing a horizon line"
              aria-pressed=${this.horizonModeActive}
              @click=${this.toggleHorizonMode}
            >
              <pf-icon name="horizon-line"></pf-icon>
            </button>
            <button
              type="button"
              class="crop-tool-btn"
              title="Rotate 90° right"
              aria-label="Rotate 90° right"
              @click=${this.rotate90Right}
            >
              <pf-icon name="rotate-cw"></pf-icon>
            </button>
          </div>
          <div class="rotation-row">
            <span class="rotation-label">Straighten</span>
            <pf-slider
              min="-45"
              max="45"
              step="0.1"
              .value=${sliderValue}
              fillFrom="0"
              @change=${this.onRotationSlider}
            ></pf-slider>
            <span class="rotation-value">${sliderValue.toFixed(1)}°</span>
          </div>
        </div>
      </section>
    `;
  }

  private renderBasicCard() {
    const open = this.basicCardOpen;
    const labels: Record<keyof ToneEdit, string> = {
      exposure: "Exposure",
      contrast: "Contrast",
      saturation: "Saturation",
      whites: "Whites",
      highlights: "Highlights",
      shadows: "Shadows",
      blacks: "Blacks",
    };
    const canRevert = this.hasToneEdit();
    return html`
      <section class="edit-card" data-open=${open ? "true" : "false"}>
        <div class="edit-card-header-row">
          <button
            type="button"
            class="edit-card-header"
            aria-expanded=${open}
            @click=${this.toggleBasicCard}
          >
            <pf-icon name="chevron-down"></pf-icon>
            <span>Basic</span>
          </button>
          <button
            type="button"
            class="card-revert"
            title="Revert basic adjustments"
            aria-label="Revert basic adjustments"
            ?disabled=${!canRevert}
            @click=${this.resetToneEdit}
          >
            <pf-icon name="rotate-ccw"></pf-icon>
          </button>
        </div>
        <div class="edit-card-body">
          ${TONE_KEYS.map((key) => this.renderToneSlider(key, labels[key]))}
        </div>
      </section>
    `;
  }

  private renderToneSlider(key: keyof ToneEdit, label: string) {
    const value = this.tone[key];
    return html`
      <div class="slider-row">
        <span class="slider-label">${label}</span>
        <span
          class="slider-value"
          title="Double-click to reset"
          @dblclick=${() => this.resetToneValue(key)}
        >
          ${value > 0 ? `+${value}` : value}
        </span>
        <pf-slider
          class="slider-input"
          min="-100"
          max="100"
          step="1"
          .value=${value}
          .label=${label}
          fill-from="0"
          @change=${(e: CustomEvent<number>) =>
            this.setToneValue(key, e.detail)}
        ></pf-slider>
      </div>
    `;
  }

  private fitLabel(m: ImageFit): string {
    return m === "contain" ? "None" : m === "tight" ? "Tight" : "Proof";
  }

  private sizingLabel(s: ImageSizing): string {
    return s === "fit" ? "Contain" : s === "fill" ? "Cover" : "Hybrid";
  }

  render() {
    const photo = this.currentPhoto;
    if (!photo) return html``;
    const total = this.photos.length;
    const hasPrev = this.index > 0;
    const hasNext = this.index < total - 1;
    const sel = this.currentSelection(photo);
    const formats = availableFormats(photo);
    const variants =
      sel !== null ? availableVariants(photo, sel.format) : [];
    const path = this.resolvedPath(photo);
    return html`
      <div class="toolbar">
        <div class="toolbar-left">
          <span class="filename" title=${photo.filename}>${photo.filename}</span>
          <span class="counter">${this.index + 1} / ${total}</span>
        </div>
        <div class="toolbar-center">
          ${sel !== null && formats.length > 1
            ? html`<div
                class="format-switch"
                role="group"
                aria-label="File format"
              >
                ${formats.map(
                  (f) => html`<button
                    aria-pressed=${sel.format === f}
                    @click=${() => this.setFormat(f)}
                  >
                    ${f}
                  </button>`
                )}
              </div>`
            : null}
          ${sel !== null && variants.length >= 1
            ? html`<span class="menu-wrap">
                <button
                  class="menu-trigger"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded=${this.openMenu === "variant"}
                  @click=${() => this.toggleMenu("variant")}
                >
                  ${variants.find((v) => v.key === sel.variant)?.label ??
                  sel.variant}
                  ${this.variantHasEdits(photo, sel.format, sel.variant)
                    ? html`<span class="edit-mark" aria-label="Edited">*</span>`
                    : null}
                  <pf-icon name="chevron-down"></pf-icon>
                </button>
                ${this.openMenu === "variant"
                  ? html`<div class="menu-popup" role="menu">
                      ${variants.map(
                        (v) => html`<button
                          class="menu-item"
                          role="menuitemradio"
                          aria-pressed=${sel.variant === v.key}
                          @click=${() => this.setVariant(v.key)}
                        >
                          ${v.label}
                          ${this.variantHasEdits(photo, sel.format, v.key)
                            ? html`<span class="edit-mark" aria-label="Edited">*</span>`
                            : null}
                        </button>`
                      )}
                    </div>`
                  : null}
              </span>`
            : null}
        </div>
        <div class="toolbar-right">
          <pf-icon-button
            icon=${this.fullscreen ? "minimize" : "maximize"}
            label=${this.fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            @click=${this.toggleFullscreen}
          ></pf-icon-button>
          <button
            class="close-btn"
            type="button"
            aria-label="Close full view"
            title="Close (Esc)"
            @click=${this.close}
            @pointerdown=${(e: Event) => e.stopPropagation()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6 L18 18 M18 6 L6 18" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div class="stage-row">
        <div class="stage">
          <pf-image-canvas
            .path=${path}
            .fit=${this.fit}
            .sizing=${this.activeEditTool === "crop" ? "fit" : this.sizing}
            .cropMode=${this.activeEditTool === "crop"}
            .cropAspect=${this.activeEditTool === "crop"
              ? this.effectiveAspect()
              : null}
            .rotation=${this.activeEditTool === "crop"
              ? this.editRotation
              : 0}
            ?horizonMode=${this.activeEditTool === "crop" &&
            this.horizonModeActive}
            .previewOriginal=${this.previewOriginal}
            .editing=${this.editMode}
            background=${this.bgCss(this.bg)}
            @crop-change=${this.onCanvasCropChange}
            @orientation-flip=${this.onCanvasOrientationFlip}
            @horizon-line=${this.onCanvasHorizonLine}
          ></pf-image-canvas>
          <button
            class="nav prev"
            aria-label="Previous"
            ?disabled=${!hasPrev}
            @click=${() => this.go(-1)}
          >
            <pf-icon name="chevron-left"></pf-icon>
          </button>
          <button
            class="nav next"
            aria-label="Next"
            ?disabled=${!hasNext}
            @click=${() => this.go(1)}
          >
            <pf-icon name="chevron-right"></pf-icon>
          </button>
          <div class="hint">
            Scroll to zoom · drag to pan · double-click to toggle 100% ·
            P proof · B background · F fullscreen · G grid · Esc to close
          </div>
        </div>
        ${this.editMode
          ? html`<div
              class="edit-panel-hotzone"
              aria-hidden="true"
              @mouseenter=${() => (this.editPanelVisible = true)}
            ></div>`
          : null}
        ${this.editMode
          ? html`<div
              class="edit-side-rail"
              @click=${(e: Event) => e.stopPropagation()}
            >
              <pf-icon-button
                icon=${this.editPanelOpenWindowed || this.fullscreen
                  ? "panel-right-close"
                  : "panel-right-open"}
                label=${this.editPanelOpenWindowed
                  ? "Hide edit panel"
                  : "Show edit panel"}
                @click=${this.toggleEditPanelWindowed}
              ></pf-icon-button>
            </div>`
          : null}
        ${this.editMode
          ? this.renderEditSidePanel()
          : null}
      </div>
      <div class="bottombar">
        <span class="menu-wrap">
          <button
            class="menu-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded=${this.openMenu === "bg"}
            @click=${() => this.toggleMenu("bg")}
          >
            <span class="swatch" style="background:${this.bgCss(this.bg)}"></span>
            BG Color: ${this.bgLabel(this.bg)}
            <pf-icon name="chevron-down"></pf-icon>
          </button>
          ${this.openMenu === "bg"
            ? html`<div class="menu-popup" role="menu">
                ${(["black", "grey", "white"] as BgColor[]).map(
                  (b) => html`<button
                    class="menu-item"
                    role="menuitemradio"
                    aria-pressed=${this.bg === b}
                    @click=${() => this.setBg(b)}
                  >
                    <span
                      class="swatch"
                      style="background:${this.bgCss(b)}"
                    ></span>
                    ${this.bgLabel(b)}
                  </button>`
                )}
              </div>`
            : null}
        </span>
        <span class="menu-wrap">
          <button
            class="menu-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded=${this.openMenu === "fit"}
            @click=${() => this.toggleMenu("fit")}
          >
            Margin: ${this.fitLabel(this.fit)}
            <pf-icon name="chevron-down"></pf-icon>
          </button>
          ${this.openMenu === "fit"
            ? html`<div class="menu-popup" role="menu">
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.fit === "contain"}
                  @click=${() => this.setFit("contain")}
                  title="No margin — image flush to the panel edges (0)"
                >
                  None
                </button>
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.fit === "tight"}
                  @click=${() => this.setFit("tight")}
                  title="Tight margin (1)"
                >
                  Tight
                </button>
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.fit === "proof"}
                  @click=${() => this.setFit("proof")}
                  title="Generous proof margin (2)"
                >
                  Proof
                </button>
              </div>`
            : null}
        </span>
        <span class="menu-wrap">
          <button
            class="menu-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded=${this.openMenu === "sizing"}
            @click=${() => this.toggleMenu("sizing")}
          >
            Scale: ${this.sizingLabel(this.sizing)}
            <pf-icon name="chevron-down"></pf-icon>
          </button>
          ${this.openMenu === "sizing"
            ? html`<div class="menu-popup" role="menu">
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.sizing === "fit"}
                  @click=${() => this.setSizing("fit")}
                  title="Image fully visible inside the margin"
                >
                  Contain
                </button>
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.sizing === "fill"}
                  @click=${() => this.setSizing("fill")}
                  title="Image fills the stage (may crop)"
                >
                  Cover
                </button>
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.sizing === "hybrid"}
                  @click=${() => this.setSizing("hybrid")}
                  title="Cover for wide landscape (≥3:2), contain otherwise"
                >
                  Hybrid
                </button>
              </div>`
            : null}
        </span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-full-view": PfFullView;
  }
}

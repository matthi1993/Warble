import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import type { Folder } from "@domain/folder";
import type { Photo, PhotoFilterInfo } from "@domain/photo";
import { buildFolderForest } from "./folder-tree";
import { buildDateTree, dateSelectionLabel, matchesDateSelection, type DateTreeNode } from "./date-tree";
import { loadVariantOverrides, reloadVariantOverrides } from "@services/library/variant-store";
import { RATING_LABEL_KEYS } from "@domain/rating";
import { flushAllPhotoEdits, reloadPhotoEdits } from "@services/edits/edits-store";
import {
  flushPhotoEffects,
  reloadPhotoEffects,
  removePhotoEffectsUnderRoot,
} from "@services/effects/effects-store";
import {
  applyRatingShortcut,
  flushPhotoRatings,
  getPhotoRating,
  loadPhotoRatings,
  reloadPhotoRatings,
  subscribePhotoRatings,
} from "@services/rating/rating-store";
import { dropAllThumbnailState, invalidateThumbnails } from "@services/images/thumbnail-service";
import { invalidateHdImages } from "@services/images/hd-image-cache";
import { invalidateFullImages } from "@services/images/full-image-cache";
import { PhotoProcessingPipeline } from "@services/library/photo-processing-pipeline";
import "./photo-grid";
import "./detail-panel";
import "./full-view";
import { beginAppBusy, subscribeAppBusy, waitForAppBusyPaint } from "@services/tasks/app-busy";
import {
  beginTask,
  subscribeTasks,
  type TaskHandle,
  type TaskRecord,
} from "@services/tasks/task-manager";
import "./pf-settings";
import "./pf-task-details";

function findFolderByPath(roots: Folder[], path: string): Folder | null {
  for (const r of roots) {
    if (r.path === path) return r;
    const child = findFolderByPath(r.children, path);
    if (child) return child;
  }
  return null;
}

interface FolderSelection {
  path: string;
  bookmark: string | null;
}

interface FolderScanProgress {
  phase: "queued" | "scanning" | "indexing" | "done" | "cancelled" | "error";
  kind: "folderTree" | "folderImages";
  rootId: string;
  folderKey: string;
  jobId: number;
  message?: string;
}

interface FolderImageUpdate {
  rootId: string;
  folderKey: string;
}

interface PhotoIndexUpdate {
  folderKey: string;
  changedImages: string[];
  metadataChanged: boolean;
}

interface FolderUpdate {
  folders: Folder[];
  rootId: string;
  folderKey: string;
  contentChanged: boolean;
}

const APP_ICON_URL = new URL("../../app-icon.png", import.meta.url).href;

function sortPhotosOldestFirst(photos: Photo[]): Photo[] {
  return [...photos].sort((a, b) => {
    const aDate = a.filterInfo?.dateTaken ?? null;
    const bDate = b.filterInfo?.dateTaken ?? null;
    if (aDate !== bDate) {
      if (aDate === null) return 1;
      if (bDate === null) return -1;
      const dateOrder = aDate.localeCompare(bDate);
      if (dateOrder !== 0) return dateOrder;
    }
    const filenameOrder = a.filename.localeCompare(b.filename, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return filenameOrder !== 0 ? filenameOrder : a.path.localeCompare(b.path);
  });
}

function isIPad(): boolean {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent ?? "";
  return /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

@customElement("warble-app")
export class WarbleApp extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      grid-template-columns: 36px 260px minmax(0, 1fr) 304px;
      grid-template-areas:
        "rail sidebar main detail"
        "footer footer footer footer";
      width: 100%;
      height: 100%;
      max-height: 100%;
      min-height: 0;
      overflow: hidden;
      padding-top: env(safe-area-inset-top);
      padding-right: env(safe-area-inset-right);
      padding-left: env(safe-area-inset-left);
      background: var(--pf-bg);
      color: var(--pf-text);
      font-family: var(--pf-font-sans);
      font-size: var(--pf-text-base);
    }
    :host(.sidebar-collapsed) {
      grid-template-columns: 36px 0 minmax(0, 1fr) 304px;
   }
   :host(.sidebar-collapsed) aside.sidebar {
     display: none;
   }
   :host(.fs-fullview) {
     position: relative;
     grid-template-rows: minmax(0, 1fr);
     grid-template-columns: minmax(0, 1fr);
     grid-template-areas: "fullview";
     padding: 0;
     --pf-fullview-left-inset: 296px;
   }
   :host(.fs-fullview.sidebar-collapsed) {
     --pf-fullview-left-inset: 36px;
   }
   :host(.fs-fullview) > .sidebar-rail {
     position: absolute;
     inset: 0 auto 0 0;
     width: 36px;
     z-index: 40;
   }
   :host(.fs-fullview) > aside.sidebar {
     position: absolute;
     inset: 0 auto 0 36px;
     width: 260px;
     z-index: 40;
   }
   :host(.fs-fullview.fs-controls-hidden) > .sidebar-rail,
   :host(.fs-fullview.fs-controls-hidden) > aside.sidebar {
     opacity: 0;
     pointer-events: none;
   }
   :host(.fs-fullview) > main.content,
   :host(.fs-fullview) > aside.detail,
   :host(.fs-fullview) > footer.app-footer {
     display: none;
   }
   :host(.fs-fullview) pf-full-view {
    grid-area: fullview;
    grid-row: 1;
    grid-column: 1;
  }
    /* Permanent left-rail that always reserves room for the sidebar
       toggle. Keeping this column in the grid — even when the
       sidebar itself is collapsed — prevents the toggle from
       overlapping the main content (e.g. the photo filename in the
       full view's toolbar). */
    .sidebar-rail {
      grid-area: rail;
      background: var(--pf-surface);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: var(--pf-space-3);
      box-sizing: border-box;
    }

    aside.sidebar {
      grid-area: sidebar;
      border-right: 1px solid var(--pf-border);
      background: var(--pf-surface);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    .sidebar-header {
      padding: var(--pf-space-2) var(--pf-space-2) var(--pf-space-4);
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-2);
    }
    .sidebar-header pf-button {
      flex: 1 1 auto;
      min-width: 0;
    }
    .sidebar-header .header-actions {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-1);
      flex: 0 0 auto;
    }
    .sidebar-brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--pf-space-2);
      min-height: 36px;
      margin-bottom: var(--pf-space-3);
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    .sidebar-brand-name {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-2);
      min-width: 0;
    }
    .sidebar-brand img {
      width: 25px;
      height: 25px;
      border-radius: 7px;
    }
    .sidebar-navigation {
      padding-bottom: var(--pf-space-3);
      border-bottom: 1px solid var(--pf-border);
    }
    .sidebar-navigation button {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      width: 100%;
      min-height: 36px;
      padding: var(--pf-space-2);
      border: 0;
      border-radius: var(--pf-radius-md);
      background: transparent;
      color: var(--pf-text);
      text-align: left;
      font: inherit;
      font-size: var(--pf-text-sm);
      cursor: pointer;
    }
    .sidebar-navigation button:hover { background: var(--pf-surface-hover); }
    .sidebar-navigation button.active { background: var(--pf-accent-soft); color: var(--pf-accent-hover); }
    .sidebar-navigation .nav-count { margin-left: auto; color: var(--pf-text-muted); font-size: var(--pf-text-xs); }
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
    .sidebar-spacer { flex: 1; }
    .folder-actions {
      flex: 0 0 auto;
      padding: var(--pf-space-3);
    }
    .add-folders-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2) var(--pf-space-3);
      border: 1px dashed var(--pf-border-strong);
      border-radius: var(--pf-radius-md);
      background: transparent;
      color: var(--pf-text-muted);
      font: inherit;
      font-size: var(--pf-text-sm);
      cursor: pointer;
      transition: background var(--pf-transition), border-color var(--pf-transition), color var(--pf-transition);
    }
    .add-folders-button:hover {
      border-color: var(--pf-accent);
      background: var(--pf-accent-soft);
      color: var(--pf-accent-hover);
    }
    .sidebar-footer {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2);
      border-top: 1px solid var(--pf-border);
      background: var(--pf-surface);
    }
    .empty-content-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--pf-space-3);
      padding: var(--pf-space-3) var(--pf-space-1) var(--pf-space-2);
      border-bottom: 1px solid var(--pf-border);
    }
    .empty-content-header h1 {
      min-width: 0;
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--pf-text-xl);
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .include-subfolders-toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-2);
      flex: 0 0 auto;
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      cursor: pointer;
      user-select: none;
    }
    .include-subfolders-toggle input {
      margin: 0;
      accent-color: var(--pf-accent);
      cursor: pointer;
    }
    .app-busy-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      background: color-mix(in srgb, var(--pf-bg) 72%, transparent);
      backdrop-filter: blur(2px);
      cursor: wait;
    }
    .app-busy-status {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--pf-space-3);
      padding: var(--pf-space-4) var(--pf-space-5);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-lg);
      background: var(--pf-surface);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
      color: var(--pf-text);
      font-size: var(--pf-text-sm);
    }
    .app-busy-spinner {
      width: 28px;
      height: 28px;
      box-sizing: border-box;
      border: 3px solid var(--pf-border);
      border-top-color: var(--pf-accent);
      border-radius: 50%;
      animation: app-busy-spin 0.75s linear infinite;
    }
    @keyframes app-busy-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .app-busy-spinner { animation-duration: 1.5s; }
    }
    .tree {
      flex: 1;
      overflow-y: auto;
      padding: var(--pf-space-3) var(--pf-space-2);
    }
    .sidebar-settings { flex: 0 0 auto; }
    .sidebar-settings pf-button { width: 100%; }
    .empty {
      color: var(--pf-text-subtle);
      font-size: var(--pf-text-sm);
      padding: var(--pf-space-2);
    }

    main.content {
      grid-area: main;
      margin: 0;
      padding: 0 var(--pf-space-4) var(--pf-space-3);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
    }
    .content-topbar {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      min-height: 46px;
      border-bottom: 1px solid var(--pf-border);
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      white-space: nowrap;
      overflow: hidden;
    }
    .content-topbar pf-icon { flex: 0 0 auto; }
    .breadcrumb-current {
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--pf-text);
    }
    .breadcrumb-separator { color: var(--pf-text-subtle); }
    .mobile-menu-button, .mobile-backdrop, .detail-backdrop, .detail-toggle { display: none; }
    .content-topbar .topbar-spacer { flex: 1; }
    .detail-toggle {
      align-items: center;
      justify-content: center;
      gap: var(--pf-space-1);
      min-height: 34px;
      padding: 0 var(--pf-space-2);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      background: var(--pf-surface);
      color: var(--pf-text);
      font: inherit;
      cursor: pointer;
      flex: 0 0 auto;
    }
    main.content > h1,
    main.content > p {
      flex: 0 0 auto;
    }
    main.content > pf-photo-grid {
      flex: 1 1 auto;
      min-height: 0;
    }
    .welcome {
      flex: 1 1 auto;
      min-height: 0;
      display: grid;
      place-items: center;
      text-align: center;
    }
    .welcome-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--pf-space-3);
      max-width: 360px;
      padding: var(--pf-space-5);
    }
    .welcome img {
      width: clamp(88px, 14vw, 132px);
      height: auto;
      border-radius: 22%;
      box-shadow: var(--pf-shadow-md);
    }
    .welcome h1,
    .welcome p {
      margin: 0;
    }
    .welcome h1 {
      font-size: var(--pf-text-xl);
    }
    .welcome p {
      max-width: 30ch;
      line-height: 1.5;
    }
    h1 {
      margin: 0 0 var(--pf-space-4);
      font-size: var(--pf-text-xl);
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    p {
      color: var(--pf-text-muted);
      font-size: var(--pf-text-sm);
    }

    aside.detail {
      grid-area: detail;
      margin: var(--pf-space-3) var(--pf-space-3) var(--pf-space-2) 0;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-lg);
      overflow: hidden;
      min-width: 0;
    }

    pf-full-view {
      grid-row: 1;
      grid-column: 3 / -1;
      min-width: 0;
      min-height: 0;
    }

    footer.app-footer {
      grid-area: footer;
      display: flex;
      align-items: center;
      gap: var(--pf-space-3);
      padding-top: 0;
      padding-right: var(--pf-space-4);
      padding-bottom: 0, env(safe-area-inset-bottom));
      padding-left: var(--pf-space-4);
      border-top: 1px solid var(--pf-border);
      background: var(--pf-surface);
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      min-height: 44px;
    }
    .footer-label {
      flex-shrink: 0;
    }
    .footer-task-spinner {
      width: 11px;
      height: 11px;
      box-sizing: border-box;
      flex: 0 0 auto;
      border: 2px solid var(--pf-border);
      border-top-color: var(--pf-accent);
      border-radius: 50%;
      animation: app-busy-spin 0.75s linear infinite;
    }
    .footer-details {
      min-height: 24px;
      padding: 2px 8px;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm);
      background: transparent;
      color: var(--pf-text-muted);
      font: inherit;
      cursor: pointer;
    }
    .footer-details:hover {
      border-color: var(--pf-accent);
      color: var(--pf-text);
    }
    .footer-task-details-wrap {
      position: relative;
      display: inline-flex;
    }
    @media (prefers-reduced-motion: reduce) {
      .footer-task-spinner { animation-duration: 1.5s; }
    }
    .footer-spacer {
      flex: 1;
    }

    .ctx-menu-backdrop {
     position: fixed;
     inset: 0;
     z-index: 1000;
   }
   .ctx-menu {
      position: fixed;
      min-width: 180px;
      background: var(--pf-surface);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      padding: var(--pf-space-1);
      font-size: var(--pf-text-sm);
      z-index: 1001;
    }
    .ctx-menu button {
      display: block;
      width: 100%;
      text-align: left;
      background: transparent;
      color: inherit;
      border: 0;
      padding: var(--pf-space-2) var(--pf-space-3);
      border-radius: var(--pf-radius-sm);
      font: inherit;
      cursor: pointer;
    }
    .ctx-menu button:hover,
    .ctx-menu button:focus-visible {
      background: var(--pf-surface-2);
      outline: none;
    }
    .ctx-menu button.danger {
      color: var(--pf-danger);
    }
    @media (pointer: coarse) {
      :host {
        grid-template-columns: 44px 260px minmax(0, 1fr) 304px;
      }
      :host(.sidebar-collapsed) {
        grid-template-columns: 44px 0 minmax(0, 1fr) 304px;
      }
      :host(.fs-fullview) { --pf-fullview-left-inset: 304px; }
      :host(.fs-fullview.sidebar-collapsed) { --pf-fullview-left-inset: 44px; }
      :host(.fs-fullview) > .sidebar-rail { width: 44px; }
      :host(.fs-fullview) > aside.sidebar { left: 44px; }
      .ctx-menu {
        min-width: 220px;
      }
      .ctx-menu button {
        min-height: 48px;
      }
    }
    @media (max-width: 1080px) {
      :host, :host(.sidebar-collapsed) {
        grid-template-columns: 36px 260px minmax(0, 1fr);
        grid-template-areas: "rail sidebar main" "footer footer footer";
      }
      :host(.sidebar-collapsed) { grid-template-columns: 36px 0 minmax(0, 1fr); }
      :host(.fs-fullview) {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: "fullview";
      }
      aside.detail { display: none; }
      .detail-toggle { display: inline-flex; }
      :host(.detail-open) aside.detail {
        display: block;
        position: fixed;
        z-index: 1101;
        inset: env(safe-area-inset-top) 0 0 auto;
        width: min(360px, 90vw);
        margin: 0;
        border-radius: var(--pf-radius-lg) 0 0 var(--pf-radius-lg);
        box-shadow: -12px 0 36px rgba(0,0,0,.35);
      }
      .detail-backdrop {
        position: fixed;
        z-index: 1100;
        inset: 0;
        background: rgba(0,0,0,.55);
      }
      :host(.detail-open) .detail-backdrop { display: block; }
      pf-full-view { grid-column: 3; }
    }
    @media (pointer: coarse) and (min-width: 701px) and (max-width: 1080px) {
      :host { grid-template-columns: 44px 260px minmax(0, 1fr); }
      :host(.sidebar-collapsed) { grid-template-columns: 44px 0 minmax(0, 1fr); }
      :host(.fs-fullview) { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 700px) {
      :host, :host(.sidebar-collapsed) {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: "main" "footer";
      }
      :host > .sidebar-rail, :host > aside.sidebar { display: none; }
      :host(.fs-fullview) { --pf-fullview-left-inset: 0px; }
      :host(.mobile-sidebar-open) > aside.sidebar {
        display: flex;
        position: fixed;
        z-index: 1101;
        inset: env(safe-area-inset-top) auto 0 0;
        width: min(300px, 84vw);
        box-shadow: 12px 0 36px rgba(0,0,0,.35);
      }
      .mobile-backdrop {
        position: fixed;
        z-index: 1100;
        inset: 0;
        background: rgba(0,0,0,.55);
      }
      :host(.mobile-sidebar-open) .mobile-backdrop { display: block; }
      main.content { padding: 0 var(--pf-space-3) var(--pf-space-2); }
      .mobile-menu-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        flex: 0 0 auto;
        border: 1px solid var(--pf-border);
        border-radius: var(--pf-radius-md);
        background: var(--pf-surface);
        color: var(--pf-text);
        font: inherit;
      }
      .content-topbar { min-height: 52px; }
      pf-full-view { grid-column: 1; }
      footer.app-footer { padding-inline: var(--pf-space-3); }
      :host(.fs-fullview) {
        grid-template-rows: minmax(0, 1fr);
        grid-template-areas: "fullview";
      }
      :host(.fs-fullview) > .mobile-backdrop { display: none; }
      :host(.fs-fullview) > .detail-backdrop { display: none; }
    }
  `;

  @state()
  private imports: Folder[] = [];

  @state()
  private photos: Photo[] = [];

  @state()
  private selectedFolderId: string | null = null;

  @state()
  private selectedFolderName: string | null = null;

  @state()
  private allPhotosSelected = false;

  @state()
  private favoritesSelected = false;

  @state()
  private daysSelected = false;

  @state()
  private selectedDateKey: string | null = null;

  @state()
  private collapsedDateNodes = new Set<string>();

  private lastFolderPath: string | null = null;

  @state()
  private libraryPhotos: Photo[] = [];

  @state()
  private restoringCachedDates = false;

  private dateTreeSource: Photo[] | null = null;
  private dateTreeLoading = false;
  private dateTree: DateTreeNode[] = [];

  private get dateNodes(): DateTreeNode[] {
    if (this.dateTreeSource !== this.libraryPhotos || this.dateTreeLoading !== this.filterMetadataLoading) {
      this.dateTreeSource = this.libraryPhotos;
      this.dateTreeLoading = this.filterMetadataLoading;
      this.dateTree = buildDateTree(this.photoPipeline.enrich(this.libraryPhotos), this.dateTreeLoading);
    }
    return this.dateTree;
  }

  @state()
  private ratingsTick = 0;

  private unsubscribeRatings: (() => void) | null = null;

  @state()
  private folderPhotoCounts: Readonly<Record<string, number>> = {};

  private indexedCountRoots = new Set<string>();
  private folderCountRequest = 0;
  private allPhotosRequest = 0;

  @state()
  private busyLabel: string | null = null;

  @state()
  private selectedPhoto: Photo | null = null;

  @state()
  private fullViewIndex: number | null = null;

  @state()
 private sidebarCollapsed = false;

  @state()
  private mobileSidebarOpen = false;

  @state()
  private detailOpen = false;


 /** Whether photo listings should recurse into all subfolders of the
  * currently selected folder. Persisted via `set_app_view`. */
 @state()
  private includeSubfolders = false;

  /** Whether the right-side edit panel is expanded in windowed mode.
   * Mirrors `pf-full-view`'s `editPanelOpenWindowed` and is persisted
   * across sessions. */
  @state()
  private editPanelOpen = false;



  /** Mirror of the OS window's fullscreen state. */
  @state()
 private windowFullscreen = false;

  @state()
  private contextMenu: {
    path: string;
    filename: string;
    x: number;
    y: number;
  } | null = null;

  @state()
  private folderContextMenu: {
    folderId: string;
    path: string;
    name: string;
    isRoot: boolean;
    available: boolean;
    x: number;
    y: number;
  } | null = null;

  private unsubscribeCacheCleared: UnlistenFn | null = null;
  private unsubscribeAppBusy: (() => void) | null = null;
  private unsubscribeFolderScanProgress: UnlistenFn | null = null;
  private unsubscribeFolderUpdates: UnlistenFn | null = null;
  private unsubscribeFolderImageUpdates: UnlistenFn | null = null;
  private unsubscribePhotoIndexUpdates: UnlistenFn | null = null;
  private folderScanTasks = new Map<number, TaskHandle>();
  private folderImageRefreshTimer: number | null = null;
  private pendingRestoreFolderPath: string | null = null;

  private readonly photoPipeline = new PhotoProcessingPipeline();

  @state()
  private filterMetadataLoading = false;

  @state()
  private activeTasks: readonly TaskRecord[] = [];

  @state()
  private recentTasks: readonly TaskRecord[] = [];

  @state()
  private taskDetailsOpen = false;

  /** Suppresses the persistence side-effect during the initial restore
   * pass so we don't immediately write back what we just read. */
  private appViewHydrated = false;

  private get folders(): Folder[] {
    return buildFolderForest(this.imports);
  }

  private async refreshFolderPhotoCounts(): Promise<void> {
    const request = ++this.folderCountRequest;
    try {
      const counts = await invoke<Record<string, number>>("get_folder_photo_counts");
      if (request === this.folderCountRequest) this.folderPhotoCounts = counts;
    } catch (error) {
      console.error("Failed to load folder photo counts", error);
    }
  }

  private indexRootsForCounts(): void {
    const available = this.imports.filter((root) => root.available);
    const ids = new Set(available.map((root) => root.id));
    for (const id of this.indexedCountRoots) {
      if (!ids.has(id)) this.indexedCountRoots.delete(id);
    }
    for (const root of available) {
      if (this.indexedCountRoots.has(root.id)) continue;
      this.indexedCountRoots.add(root.id);
      this.requestFolderImageIndex(root.path, true);
    }
  }

  private selectAllPhotos = () => {
    this.allPhotosSelected = true;
    this.favoritesSelected = false;
    this.daysSelected = false;
    this.selectedFolderId = null;
    this.selectedFolderName = null;
    this.selectedPhoto = null;
    this.fullViewIndex = null;
    this.mobileSidebarOpen = false;
    this.detailOpen = false;
    this.showLibraryPhotos();
    void this.refreshAllPhotos();
  };

  private selectFavorites = () => {
    this.allPhotosSelected = false;
    this.favoritesSelected = true;
    this.daysSelected = false;
    this.selectedFolderId = null;
    this.selectedFolderName = null;
    this.selectedPhoto = null;
    this.fullViewIndex = null;
    this.mobileSidebarOpen = false;
    this.detailOpen = false;
    this.showLibraryPhotos();
    void this.refreshAllPhotos();
  };

  private selectFolders = () => {
    if (this.selectedFolderId && !this.daysSelected && !this.allPhotosSelected && !this.favoritesSelected) return;
    this.daysSelected = false;
    this.allPhotosSelected = false;
    this.favoritesSelected = false;
    const previousFolder = this.lastFolderPath ? findFolderByPath(this.folders, this.lastFolderPath) : null;
    const folder = (previousFolder?.available ? previousFolder : null)
      || this.folders.find((root) => root.available);
    if (folder?.available) {
      void this.selectFolder(folder.id, folder.path);
    } else {
      this.selectedFolderId = null;
      this.selectedFolderName = null;
      this.selectedPhoto = null;
      this.fullViewIndex = null;
      this.setPhotos([]);
    }
    this.mobileSidebarOpen = false;
  };

  private selectDays = () => {
    if (this.daysSelected) return;
    this.stopPhotoBackgroundWork();
    this.pendingRestoreFolderPath = null;
    this.daysSelected = true;
    this.allPhotosSelected = false;
    this.favoritesSelected = false;
    this.selectedFolderId = null;
    this.selectedFolderName = null;
    this.selectedDateKey = null;
    this.selectedPhoto = null;
    this.fullViewIndex = null;
    this.mobileSidebarOpen = false;
    this.detailOpen = false;
    this.showLibraryPhotos();
    if (!this.restoringCachedDates) this.startPhotoBackgroundWork();
    if (!this.libraryPhotos.length && this.imports.length > 0) void this.refreshAllPhotos();
  };

  private selectDate = (key: string) => {
    if (this.selectedDateKey === key) return;
    this.selectedDateKey = key;
    this.selectedPhoto = null;
    this.fullViewIndex = null;
    this.mobileSidebarOpen = false;
    this.detailOpen = false;
    this.showLibraryPhotos(false);
  };

  private toggleDateNode = (key: string) => {
    const collapsed = new Set(this.collapsedDateNodes);
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    this.collapsedDateNodes = collapsed;
  };

  private renderDateNode(node: DateTreeNode, depth = 0): ReturnType<typeof html> {
    const expanded = !this.collapsedDateNodes.has(node.key);
    return html`
      <div class=${`date-tree-row ${this.selectedDateKey === node.key ? "selected" : ""} ${depth === 0 ? "root" : ""}`}>
        ${node.children.length ? html`<button class="date-tree-toggle" type="button" aria-label=${`${expanded ? "Collapse" : "Expand"} ${node.label}`}
          aria-expanded=${expanded} @click=${() => this.toggleDateNode(node.key)}><pf-icon name="chevron-down"></pf-icon></button>`
          : html`<span class="date-tree-toggle"></span>`}
        <button class="date-tree-label" type="button" aria-current=${this.selectedDateKey === node.key ? "page" : "false"}
          @click=${() => this.selectDate(node.key)}>${node.label}</button>
        <span class="date-tree-count">${node.count}</span>
      </div>
      ${expanded && node.children.length ? html`<div class="date-tree-children">${node.children.map((child) => this.renderDateNode(child, depth + 1))}</div>` : null}
    `;
  }

  private showLibraryPhotos(restartMetadata = true): void {
    if (!this.allPhotosSelected && !this.favoritesSelected && !this.daysSelected) return;
    const photos = this.favoritesSelected
      ? this.libraryPhotos.filter((photo) => getPhotoRating(photo.path).rating >= 1)
      : this.daysSelected
        ? this.photoPipeline.enrich(this.libraryPhotos).filter((photo) => matchesDateSelection(photo, this.selectedDateKey))
        : this.libraryPhotos;
    const selectedPath = this.selectedPhoto?.path;
    const previousIndex = this.fullViewIndex;
    this.setPhotos(photos, restartMetadata && !this.daysSelected);
    if (!selectedPath) return;
    const selectedIndex = this.photos.findIndex((photo) => photo.path === selectedPath);
    if (selectedIndex >= 0) {
      this.selectedPhoto = this.photos[selectedIndex];
      if (previousIndex !== null) this.fullViewIndex = selectedIndex;
    } else if (previousIndex !== null && this.photos.length > 0) {
      const index = Math.min(previousIndex, this.photos.length - 1);
      this.selectedPhoto = this.photos[index];
      this.fullViewIndex = index;
    } else {
      this.selectedPhoto = null;
      this.fullViewIndex = null;
    }
  }

  private async refreshAllPhotos(): Promise<void> {
    const request = ++this.allPhotosRequest;
    try {
      const photos = await invoke<Photo[]>("get_all_photos");
      if (request !== this.allPhotosRequest) return;
      this.restoringCachedDates = true;
      this.libraryPhotos = photos;
      if (!this.daysSelected) this.showLibraryPhotos(false);
      try {
        const cached = await invoke<Array<PhotoFilterInfo & { path: string }>>(
          "get_cached_photo_filter_metadata",
          { photoPaths: photos.map((photo) => photo.path) },
        );
        if (request !== this.allPhotosRequest) return;
        this.photoPipeline.restore(cached);
        this.libraryPhotos = this.photoPipeline.enrich(photos);
        this.showLibraryPhotos(false);
        if (this.selectedFolderId) this.applyPhotoMetadata();
      } catch (error) {
        console.warn("Failed to restore cached photo dates", error);
        if (request === this.allPhotosRequest) this.showLibraryPhotos(false);
      }
      if (request === this.allPhotosRequest) {
        this.restoringCachedDates = false;
        this.startPhotoBackgroundWork();
      }
    } catch (error) {
      if (request === this.allPhotosRequest) this.restoringCachedDates = false;
      console.error("Failed to load all photos", error);
    }
  }

  async connectedCallback() {
   super.connectedCallback();
   window.addEventListener("keydown", this.onGlobalKey);
   this.unsubscribeAppBusy = subscribeAppBusy((label) => {
     this.busyLabel = label;
   });
   this.unsubscribeTasks = subscribeTasks((tasks, recentTasks) => {
     this.activeTasks = tasks;
     this.recentTasks = recentTasks;
   });
   this.unsubscribeRatings = subscribePhotoRatings((path) => {
     this.ratingsTick++;
     if (this.favoritesSelected && (path === "" ||
       (this.libraryPhotos.some((photo) => photo.path === path) &&
         this.photos.some((photo) => photo.path === path) !== (getPhotoRating(path).rating >= 1)))) {
       this.showLibraryPhotos();
     }
   });
   this.unlistenFoldersRehydrated = await listen("folders-rehydrated", () => {
     void this.onFoldersRehydrated();
   });
   this.unsubscribeFolderScanProgress = await listen<FolderScanProgress>(
     "folder-scan-progress",
     (event) => this.onFolderScanProgress(event.payload),
   );
   this.unsubscribeFolderUpdates = await listen<FolderUpdate>(
     "folders-updated",
     (event) => void this.onFoldersUpdated(event.payload),
   );
   this.unsubscribeFolderImageUpdates = await listen<FolderImageUpdate>(
     "folder-images-updated",
     (event) => this.onFolderImagesUpdated(event.payload),
   );
   this.unsubscribePhotoIndexUpdates = await listen<PhotoIndexUpdate>(
     "photo-index-synced",
     (event) => void this.onPhotoIndexSynced(event.payload),
   );
    // Menu-driven "Clear Thumbnail Cache" wipes the disk cache; here we
    // also drop the renderer-side binary JPEG LRU so on-screen cards
    // re-decode from source.
    void listen<string>("cache-cleared", (event) => {
      if (event.payload === "thumbnail_disk") {
        this.refreshAfterThumbnailCacheClear();
      }
    }).then((unlisten) => {
      this.unsubscribeCacheCleared = unlisten;
    });
    try {
      const persisted = await invoke<Folder[]>("list_imported_folders");
      if (persisted.length > 0) {
        this.imports = persisted;
      }
    } catch (err) {
      console.error("Failed to load imported folders", err);
    }

    // Hydrate per-photo variant preferences before any thumbnail or
    // detail panel asks for an effective selection.
    void loadVariantOverrides();
    void loadPhotoRatings();

    // Auto-open the folder the user had selected last session.
    try {
      const lastPath = await invoke<string | null>("get_last_folder");
      if (lastPath) {
        const folder = findFolderByPath(this.folders, lastPath);
        if (folder) {
          await this.selectFolder(folder.id, folder.path);
        } else {
          this.pendingRestoreFolderPath = lastPath;
        }
      }
    } catch (err) {
      console.error("Failed to restore last folder", err);
    }

    // Restore the photo + surface (grid vs full view) the user had open.
    // Runs AFTER the folder restore so `this.photos` is populated.
    try {
      const persisted = await invoke<{
        path?: string | null;
        view?: string | null;
        sidebarCollapsed?: boolean | null;
        editPanelOpen?: boolean | null;
        includeSubfolders?: boolean | null;
      } | null>("get_app_view");
      if (persisted) {
        if (typeof persisted.sidebarCollapsed === "boolean") {
          this.sidebarCollapsed = persisted.sidebarCollapsed;
        }
        if (typeof persisted.editPanelOpen === "boolean") {
          this.editPanelOpen = persisted.editPanelOpen;
        }
        if (typeof persisted.includeSubfolders === "boolean") {
          this.includeSubfolders = persisted.includeSubfolders;
          if (this.includeSubfolders && this.selectedFolderId) {
            // Re-fetch with the restored recursive flag so the grid
            // matches the persisted toggle state.
            try {
              this.requestFolderImageIndex(this.selectedFolderId, true);
              this.setPhotos(await invoke<Photo[]>("get_photos_in_folder", {
                folderPath: this.selectedFolderId,
                recursive: true,
              }));
            } catch (err) {
              console.error("Failed to refresh photos with subfolders", err);
            }
          }
        }
        if (persisted.path) {
          const idx = this.photos.findIndex((p) => p.path === persisted.path);
          if (idx >= 0) {
            this.selectedPhoto = this.photos[idx];
            if (persisted.view === "full") {
              this.fullViewIndex = idx;
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to restore last view", err);
    } finally {
      this.appViewHydrated = true;
    }
  }

  private unlistenFoldersRehydrated: UnlistenFn | null = null;
  private unsubscribeTasks: (() => void) | null = null;

  private setPhotos(photos: Photo[], restartMetadata = true): void {
    this.photos = sortPhotosOldestFirst(this.photoPipeline.enrich(photos));
    if (restartMetadata) this.startPhotoBackgroundWork();
  }

  private startPhotoBackgroundWork(): void {
    if (this.fullViewIndex !== null) return;
    this.photoPipeline.start(
      this.libraryPhotos.length > 0 ? this.libraryPhotos : this.photos,
      () => this.daysSelected ? this.applyDateMetadata() : this.applyPhotoMetadata(),
      () => this.photos.map((photo) => photo.path),
      (loading) => { this.filterMetadataLoading = loading; },
    );
  }

  private stopPhotoBackgroundWork(): void {
    this.photoPipeline.stop();
  }

  private applyPhotoMetadata(): void {
    if (this.libraryPhotos.length > 0) this.libraryPhotos = this.photoPipeline.enrich(this.libraryPhotos);
    const enriched = sortPhotosOldestFirst(this.photoPipeline.enrich(this.photos));
    this.photos = enriched;
    const selectedPath = this.selectedPhoto?.path;
    if (selectedPath) {
      this.selectedPhoto = enriched.find((photo) => photo.path === selectedPath) ?? this.selectedPhoto;
      if (this.fullViewIndex !== null) {
        const sortedIndex = enriched.findIndex((photo) => photo.path === selectedPath);
        if (sortedIndex >= 0) this.fullViewIndex = sortedIndex;
      }
    }
  }

  private applyDateMetadata(): void {
    this.libraryPhotos = this.photoPipeline.enrich(this.libraryPhotos);
    this.showLibraryPhotos(false);
  }

  disconnectedCallback(): void {
   super.disconnectedCallback();
   this.unlistenFoldersRehydrated?.();
   this.unsubscribeFolderScanProgress?.();
   this.unsubscribeFolderScanProgress = null;
   this.unsubscribeFolderUpdates?.();
   this.unsubscribeFolderUpdates = null;
   this.unsubscribeFolderImageUpdates?.();
   this.unsubscribeFolderImageUpdates = null;
  this.unsubscribePhotoIndexUpdates?.();
  this.unsubscribePhotoIndexUpdates = null;
   if (this.folderImageRefreshTimer !== null) {
     window.clearTimeout(this.folderImageRefreshTimer);
     this.folderImageRefreshTimer = null;
   }
   for (const task of this.folderScanTasks.values()) task.finish("cancelled");
   this.folderScanTasks.clear();
   window.removeEventListener("keydown", this.onGlobalKey);
    this.unsubscribeCacheCleared?.();
    this.unsubscribeCacheCleared = null;
    this.unsubscribeAppBusy?.();
    this.unsubscribeAppBusy = null;
    this.unsubscribeTasks?.();
    this.unsubscribeTasks = null;
    this.unsubscribeRatings?.();
    this.unsubscribeRatings = null;
    this.stopPhotoBackgroundWork();
  }

  private refreshAfterThumbnailCacheClear(): void {
    dropAllThumbnailState();
    // Force every thumbnail card to forget its current image and
    // re-request via the empty cache. Re-keying photos by reassigning a
    // fresh array makes Lit's `repeat` rerun, but identity-stable keys
    // would short-circuit; instead we walk the live cards and reset
    // them.
    const grid = this.renderRoot.querySelector(
      "pf-photo-grid"
    ) as import("./photo-grid").PfPhotoGrid | null;
    grid?.renderRoot
      .querySelectorAll("pf-thumbnail-card")
      .forEach((card) => {
        (card as HTMLElement & { reload?: () => void }).reload?.();
      });
  }

  /**
   * App-level keyboard shortcuts. Routes a small set of "always on" keys
   * (`f`, `g`, `Escape`) regardless of which view is active, then falls
   * through to grid-only keys when the full view is closed. The full
   * view installs its own capture-phase listener for navigation/fit/bg
   * keys; we run after it on the bubble phase, so this code never
   * fights with the full view over arrow/p/b/0/1/2.
   */

  private onGlobalKey = (e: KeyboardEvent) => {
    // Events crossing nested shadow roots retarget `e.target` to the host.
    // Use the original composed-path node so text fields (notably the preset
    // name input) always own their keystrokes instead of triggering shortcuts.
    const target = e.composedPath()[0];
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    if (e.code === "Space" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const viewer = this.renderRoot.querySelector("pf-full-view") as import("./full-view").PfFullView | null;
      if (viewer?.presentationActive) {
        e.preventDefault();
        viewer.stopPresentation();
        return;
      }
      if (!this.photos.length) return;
      e.preventDefault();
      if (this.fullViewIndex === null) {
        const selectedIndex = this.photos.findIndex((photo) => photo.path === this.selectedPhoto?.path);
        const index = selectedIndex >= 0 ? selectedIndex : 0;
        this.selectedPhoto = this.photos[index];
        this.fullViewIndex = index;
        void this.updateComplete.then(() => this.onSlideshowStart());
      } else {
        void this.onSlideshowStart();
      }
      return;
    }

    // `f` toggles window fullscreen from any view.
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      void this.toggleWindowFullscreen();
      return;
    }

    // `Esc` always returns to the most recent non-fullscreen view:
    //   - if the OS window is fullscreen → exit fullscreen first
    //     (whatever view we were in stays put)
    //   - else if the full view is open → close it back to the grid
    //   - else → no-op
    if (e.key === "Escape") {
      const viewer = this.renderRoot.querySelector("pf-full-view") as import("./full-view").PfFullView | null;
      if (viewer?.presentationActive) {
        e.preventDefault();
        viewer.stopPresentation();
        return;
      }
      if (this.contextMenu) {
        e.preventDefault();
        e.stopPropagation();
        this.contextMenu = null;
        return;
      }
      if (this.folderContextMenu) {
        e.preventDefault();
        e.stopPropagation();
        this.folderContextMenu = null;
        return;
      }
      if (this.windowFullscreen) {
        e.preventDefault();
        e.stopPropagation();
        void this.setWindowFullscreen(false);
        return;
      }
      if (this.fullViewIndex !== null) {
        e.preventDefault();
        e.stopPropagation();
        this.onFullViewClose();
        return;
      }
      return;
    }

    // `g` toggles between grid and full-image view.
    if (e.key === "g" || e.key === "G") {
      if (this.fullViewIndex !== null) {
        e.preventDefault();
        this.onFullViewClose();
        return;
      }
      const idx = this.selectedPhoto
        ? this.photos.findIndex((p) => p.path === this.selectedPhoto!.path)
        : 0;
      if (idx >= 0 && idx < this.photos.length) {
        e.preventDefault();
        this.selectedPhoto = this.photos[idx];
        this.fullViewIndex = idx;
      }
      return;
    }

    // While the full view is open, let it handle its own remaining keys.
    if (this.fullViewIndex !== null) return;

    // Star ratings (1–5) and color labels (6–9, 0). Apply to the
    // currently-selected grid photo, falling back to the first card
    // if nothing is selected yet.
    if (RATING_LABEL_KEYS.has(e.key)) {
      const target =
        this.selectedPhoto ?? (this.photos.length > 0 ? this.photos[0] : null);
      if (target) {
        e.preventDefault();
        applyRatingShortcut(target.path, e.key);
      }
      return;
    }

    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown"
    ) {
      const grid = this.renderRoot.querySelector(
        "pf-photo-grid"
      ) as import("./photo-grid").PfPhotoGrid | null;
      if (!grid) return;
      const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (grid.moveSelection(dx, dy)) e.preventDefault();
      return;
    }

    if (e.key === "Enter") {
      const grid = this.renderRoot.querySelector(
        "pf-photo-grid"
      ) as import("./photo-grid").PfPhotoGrid | null;
      if (grid && this.selectedPhoto) {
        e.preventDefault();
        grid.openSelected();
      }
    }
  };

  private async setWindowFullscreen(enable: boolean) {
    // An iPad app already owns its UIWindow, and iOS ignores requests to
    // leave native window fullscreen. Keep photo fullscreen as a reversible
    // UI state there; the iOS bundle config supplies the immersive window and
    // hidden status bar. This also avoids depending on WebKit's unsupported
    // DOM Fullscreen API.
    if (isIPad()) {
      this.windowFullscreen = enable;
      return;
    }
    try {
      await getCurrentWindow().setFullscreen(enable);
      this.windowFullscreen = enable;
    } catch (err) {
      console.error("setFullscreen failed", err);
      return;
    }
    // Exiting fullscreen on macOS sometimes leaves the webview without
    // keyboard focus, which silently breaks every shortcut until the
    // user clicks back into the window. Force focus back to the Tauri
    // window AND to this element so the global keydown listener keeps
    // firing.
    if (!enable) {
      try {
        await getCurrentWindow().setFocus();
      } catch (err) {
        console.warn("setFocus failed", err);
      }
      // Defer until after the OS animation settles.
      window.setTimeout(() => {
        this.tabIndex = -1;
        this.focus();
      }, 50);
    }
  }

  private toggleWindowFullscreen = async () => {
    await this.setWindowFullscreen(!this.windowFullscreen);
  };

  private onToggleFullscreenRequest = () => {
    void this.toggleWindowFullscreen();
  };

  private async importFolder() {
    const endBusy = beginAppBusy("Adding folders…");
    try {
      await waitForAppBusyPaint();
      const selections = await invoke<FolderSelection[]>("select_folders_dialog");
      if (!selections || selections.length === 0) return;
      // Keep the picker order so the backend can reliably reject nested or
      // otherwise overlapping roots selected in the same dialog. A parent
      // selected after its children consolidates them into one root. The
      // backend persists all selections before performing one catalog scan.
      const result = await invoke<{
        folders: Folder[];
        imported: Folder[];
      }>("import_folders", { selections });
      this.imports = result.folders;
      const imported = result.imported;
      await Promise.all([
        reloadPhotoEdits(),
        reloadPhotoEffects(),
        reloadPhotoRatings(),
        reloadVariantOverrides(),
      ]);

      // If consolidation replaced the currently selected child UUID, move
      // the view to the new parent instead of leaving a stale empty selection.
      if (
        this.selectedFolderId &&
        !findFolderByPath(this.imports, this.selectedFolderId)
      ) {
        const replacement = imported
          .map((folder) => findFolderByPath(this.imports, folder.path))
          .find((folder): folder is Folder => folder !== null);
        if (replacement) await this.selectFolder(replacement.id, replacement.path);
      }
    } catch (err) {
      console.error("Failed to import media root", err);
      void message(`Failed to add folders: ${err}`, {
        title: "Add Folders",
        kind: "error",
      });
    } finally {
      endBusy();
    }
  }

  private async reconnectRoot(e: CustomEvent<{ rootId: string }>) {
    e.stopPropagation();
    const endBusy = beginAppBusy("Reconnecting folder…");
    try {
      await waitForAppBusyPaint();
      const selections = await invoke<FolderSelection[]>("select_folders_dialog");
      const selection = selections?.[0];
      if (!selection) return;
      await this.flushPendingPhotoWrites();
      this.imports = await invoke<Folder[]>("bind_media_root", {
        rootId: e.detail.rootId,
        path: selection.path,
        bookmark: selection.bookmark,
      });
      await Promise.all([
        reloadPhotoEdits(),
        reloadPhotoEffects(),
        reloadPhotoRatings(),
        reloadVariantOverrides(),
      ]);
      if (
        this.selectedFolderId &&
        !findFolderByPath(this.imports, this.selectedFolderId)
      ) {
        const replacement = this.imports.find((folder) => folder.available);
        if (replacement) await this.selectFolder(replacement.id, replacement.path);
      }
    } catch (err) {
      console.error("Failed to reconnect media root", err);
      void message(`Failed to reconnect folder: ${err}`, {
        title: "Reconnect Folder",
        kind: "error",
      });
    } finally {
      endBusy();
    }
  }

  private async flushPendingPhotoWrites() {
    await Promise.all([
      flushAllPhotoEdits(),
      flushPhotoEffects(),
      flushPhotoRatings(),
    ]);
  }

  /** Queue an independent background scan for every connected root. */
  private async refreshFolders() {
    try {
      await this.flushPendingPhotoWrites();
      this.imports = await invoke<Folder[]>("refresh_imported_folders");
    } catch (err) {
      console.error("Failed to refresh imported folders", err);
    }
  }

  private onFolderScanProgress(progress: FolderScanProgress): void {
    let task = this.folderScanTasks.get(progress.jobId);
    if (progress.phase === "queued") {
      task = beginTask({
        kind: "folder",
        label: progress.kind === "folderTree" ? "Scan folder structure" : "Index folder images",
        priority: "background",
        status: "queued",
        target: progress.folderKey,
      });
      this.folderScanTasks.set(progress.jobId, task);
      return;
    }
    if (progress.phase === "scanning" || progress.phase === "indexing") {
      if (!task) {
        task = beginTask({
          kind: "folder",
          label: progress.kind === "folderTree" ? "Scan folder structure" : "Index folder images",
          priority: "background",
          target: progress.folderKey,
        });
        this.folderScanTasks.set(progress.jobId, task);
      }
      task.update({
        status: "running",
        label: progress.kind === "folderTree"
          ? "Scan folder structure"
          : "Index folder images",
      });
      return;
    }
    if (!task) return;
    task.finish(
      progress.phase === "done"
        ? "completed"
        : progress.phase === "error"
          ? "failed"
          : "cancelled",
    );
    this.folderScanTasks.delete(progress.jobId);
    if (progress.phase === "error") {
      console.error(`Failed to scan ${progress.folderKey}: ${progress.message ?? "unknown error"}`);
    }
  }

  private async onFoldersUpdated(update: FolderUpdate): Promise<void> {
    this.imports = update.folders;
    if (update.contentChanged) {
      const root = this.imports.find((item) => item.id === update.rootId);
      if (root?.available) this.requestFolderImageIndex(root.path, true);
    }
    if (update.contentChanged && this.pendingRestoreFolderPath) {
      const restored = findFolderByPath(this.imports, this.pendingRestoreFolderPath);
      if (restored) {
        this.pendingRestoreFolderPath = null;
        await this.selectFolder(restored.id, restored.path);
        return;
      }
    }
    if (!update.contentChanged || !this.selectedFolderId) return;
    const selectedPath = this.selectedFolderId;
    const selectedInsideScan =
      selectedPath === update.folderKey ||
      selectedPath.startsWith(`${update.folderKey}/`);
    const scanInsideRecursiveSelection =
      this.includeSubfolders && update.folderKey.startsWith(`${selectedPath}/`);
    if (!selectedInsideScan && !scanInsideRecursiveSelection) return;

    try {
      this.requestFolderImageIndex(selectedPath, this.includeSubfolders);
      const selected = findFolderByPath(this.imports, selectedPath);
      if (selected) {
        const photos = await invoke<Photo[]>("get_photos_in_folder", {
          folderPath: selected.path,
          recursive: this.includeSubfolders,
        });
        if (this.selectedFolderId !== selectedPath) return;
        this.setPhotos(photos);
        return;
      }
      const fallback = findFolderByPath(this.imports, update.folderKey);
      if (fallback) await this.selectFolder(fallback.id, fallback.path);
    } catch (error) {
      console.error("Failed to refresh photos after folder scan", error);
    }
  }

  private requestFolderImageIndex(folderPath: string, recursive: boolean): void {
    void invoke("index_folder_images", { folderPath, recursive }).catch((error) =>
      console.error("Failed to queue folder image indexing", error)
    );
  }

  private onFolderImagesUpdated(update: FolderImageUpdate): void {
    void this.refreshFolderPhotoCounts();
    void this.refreshAllPhotos();
    if (this.allPhotosSelected || this.favoritesSelected) {
      return;
    }
    if (!this.selectedFolderId) return;
    const affectsSelection =
      update.folderKey === this.selectedFolderId ||
      (this.includeSubfolders && update.folderKey.startsWith(`${this.selectedFolderId}/`));
    if (!affectsSelection) return;
    if (this.folderImageRefreshTimer !== null) {
      window.clearTimeout(this.folderImageRefreshTimer);
    }
    this.folderImageRefreshTimer = window.setTimeout(() => {
      this.folderImageRefreshTimer = null;
      void this.refreshSelectedPhotosFromIndex();
    }, 100);
  }

  private async onPhotoIndexSynced(update: PhotoIndexUpdate): Promise<void> {
    void this.refreshFolderPhotoCounts();
    if (update.changedImages.length > 0) {
      this.photoPipeline.invalidate(update.changedImages);
      const changed = new Set(update.changedImages);
      this.photos = this.photos.map((photo) => changed.has(photo.path) ? { ...photo, filterInfo: undefined } : photo);
      if (this.selectedPhoto && changed.has(this.selectedPhoto.path)) {
        this.selectedPhoto = { ...this.selectedPhoto, filterInfo: undefined };
      }
      invalidateThumbnails(update.changedImages);
      invalidateHdImages(update.changedImages);
      invalidateFullImages(update.changedImages);
      if (this.selectedPhoto && changed.has(this.selectedPhoto.path)) {
        (this.renderRoot.querySelector("pf-full-view") as import("./full-view").PfFullView | null)
          ?.refreshPhotoSource(this.selectedPhoto.path);
      }
      const grid = this.renderRoot.querySelector("pf-photo-grid") as import("./photo-grid").PfPhotoGrid | null;
      grid?.renderRoot
        .querySelectorAll("pf-thumbnail-card")
        .forEach((card) => {
          if (changed.has((card as HTMLElement & { path: string }).path)) {
            (card as HTMLElement & { reload(): void }).reload();
          }
        });
    }
    if (update.metadataChanged) {
      try {
        await this.flushPendingPhotoWrites();
      } catch (error) {
        console.error("Could not reconcile photo metadata with pending local writes", error);
        return;
      }
      await Promise.all([
        reloadPhotoEdits(),
        reloadPhotoEffects(),
        reloadPhotoRatings(),
      ]);
    }
    if (update.changedImages.length > 0 || update.metadataChanged) {
      void this.refreshAllPhotos();
    }
    if (this.selectedFolderId && (
      this.selectedFolderId === update.folderKey ||
      this.selectedFolderId.startsWith(`${update.folderKey}/`) ||
      (this.includeSubfolders && update.folderKey.startsWith(`${this.selectedFolderId}/`))
    )) {
      await this.refreshSelectedPhotosFromIndex();
    }
  }

  private async refreshSelectedPhotosFromIndex(): Promise<void> {
    const folderPath = this.selectedFolderId;
    if (!folderPath) return;
    try {
      const photos = await invoke<Photo[]>("get_photos_in_folder", {
        folderPath,
        recursive: this.includeSubfolders,
      });
      if (this.selectedFolderId === folderPath) this.setPhotos(photos);
    } catch (error) {
      console.error("Failed to load indexed folder images", error);
    }
  }

  private async onFolderSelect(
    e: CustomEvent<{ id: string; path: string }>
  ) {
    const { id, path } = e.detail;
    this.mobileSidebarOpen = false;
    await this.selectFolder(id, path);
  }

  private clearFolderSelection = () => {
    if (this.selectedFolderId === null && !this.allPhotosSelected && !this.favoritesSelected) return;
    this.allPhotosSelected = false;
    this.favoritesSelected = false;
    this.daysSelected = false;
    this.selectedFolderId = null;
    this.selectedFolderName = null;
    this.selectedPhoto = null;
    this.fullViewIndex = null;
    this.setPhotos([]);
    void invoke("set_last_folder", { path: "" }).catch((err) =>
      console.error("Failed to clear last folder", err)
    );
  };

  private onFolderTreeClick = (event: MouseEvent) => {
    const clickedFolder = event.composedPath().some(
      (node) => node instanceof HTMLElement && node.tagName === "PF-FOLDER-TREE-ITEM"
    );
    if (!clickedFolder) this.clearFolderSelection();
  };

  private async selectFolder(id: string, path: string) {
    this.allPhotosSelected = false;
    this.favoritesSelected = false;
    this.daysSelected = false;
    this.lastFolderPath = path;
    this.stopPhotoBackgroundWork();
    this.pendingRestoreFolderPath = null;
    this.selectedFolderId = id;
    const name = findFolderByPath(this.imports, path)?.name ?? path.split("/").filter(Boolean).pop() ?? path;
    this.selectedFolderName = name;
    this.requestFolderImageIndex(path, this.includeSubfolders);
    const photos = await invoke<Photo[]>("get_photos_in_folder", {
      folderPath: path,
      recursive: this.includeSubfolders,
    });
    // The user may have selected another folder—or blank sidebar space—while
    // the provider was still loading this one. Never restore a stale result.
    if (this.selectedFolderId !== id || this.daysSelected || this.allPhotosSelected || this.favoritesSelected) return;
    this.setPhotos(photos);
    // If the full view is open, jump to the first photo of the new
    // folder so the user sees something immediately (not a blank
    // screen from the stale index). Close the full view if the
    // new folder is empty.
    if (this.fullViewIndex !== null) {
      if (this.photos.length > 0) {
        this.selectedPhoto = this.photos[0];
        this.fullViewIndex = 0;
      } else {
        this.selectedPhoto = null;
        this.fullViewIndex = null;
      }
    } else {
      this.selectedPhoto = null;
    }
    void invoke("set_last_folder", { path }).catch((err) =>
      console.error("Failed to persist last folder", err)
    );
  }

  private onPhotoSelected(
    e: CustomEvent<{ path: string; filename: string }>
  ) {
    this.selectedPhoto = this.photos.find((photo) => photo.path === e.detail.path) ?? null;
  }

  private onPhotoOpen(
    e: CustomEvent<{ path: string; filename: string }>
  ) {
    const idx = this.photos.findIndex((p) => p.path === e.detail.path);
    if (idx >= 0) {
      this.detailOpen = false;
      this.selectedPhoto = this.photos[idx];
      this.fullViewIndex = idx;
    }
  }

  private onPhotoCatalogChanged(
    e: CustomEvent<{
      kind: "save" | "variant-delete" | "photo-delete";
      photoPath: string;
      memberPaths: string[];
      previousIndex: number;
      waitUntil?: (operation: Promise<void>) => void;
    }>,
  ) {
    const operation = this.refreshAfterPhotoCatalogChange(e.detail);
    e.detail.waitUntil?.(operation);
  }

  private async refreshAfterPhotoCatalogChange(detail: {
    kind: "save" | "variant-delete" | "photo-delete";
    photoPath: string;
    memberPaths: string[];
    previousIndex: number;
  }): Promise<void> {
    const { kind, photoPath, memberPaths, previousIndex } = detail;
    if (!this.selectedFolderId && !this.allPhotosSelected && !this.favoritesSelected && !this.daysSelected) return;
    try {
      await invoke("refresh_photo_parent", {
        photoPath,
      });
      void this.refreshFolderPhotoCounts();
      if (this.allPhotosSelected || this.favoritesSelected || this.daysSelected) {
        await this.refreshAllPhotos();
      } else {
        this.setPhotos(await invoke<Photo[]>("get_photos_in_folder", {
            folderPath: this.selectedFolderId,
            recursive: this.includeSubfolders,
        }));
        void this.refreshAllPhotos();
      }
      if (kind === "photo-delete") {
        if (this.photos.length === 0) {
          this.selectedPhoto = null;
          this.fullViewIndex = null;
        } else {
          const idx = Math.min(previousIndex, this.photos.length - 1);
          this.selectedPhoto = this.photos[idx];
          if (this.fullViewIndex !== null) this.fullViewIndex = idx;
        }
      } else {
        const oldMembers = new Set(memberPaths);
        const idx = this.photos.findIndex(
          (photo) =>
            photo.path === photoPath ||
            photo.files?.some((file) => oldMembers.has(file.path)),
        );
        if (idx >= 0) {
          this.selectedPhoto = this.photos[idx];
          if (this.fullViewIndex !== null) this.fullViewIndex = idx;
        }
      }
    } catch (error) {
      console.error("Failed to refresh after changing photo files", error);
    }
  }

  private onPhotoContextMenu(
    e: CustomEvent<{ path: string; filename: string; x: number; y: number }>
  ) {
    this.contextMenu = { ...e.detail };
  }

  private dismissContextMenu = () => {
    if (this.contextMenu) this.contextMenu = null;
  };

  private onFolderContextMenu(
    e: CustomEvent<{
      folderId: string;
      path: string;
      name: string;
      isRoot: boolean;
      available: boolean;
      x: number;
      y: number;
    }>,
  ) {
    e.stopPropagation();
    this.contextMenu = null;
    this.folderContextMenu = { ...e.detail };
  }

  private dismissFolderContextMenu = () => {
    this.folderContextMenu = null;
  };

  private async syncFolder(path: string, name: string) {
    this.folderContextMenu = null;
    try {
      await this.flushPendingPhotoWrites();
      this.imports = await invoke<Folder[]>("refresh_folder", {
        folderPath: path,
      });
    } catch (err) {
      console.error(`Failed to sync ${name}`, err);
    }
  }

  private async removeImportedFolder(rootId: string) {
    this.folderContextMenu = null;
    const endBusy = beginAppBusy("Removing folder…");
    try {
      await waitForAppBusyPaint();
      removePhotoEffectsUnderRoot(rootId);
      await this.flushPendingPhotoWrites();
      this.imports = await invoke<Folder[]>("remove_imported_folder", { rootId });
      const selectedIsInsideRoot =
        this.selectedFolderId === rootId ||
        this.selectedFolderId?.startsWith(`${rootId}/`) === true;
      if (selectedIsInsideRoot) {
        this.selectedFolderId = null;
        this.selectedFolderName = null;
        this.selectedPhoto = null;
        this.fullViewIndex = null;
        this.setPhotos([]);
        void invoke("set_last_folder", { path: "" });
      }
    } catch (err) {
      console.error("Failed to remove imported folder", err);
    } finally {
      endBusy();
    }
  }

  private async revealInFileManager(path: string) {
    this.contextMenu = null;
    try {
      await invoke("reveal_in_file_manager", { path });
    } catch (err) {
      console.error("reveal_in_file_manager failed", err);
    }
  }

  private revealLabel(): string {
    const ua =
      typeof navigator !== "undefined" ? navigator.userAgent ?? "" : "";
    if (/Mac|iPhone|iPad/i.test(ua)) return "Show in Finder";
    if (/Win/i.test(ua)) return "Show in Explorer";
    return "Show in File Manager";
  }

  private onFullViewNavigate(e: CustomEvent<{ index: number }>) {
    const idx = e.detail.index;
    if (idx < 0 || idx >= this.photos.length) return;
    this.fullViewIndex = idx;
    this.selectedPhoto = this.photos[idx];
  }

  private onFullViewClose = () => {
    this.fullViewIndex = null;
  };

  private onSlideshowStart = async () => {
    if (!this.windowFullscreen) await this.setWindowFullscreen(true);
    if (!this.windowFullscreen) return;
    (this.renderRoot.querySelector("pf-full-view") as import("./full-view").PfFullView | null)?.startPresentation();
  };

  private onEditPanelOpenChanged = (e: CustomEvent<{ open: boolean }>) => {
    this.editPanelOpen = e.detail.open;
  };

  private onFullViewControlsVisibilityChanged = (e: CustomEvent<{ hidden: boolean }>) => {
    this.classList.toggle("fs-controls-hidden", e.detail.hidden);
  };

  private toggleSidebar = () => {
    if (window.matchMedia("(max-width: 700px)").matches) {
      this.detailOpen = false;
      this.mobileSidebarOpen = !this.mobileSidebarOpen;
      return;
    }
    this.sidebarCollapsed = !this.sidebarCollapsed;
  };

  private openSettings = () => {
    void (this.renderRoot.querySelector("pf-settings") as import("./pf-settings").PfSettings | null)?.open();
  };

  private toggleIncludeSubfolders = async () => {
    this.includeSubfolders = !this.includeSubfolders;
    if (this.selectedFolderId) {
      this.stopPhotoBackgroundWork();
      this.requestFolderImageIndex(this.selectedFolderId, this.includeSubfolders);
      try {
        this.setPhotos(await invoke<Photo[]>("get_photos_in_folder", {
          folderPath: this.selectedFolderId,
          recursive: this.includeSubfolders,
        }));
        // Reset selection for the new photo set.
        this.selectedPhoto = null;
        this.fullViewIndex = null;
      } catch (err) {
        console.error("Failed to toggle subfolder inclusion", err);
      }
    }
  };

 updated(changed: Map<string, unknown>): void {
    if (changed.has("imports")) {
      void this.refreshFolderPhotoCounts();
      this.indexRootsForCounts();
      void this.refreshAllPhotos();
    }
    if (changed.has("detailOpen")) {
      this.classList.toggle("detail-open", this.detailOpen);
    }
    if (changed.has("mobileSidebarOpen")) {
      this.classList.toggle("mobile-sidebar-open", this.mobileSidebarOpen);
    }
    if (changed.has("sidebarCollapsed")) {
      this.classList.toggle("sidebar-collapsed", this.sidebarCollapsed);
    }
    if (changed.has("windowFullscreen") || changed.has("fullViewIndex")) {
      this.classList.toggle("full-view-open", this.fullViewIndex !== null);
      this.classList.toggle(
        "fs-fullview",
        this.windowFullscreen && this.fullViewIndex !== null
      );
      if (!this.windowFullscreen || this.fullViewIndex === null) {
        this.classList.remove("fs-controls-hidden");
      }
    }
    if (changed.has("fullViewIndex")) {
      const previous = changed.get("fullViewIndex");
      const wasOpen = previous !== undefined && previous !== null;
      const isOpen = this.fullViewIndex !== null;
      if (!wasOpen && isOpen) {
        this.stopPhotoBackgroundWork();
      } else if (wasOpen && !isOpen && (this.selectedFolderId || this.daysSelected)) {
        this.startPhotoBackgroundWork();
      }
    }
    if (
      this.appViewHydrated &&
      (changed.has("selectedPhoto") ||
        changed.has("fullViewIndex") ||
        changed.has("sidebarCollapsed") ||
        changed.has("editPanelOpen") ||
        changed.has("includeSubfolders"))
    ) {
     void this.persistAppView();
   }
 }

  private async persistAppView() {
    try {
      await invoke("set_app_view", {
        view: {
          path: this.selectedPhoto?.path ?? null,
          view: this.fullViewIndex !== null ? "full" : "grid",
          sidebarCollapsed: this.sidebarCollapsed,
          editPanelOpen: this.editPanelOpen,
          includeSubfolders: this.includeSubfolders,
        },
      });
    } catch (err) {
      console.warn("Failed to persist app view", err);
    }
  }

  /** iOS finishes restoring folder permissions after the shell is visible. */
  private async onFoldersRehydrated(): Promise<void> {
    await Promise.all([
      reloadPhotoEdits(),
      reloadPhotoEffects(),
      reloadPhotoRatings(),
      reloadVariantOverrides(),
    ]);
    try {
      this.imports = await invoke<Folder[]>("list_imported_folders");
    } catch (err) {
      console.error("Failed to load restored folders", err);
      return;
    }
    if (this.selectedFolderId === null && !this.allPhotosSelected && !this.favoritesSelected && !this.daysSelected) {
      const first = this.imports.find((folder) => folder.available);
      if (first) await this.selectFolder(first.id, first.path);
    }
  }

  private renderSidebar() {
    void this.ratingsTick;
    const roots = this.imports.filter((root) => root.available);
    const allCount = roots.every((root) => this.folderPhotoCounts[root.id] !== undefined)
      ? roots.reduce((total, root) => total + this.folderPhotoCounts[root.id], 0)
      : null;
    const favoriteCount = allCount === null
      ? null
      : this.libraryPhotos.filter((photo) => getPhotoRating(photo.path).rating >= 1).length;
    return html`
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-brand">
            <span class="sidebar-brand-name">
              <img src=${APP_ICON_URL} alt="" />
              <span>Warble</span>
            </span>
            <span class="header-actions">
              <pf-icon-button
                icon="refresh"
                label="Refresh folders"
                @click=${() => this.refreshFolders()}
              ></pf-icon-button>
              <pf-theme-toggle></pf-theme-toggle>
            </span>
          </div>
          <nav class="sidebar-navigation" aria-label="Library views">
            <button type="button" class=${this.allPhotosSelected ? "active" : ""} aria-current=${this.allPhotosSelected ? "page" : "false"} @click=${this.selectAllPhotos}>
              <pf-icon name="image"></pf-icon>
              <span>All Photos</span>
              <span class="nav-count">${allCount?.toLocaleString() ?? "…"}</span>
            </button>
            <button type="button" class=${this.favoritesSelected ? "active" : ""} aria-current=${this.favoritesSelected ? "page" : "false"} @click=${this.selectFavorites}>
              <pf-icon name="star"></pf-icon>
              <span>Favorites</span>
              <span class="nav-count">${favoriteCount?.toLocaleString() ?? "…"}</span>
            </button>
            <button type="button" class=${!this.allPhotosSelected && !this.favoritesSelected && !this.daysSelected ? "active" : ""}
              aria-current=${!this.allPhotosSelected && !this.favoritesSelected && !this.daysSelected ? "page" : "false"} @click=${this.selectFolders}>
              <pf-icon name="folder"></pf-icon>
              <span>Folders</span>
            </button>
            <button type="button" class=${this.daysSelected ? "active" : ""} aria-current=${this.daysSelected ? "page" : "false"} @click=${this.selectDays}>
              <pf-icon name="calendar"></pf-icon>
              <span>Days</span>
            </button>
          </nav>
        </div>
        ${this.daysSelected ? html`<div class="tree" aria-label="Photos by capture date">
          ${this.restoringCachedDates ? html`<div class="empty">Loading saved photo dates…</div>` : null}
          ${this.restoringCachedDates ? null : html`
          ${this.filterMetadataLoading ? html`<div class="empty">Reading photo dates…</div>` : null}
          ${this.dateNodes.map((node) => this.renderDateNode(node))}
          ${!this.filterMetadataLoading && !this.libraryPhotos.length ? html`<div class="empty">No photos indexed yet.</div>` : null}`}
        </div>` : !this.allPhotosSelected && !this.favoritesSelected ? html`<div
          class="tree"
          @click=${this.onFolderTreeClick}
          @folder-select=${this.onFolderSelect}
          @root-reconnect=${this.reconnectRoot}
          @folder-context-menu=${this.onFolderContextMenu}
        >
          ${this.folders.length === 0
            ? html`<div class="empty">No folders imported yet.</div>`
            : this.folders.map(
                (f) => html`
                  <pf-folder-tree-item
                    .folder=${f}
                    .photoCounts=${this.folderPhotoCounts}
                    is-root
                    selected-id=${this.selectedFolderId ?? ""}
                  ></pf-folder-tree-item>
                `
              )}
        </div>` : html`<div class="sidebar-spacer"></div>`}
        ${!this.allPhotosSelected && !this.favoritesSelected && !this.daysSelected ? html`<div class="folder-actions">
          <button
            type="button"
            class="add-folders-button"
            @click=${() => this.importFolder()}
          >
            <pf-icon name="folder-plus"></pf-icon>
            Add folders
          </button>
        </div>` : null}
        <div class="sidebar-footer">
          <div class="sidebar-settings">
            <pf-button @click=${this.openSettings}>
              <pf-icon name="settings"></pf-icon>
              Settings
            </pf-button>
          </div>
        </div>
      </aside>
    `;
  }

  render() {
    return html`
      <div class="mobile-backdrop" @click=${() => (this.mobileSidebarOpen = false)}></div>
      <div class="detail-backdrop" @click=${() => (this.detailOpen = false)}></div>
      <div class="sidebar-rail">
        <pf-icon-button
          icon=${this.sidebarCollapsed ? "panel-left-open" : "panel-left-close"}
          label=${this.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          @click=${this.toggleSidebar}
        ></pf-icon-button>
      </div>

      ${this.renderSidebar()}

      <main
        class="content"
        @photo-selected=${this.onPhotoSelected}
        @photo-open=${this.onPhotoOpen}
        @photo-context-menu=${this.onPhotoContextMenu}
        @toggle-include-subfolders=${this.toggleIncludeSubfolders}
      >
        <nav class="content-topbar" aria-label="Current folder">
          <button class="mobile-menu-button" type="button" aria-label="Open folders" @click=${this.toggleSidebar}>
            <pf-icon name="panel-left-open"></pf-icon>
          </button>
          <pf-icon name="folder"></pf-icon>
          <span>Library</span>
          ${this.selectedFolderName || this.allPhotosSelected || this.favoritesSelected || this.daysSelected ? html`<span class="breadcrumb-separator">›</span><span class="breadcrumb-current">${this.favoritesSelected ? "Favorites" : this.allPhotosSelected ? "All Photos" : this.daysSelected ? "Days" : this.selectedFolderName}</span>` : null}
          <span class="topbar-spacer"></span>
          ${this.selectedPhoto ? html`<button class="detail-toggle" type="button" aria-label="Photo details" aria-expanded=${this.detailOpen} @click=${() => { this.mobileSidebarOpen = false; this.detailOpen = !this.detailOpen; }}><pf-icon name="info"></pf-icon> Info</button>` : null}
        </nav>
        ${this.selectedFolderId === null && !this.allPhotosSelected && !this.favoritesSelected && !this.daysSelected
          ? html`<div class="welcome">
              <div class="welcome-inner">
                <img src=${APP_ICON_URL} alt="Warble" />
                <h1>Warble</h1>
                <p>Add a folder to get started.</p>
              </div>
            </div>`
          : this.photos.length === 0
          ? html`<div class="empty-content-header">
              <h1>${this.favoritesSelected ? "Favorites" : this.allPhotosSelected ? "All Photos" : this.daysSelected ? dateSelectionLabel(this.selectedDateKey) : this.selectedFolderName ?? ""}</h1>
              ${this.allPhotosSelected || this.favoritesSelected || this.daysSelected ? null : html`<label class="include-subfolders-toggle" title="Show photos from all nested subfolders of the selected folder">
                <input type="checkbox" .checked=${this.includeSubfolders} @change=${this.toggleIncludeSubfolders} />
                Include subfolders
              </label>`}
            </div>
              <p>${this.favoritesSelected ? "No photos with at least one star yet." : this.allPhotosSelected ? "No photos indexed yet." : this.daysSelected ? "No photos for this date." : "No photos in this folder."}</p>`
          : html`<pf-photo-grid
              .photos=${this.photos}
              .selectedPath=${this.selectedPhoto?.path ?? null}
              .folderName=${this.favoritesSelected ? "Favorites" : this.allPhotosSelected ? "All Photos" : this.daysSelected ? dateSelectionLabel(this.selectedDateKey) : this.selectedFolderName ?? ""}
              .showSubfolderToggle=${!this.allPhotosSelected && !this.favoritesSelected && !this.daysSelected}
              .includeSubfolders=${this.includeSubfolders}
              .filterMetadataLoading=${this.filterMetadataLoading}
              ?full-view-open=${this.fullViewIndex !== null}
            ></pf-photo-grid>`}
      </main>

      <aside
        class="detail"
        @photo-open=${this.onPhotoOpen}
        @toggle-window-fullscreen=${this.onToggleFullscreenRequest}
      >
        <pf-detail-panel
          .photo=${this.selectedPhoto}
          ?fullViewOpen=${this.fullViewIndex !== null}
          ?windowFullscreen=${this.windowFullscreen}
        ></pf-detail-panel>
      </aside>

      ${this.fullViewIndex !== null
          ? html`<pf-full-view
            .photos=${this.photos}
            .index=${this.fullViewIndex}
            ?fullscreen=${this.windowFullscreen}
            .editPanelOpenWindowed=${this.editPanelOpen}
            @full-view-navigate=${this.onFullViewNavigate}
            @full-view-close=${this.onFullViewClose}
            @slideshow-start=${this.onSlideshowStart}
            @photo-catalog-changed=${this.onPhotoCatalogChanged}
            @edit-panel-open-changed=${this.onEditPanelOpenChanged}
            @full-view-controls-visibility=${this.onFullViewControlsVisibilityChanged}
            @toggle-window-fullscreen=${this.onToggleFullscreenRequest}
          ></pf-full-view>`
        : null}

      ${this.renderFooter()}
      ${this.renderContextMenu()}
      ${this.renderFolderContextMenu()}
      <pf-settings @workspace-reset-starting=${() => this.stopPhotoBackgroundWork()}></pf-settings>
      ${this.busyLabel
        ? html`
            <div class="app-busy-overlay" aria-hidden="false">
              <div class="app-busy-status" role="status" aria-live="polite">
                <span class="app-busy-spinner" aria-hidden="true"></span>
                <span>${this.busyLabel}</span>
              </div>
            </div>
          `
        : null}
    `;
  }

  private renderContextMenu() {
    const cm = this.contextMenu;
    if (!cm) return null;
    return html`
      <div
        class="ctx-menu-backdrop"
        @click=${this.dismissContextMenu}
        @contextmenu=${(e: MouseEvent) => {
          e.preventDefault();
          this.dismissContextMenu();
        }}
      ></div>
      <div
        class="ctx-menu"
        role="menu"
        style="left: ${cm.x}px; top: ${cm.y}px;"
      >
        <button
          role="menuitem"
          @click=${() => this.revealInFileManager(cm.path)}
        >
          ${this.revealLabel()}
        </button>
      </div>
    `;
  }

  private renderFolderContextMenu() {
    const cm = this.folderContextMenu;
    if (!cm) return null;
    return html`
      <div
        class="ctx-menu-backdrop"
        @click=${this.dismissFolderContextMenu}
        @contextmenu=${(event: MouseEvent) => {
          event.preventDefault();
          this.dismissFolderContextMenu();
        }}
      ></div>
      <div
        class="ctx-menu"
        role="menu"
        aria-label=${`Actions for ${cm.name}`}
        style="left: ${Math.max(0, Math.min(cm.x, window.innerWidth - 230))}px; top: ${Math.max(0, Math.min(cm.y, window.innerHeight - (cm.isRoot ? 118 : 62)))}px;"
      >
        ${cm.available
          ? html`<button
              role="menuitem"
              @click=${() => this.syncFolder(cm.path, cm.name)}
            >
              Sync Folder
            </button>`
          : html`<button
              role="menuitem"
              @click=${() => {
                this.folderContextMenu = null;
                void this.reconnectRoot(
                  new CustomEvent("root-reconnect", {
                    detail: { rootId: cm.folderId },
                  }),
                );
              }}
            >
              Reconnect Folder
            </button>`}
        ${cm.isRoot
          ? html`<button
              class="danger"
              role="menuitem"
              @click=${() => this.removeImportedFolder(cm.folderId)}
            >
              Remove from Library
            </button>`
          : null}
      </div>
    `;
  }

  private renderFooter() {
    const primary = this.activeTasks[0];
    const sameKindCount = primary
      ? this.activeTasks.filter((task) => task.kind === primary.kind).length
      : 0;
    const status = primary
      ? `${primary.label}${sameKindCount > 1 ? ` (${sameKindCount})` : ""}…`
      : "Ready";
    return html`
      <footer class="app-footer" role="status" aria-live="polite">
        ${primary ? html`<span class="footer-task-spinner" aria-hidden="true"></span>` : null}
        <span class="footer-label">${status}</span>
        <span class="footer-task-details-wrap">
          <button
            type="button"
            class="footer-details"
            aria-expanded=${this.taskDetailsOpen}
            @pointerdown=${(event: Event) => event.stopPropagation()}
            @click=${() => (this.taskDetailsOpen = !this.taskDetailsOpen)}
          >Details</button>
          <pf-task-details
            .open=${this.taskDetailsOpen}
            .tasks=${this.recentTasks}
            @task-details-close=${() => (this.taskDetailsOpen = false)}
          ></pf-task-details>
        </span>
        <span class="footer-spacer"></span>
      </footer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "warble-app": WarbleApp;
  }
}

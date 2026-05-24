/**
 * Canvas-based image viewer with thumbnail-first loading, GPU-accelerated
 * draw, wheel zoom, drag-pan, and double-click 100%↔fit toggle.
 *
 * Loading strategy:
 *   1. Kick off both the cached thumbnail and the full image in parallel.
 *   2. The thumbnail typically resolves first (it's already on disk + base64
 *      decoded) — paint it immediately so the user sees something.
 *   3. When the full image's encoded bytes arrive, hand them to the
 *      browser's native `createImageBitmap` (multi-threaded, SIMD JPEG
 *      decode) and swap it in.
 *
 * Fit modes:
 *   - `contain`: largest scale that fits inside the panel, no margin.
 *   - `proof`:   `contain` minus a generous margin (96 CSS px) so the
 *                viewer can step back from the image.
 *   - `tight`:   `contain` minus a small margin (24 CSS px) for close
 *                proofing without filling every last pixel.
 */
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { requestThumbnail, isCancellation } from "../../app/thumbnail-service";
import {
  getHdImage,
  loadHdImage,
} from "../../app/hd-image-cache";
import {
  getFullImage,
  loadFullImage,
} from "../../app/full-image-cache";
import {
  isColorZero,
  isCurveZero,
  isToneZero,
  defaultTone,
  type ColorEdit,
  type CropEdit,
  type CurveEdit,
  type ToneEdit,
} from "@domain/edits";
import {
  getPhotoEdit,
  subscribePhotoEdits,
} from "@services/edits/edits-store";
import {
  getPostProcess,
  subscribePostProcess,
  type PostProcessSettings,
} from "@services/post-process/post-process-store";
import {
  getPhotoBloom,
  subscribePhotoEffects,
  type BloomSettings,
} from "@services/effects/effects-store";
// Side-effect import: wires the worker-backed decoder into both
// image caches and exports `decodeBase64Jpeg` for thumbnail decoding.
import { decodeBase64Jpeg } from "./canvas/decoder-bootstrap";
import { TonePipeline, type ToneSource } from "./canvas/tone-pipeline";
import { clamp, enforceAspect } from "./canvas/crop-geometry";
import type { CropFrame, ImageFit, ImageSizing } from "./canvas/types";

export type { CropFrame, ImageFit, ImageSizing } from "./canvas/types";

/** Time the user must linger on a photo before we kick off a full-
 * resolution decode in addition to the HD preview.  */
const FULL_IMAGE_DELAY_MS = 1000;

// Time to wait until editing changes are applied to full res image after slider change
const EDIT_SETTLE_MS = 1000;

@customElement("pf-image-canvas")
export class PfImageCanvas extends LitElement {
  /**
   * Layout strategy:
   *   - Proof/tight margins are CSS `padding` on `:host`. The canvas
   *     itself shrinks to the inner box, so the standard `ResizeObserver`
   *     reflow is all we need to refit. Padding shows the bg color
   *     (`--pf-canvas-bg`).
   *
   * `fit` is reflected as an attribute so CSS can branch on it
   * (`:host([fit="proof"])` etc.).
   */
  static styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background: var(--pf-canvas-bg, transparent);
      touch-action: none;
      box-sizing: border-box;
    }
    :host([fit="tight"]) {
      padding: 12px;
    }
    :host([fit="proof"]) {
      padding: 48px;
    }
    canvas {
      width: 100%;
      height: 100%;
      display: block;
      cursor: grab;
    }
    canvas.dragging {
      cursor: grabbing;
    }
    :host([cropMode]) canvas {
      cursor: default;
    }
    :host([cropMode][cursor="move"]) canvas {
      cursor: move;
    }
    :host([cropMode][cursor="ns"]) canvas {
      cursor: ns-resize;
    }
    :host([cropMode][cursor="ew"]) canvas {
      cursor: ew-resize;
    }
    :host([cropMode][cursor="nwse"]) canvas {
      cursor: nwse-resize;
    }
    :host([cropMode][cursor="nesw"]) canvas {
      cursor: nesw-resize;
    }
    :host([cropMode][cursor="horizon"]) canvas {
      cursor: crosshair;
    }
    .status {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--pf-text-muted, rgba(255, 255, 255, 0.7));
      font-size: var(--pf-text-sm);
      pointer-events: none;
    }
    .status.error {
      color: #ff8080;
    }
    .loading-spinner {
      position: absolute;
      left: 12px;
      bottom: 12px;
      width: 18px;
      height: 18px;
      border: 2px solid rgba(255, 255, 255, 0.18);
      border-top-color: rgba(255, 255, 255, 0.85);
      border-radius: 50%;
      animation: pf-canvas-spin 0.9s linear infinite;
      pointer-events: none;
    }
    @keyframes pf-canvas-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  @property({ type: String })
  path: string | null = null;

  @property({ type: String, reflect: true })
  fit: ImageFit = "contain";

  @property({ type: String, reflect: true })
  sizing: ImageSizing = "fit";

  @property({ type: String })
  background = "transparent";

  @property({ type: Boolean, reflect: true })
  cropMode = false;

  @property({ type: Boolean, reflect: true })
  editing = false;

  /**
   * When `true`, the canvas opportunistically upgrades from the HD bitmap to the full-resolution.
   */
  @property({ type: Boolean })
  enableFullRes = true;

  /**
   * Locked aspect ratio (width / height) of the crop frame. `null`
   * means free-form (currently unused — UI always supplies a ratio).
   */
  @property({ type: Number })
  cropAspect: number | null = null;

  /**
   * Rotation applied to the source bitmap before crop normalised
   * coords are interpreted, in degrees. Combines a 90° snap with a
   * fine straighten in (-45..+45). The rotated bitmap lives in an
   * offscreen cache so the tone pipeline and 2D draw both naturally
   * see the rotated pixels.
   */
  @property({ type: Number })
  rotation = 0;

  @property({ type: Boolean, reflect: true })
  horizonMode = false;

  /** Reflected so CSS can pick the right cursor for the current
   * crop interaction (move / resize / horizon). */
  @property({ type: String, reflect: true })
  cursor: "" | "move" | "ns" | "ew" | "nwse" | "nesw" | "horizon" = "";

  /**
   * When `true`, persisted crop and tonal adjustments are bypassed at
   * draw time so the user can momentarily see the unedited original.
   * Pan/zoom still work; only the edits are suppressed.
   */
  @property({ type: Boolean, reflect: true })
  previewOriginal = false;

  @state()
  private status: "idle" | "loading" | "ready" | "error" = "idle";

  @state()
  private errorMsg = "";

  /**
   * `true` while the deferred full-resolution decode is pending or
   * running for the active photo. Drives the bottom-left spinner so
   * the user knows a higher-quality bitmap is on its way without
   * obscuring the HD preview that's already on screen.
   */
  @state()
  private fullLoading = false;

  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  /**
   * Reference to the cached full bitmap currently being painted. The
   * cache (`full-image-cache`) owns the bitmap's lifecycle — we never
   * call `close()` on it; eviction is the cache's responsibility.
   */
  private bitmap: ImageBitmap | null = null;
  private bitmapForPath: string | null = null;
  private thumbBitmap: ImageBitmap | null = null;
  private thumbForPath: string | null = null;
  /**
   * Optional full-resolution decode of the current photo. Lives in
   * the shared `full-image-cache` LRU; we just hold a reference. Only
   * populated when {@link enableFullRes} is on and the user has
   * lingered on the photo for {@link FULL_IMAGE_DELAY_MS}.
   */
  private fullBitmap: ImageBitmap | null = null;
  private fullBitmapForPath: string | null = null;
  /** Pending timer that kicks off the deferred full-res load. */
  private fullLoadTimer: number | null = null;
  /** Abort handle for the deferred full-res load itself. */
  private fullLoadAbort: AbortController | null = null;
  /**
   * `true` while the user is actively editing this photo (recent
   * tone/crop store push). The canvas pins itself to the HD bitmap
   * while this flag is set so the tone pipeline keeps working on a
   * cheap texture; once the user pauses (no edit pushes for
   * {@link EDIT_SETTLE_MS}) the flag clears and the full-res bitmap,
   * if available, takes over again.
   */
  @state()
  private editingActive = false;
  private editSettleTimer: number | null = null;

  private scale = 1;
  private offsetX = 0; // device px, relative to canvas centre
  private offsetY = 0;
  private fitScale = 1;
  private userInteracted = false;
  /** Force the next `recomputeFit` (typically when a new bitmap arrives
   * after navigation) to snap scale/offsets back to fit, ignoring any
   * stray interaction state from the previous photo. */
  private forceFitOnNextRecompute = false;

  private resizeObserver?: ResizeObserver;
  private loadAbort: AbortController | null = null;
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOffX = 0;
  private dragOffY = 0;

  // --- Crop mode state ---------------------------------------------------
  /** Crop frame in normalised image coordinates (0..1) — the live frame
   * the user is dragging while in crop mode. */
  @state()
  private cropFrame: CropFrame | null = null;
  /** Active drag operation on the crop frame. `null` when idle. */
  private cropDrag:
    | null
    | {
        kind: "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
        startX: number;
        startY: number;
        startFrame: CropFrame;
      } = null;
  /** Saved (persisted) crop for the current photo, mirrored from the
   * edit store. Applied at draw time when NOT in crop mode. */
  @state()
  private savedCrop: CropEdit | null = null;
  /** Saved (persisted) tonal adjustments for the current photo. Applied
   * at draw time as a `ctx.filter` chain on the bitmap. */
  @state()
  private savedTone: ToneEdit | null = null;
  /** Saved (persisted) tone curve for the current photo. Applied
   * after the basic tone math by the WebGL pipeline. */
  @state()
  private savedCurve: CurveEdit | null = null;
  /** Saved (persisted) per-photo color (HSL) adjustments. */
  @state()
  private savedColor: ColorEdit | null = null;
  /** Snapshot of the global post-process settings (color + curve).
   * Updated via {@link subscribePostProcess}; redraws on change. */
  @state()
  private postProcess: PostProcessSettings = getPostProcess();
  /** Saved (persisted) per-photo bloom effect. */
  @state()
  private savedBloom: BloomSettings | null = null;
  private editsUnsubscribe: (() => void) | null = null;
  private postProcessUnsubscribe: (() => void) | null = null;
  private effectsUnsubscribe: (() => void) | null = null;
  /** GPU pipeline for tone (brightness/contrast/saturation) adjustments.
   * Lazy-initialised on first use so photos with no edits never pay for
   * WebGL context creation. */
  private tonePipeline = new TonePipeline();

  /** rAF guard: coalesces multiple `scheduleDraw()` calls within a
   * single frame into one paint. Critical for slider drags, which
   * fire ~60 events/s — without this, draws pile up faster than they
   * can complete and the UI appears to stall. */
  private drawScheduled = false;

  firstUpdated() {
    this.canvas = this.renderRoot.querySelector("canvas") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d") ?? undefined;
    // Observe the canvas (not the host) so padding changes on `:host`
    // — which keep the host's border box constant — still trigger a
    // backing-store resize.
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.canvas);
    this.attachInputs();
    this.onResize();
    if (this.path) {
      this.refreshSavedCrop();
      this.startLoad();
    }
    // React to edit-store changes: edits are applied at draw time on
    // the cached bitmap, so a save just refits + redraws — no reload,
    // no cache invalidation, no backend round trip.
    this.editsUnsubscribe = subscribePhotoEdits((path) => {
      if (path && path !== this.path) return;
      if (!this.path) return;
      const prevCrop = this.savedCrop;
      this.refreshSavedCrop();
      // Only reset pan/zoom when the crop rectangle changed — tone-only
      // edits should keep the user's current viewport so they can watch
      // an adjustment land on the area they care about.
      const cropChanged =
        !!prevCrop !== !!this.savedCrop ||
        (prevCrop != null &&
          this.savedCrop != null &&
          (prevCrop.x !== this.savedCrop.x ||
            prevCrop.y !== this.savedCrop.y ||
            prevCrop.width !== this.savedCrop.width ||
            prevCrop.height !== this.savedCrop.height ||
            prevCrop.rotation !== this.savedCrop.rotation));
      if (cropChanged) {
        this.userInteracted = false;
        this.forceFitOnNextRecompute = true;
        // Saved rotation feeds `normalizedRotation()` when crop mode
        // is off, so a rotation change must drop the rotated cache to
        // force a re-bake at the new angle.
        if (
          (prevCrop?.rotation ?? 0) !== (this.savedCrop?.rotation ?? 0)
        ) {
          this.rotatedCache = null;
          this.tonePipeline.invalidate();
        }
        this.recomputeFit();
        // If the saved crop just got cleared (e.g. user hit revert)
        // while the crop tool is open, drop the live frame so the
        // visible crop no longer reflects the now-deleted edit.
        if (this.cropMode && prevCrop && !this.savedCrop) {
          this.cropFrame = this.computeInitialCropFrame();
        }
      }
      // Path-targeted edit pushes (i.e. NOT the bulk-load broadcast
      // that fires with `path === ""`) mean the user just touched a
      // slider or nudged the crop. Pin the canvas to the HD bitmap
      // until the dust settles so the WebGL tone pipeline doesn't
      // burn frames re-uploading a 40 MP texture per drag tick.
      if (path && path === this.path) {
        this.markEditingActive();
      }
      this.scheduleDraw();
    });
    // Post-process settings are global (not per-photo), so every
    // change forces a redraw on every visible canvas — but they're
    // CPU-cheap (the LUT/colour uniforms just flow through the existing
    // WebGL program).
    this.postProcessUnsubscribe = subscribePostProcess((next) => {
      this.postProcess = next;
      this.scheduleDraw();
    });
    // Per-photo effects (bloom, …) live in their own localStorage
    // store. Slider drags push at the same rate as edit slider drags,
    // and the WebGL pipeline can absorb them without a re-upload.
    this.effectsUnsubscribe = subscribePhotoEffects((path) => {
      if (path && path !== this.path) return;
      this.refreshSavedEffects();
      this.scheduleDraw();
    });
  }

  /** Pull the latest persisted crop + tone for the current photo into
   * `savedCrop` / `savedTone`. Cheap (synchronous map lookup). */
  private refreshSavedCrop() {
    if (!this.path) {
      this.savedCrop = null;
      this.savedTone = null;
      this.savedCurve = null;
      this.savedColor = null;
      return;
    }
    const edit = getPhotoEdit(this.path);
    this.savedCrop = edit?.crop ?? null;
    this.savedTone = edit?.tone ?? null;
    this.savedCurve = edit?.curve ?? null;
    this.savedColor = edit?.color ?? null;
    this.refreshSavedEffects();
  }

  private refreshSavedEffects() {
    if (!this.path) {
      this.savedBloom = null;
      return;
    }
    this.savedBloom = getPhotoBloom(this.path);
  }

  /**
   * Pin the canvas to the HD bitmap for {@link EDIT_SETTLE_MS} so a
   * burst of edit-store pushes (slider drag, crop nudge) doesn't keep
   * forcing a 40 MP texture re-upload through the tone pipeline. When
   * the timer expires we drop back to the full-resolution bitmap (if
   * available) and invalidate the tone texture so the next paint
   * re-uploads the now-larger source.
   *
   * No-op when full-res mode is off — there's only one bitmap source
   * to choose from.
   */
  private markEditingActive() {
    if (!this.enableFullRes) return;
    const wasActive = this.editingActive;
    if (!wasActive) {
      // Capture the source dims BEFORE flipping the flag so we can
      // adjust user-zoom for the full→HD downsize.
      const prevSrc = this.effectiveSource();
      const prevW = prevSrc?.width ?? 0;
      this.editingActive = true;
      this.rotatedCache = null;
      this.tonePipeline.invalidate();
      if (this.userInteracted && prevW > 0) {
        const newSrc = this.effectiveSource();
        const newW = newSrc?.width ?? 0;
        if (newW > 0 && newW !== prevW) {
          this.scale = (this.scale * prevW) / newW;
        }
      }
      this.recomputeFit();
    }
    if (this.editSettleTimer !== null) {
      window.clearTimeout(this.editSettleTimer);
    }
    this.editSettleTimer = window.setTimeout(() => {
      this.editSettleTimer = null;
      if (!this.editingActive) return;
      const prevSrc = this.effectiveSource();
      const prevW = prevSrc?.width ?? 0;
      this.editingActive = false;
      this.rotatedCache = null;
      this.tonePipeline.invalidate();
      if (this.userInteracted && prevW > 0) {
        const newSrc = this.effectiveSource();
        const newW = newSrc?.width ?? 0;
        if (newW > 0 && newW !== prevW) {
          this.scale = (this.scale * prevW) / newW;
        }
      }
      this.recomputeFit();
      this.scheduleDraw();
    }, EDIT_SETTLE_MS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.loadAbort?.abort();
    this.cancelFullImageLoad();
    if (this.editSettleTimer !== null) {
      window.clearTimeout(this.editSettleTimer);
      this.editSettleTimer = null;
    }
    // Full bitmap is owned by `full-image-cache`; do NOT close it here.
    this.thumbBitmap?.close?.();
    this.bitmap = null;
    this.thumbBitmap = null;
    this.fullBitmap = null;
    this.editsUnsubscribe?.();
    this.editsUnsubscribe = null;
    this.postProcessUnsubscribe?.();
    this.postProcessUnsubscribe = null;
    this.effectsUnsubscribe?.();
    this.effectsUnsubscribe = null;
    this.tonePipeline.dispose();
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("path")) {
      this.userInteracted = false;
      this.forceFitOnNextRecompute = true;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      // Switching photos drops any pending crop state.
      this.cropFrame = null;
      this.refreshSavedCrop();
      if (this.canvas) this.startLoad();
    } else if (changed.has("fit") || changed.has("sizing")) {
      this.userInteracted = false;
      this.forceFitOnNextRecompute = true;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      // Padding on `:host` is driven by the reflected `fit`/`sizing`
      // attributes, so the canvas resizes on the next frame; a single
      // onResize() pass after layout settles refits and redraws.
      requestAnimationFrame(() => this.onResize());
    }
    if (changed.has("cropMode")) {
      this.userInteracted = false;
      this.forceFitOnNextRecompute = true;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      if (this.cropMode) {
        // Seed the live frame from the saved crop if any, otherwise
        // build a fresh one from the requested aspect.
        this.cropFrame =
          (this.savedCrop
            ? {
                x: this.savedCrop.x,
                y: this.savedCrop.y,
                width: this.savedCrop.width,
                height: this.savedCrop.height,
              }
            : null) ?? this.computeInitialCropFrame();
        this.canvas?.addEventListener("pointermove", this.onCropHover);
      } else {
        this.cropFrame = null;
        this.cropDrag = null;
        this.cursor = "";
        this.canvas?.removeEventListener("pointermove", this.onCropHover);
      }
      // Effective rotation source changes when toggling cropMode (live
      // `this.rotation` vs persisted `savedCrop.rotation`); drop the
      // rotated cache and tone texture so the next render rebakes.
      this.rotatedCache = null;
      this.tonePipeline.invalidate();
      requestAnimationFrame(() => this.onResize());
    }
    if (changed.has("horizonMode")) {
      this.cursor = this.horizonMode ? "horizon" : "";
    }
    if (changed.has("rotation")) {
      // Reset pan/zoom so the rotated image lands centred and fitting.
      this.userInteracted = false;
      this.forceFitOnNextRecompute = true;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      // Rebuild rotation cache lazily; tone pipeline texture is
      // identity-keyed so the next render() will re-upload.
      this.tonePipeline.invalidate();
      // Re-derive a centred frame around the current aspect so we
      // don't end up with a frame partially outside the rotated
      // bitmap's bounds.
      if (this.cropMode) {
        const fallback = this.computeInitialCropFrame();
        if (this.cropFrame && fallback) {
          // Keep the user's existing frame if it still fits the
          // rotated content; otherwise clamp toward the centred
          // inscribed default. Prevents a fresh nudge of the slider
          // from snapping the frame back to the centre.
          this.cropFrame = this.clampFrameToRotated(
            this.cropFrame,
            fallback,
          );
        } else {
          this.cropFrame = fallback;
        }
        // The frame may have changed shape — let the host persist it
        // so the saved crop tracks the rotation change.
        this.dispatchCropChange();
      }
      requestAnimationFrame(() => this.onResize());
    }
    if (
      changed.has("cropAspect") &&
      this.cropMode &&
      !changed.has("cropMode")
    ) {
      // When cropMode itself just toggled on, the block above already
      // seeded the frame from the saved crop; don't clobber it here
      // just because `cropAspect` flipped from null to a value in the
      // same update cycle.
      this.cropFrame = this.computeInitialCropFrame();
      this.draw();
      // The frame just changed shape — let the host persist it so the
      // saved crop tracks the aspect change. Without this, switching
      // aspect ratios in the side panel would write the new aspect key
      // alongside the OLD frame coords and the on-screen crop would
      // never actually update on disk.
      this.dispatchCropChange();
    }
    if (changed.has("background")) {
      this.style.setProperty("--pf-canvas-bg", this.background);
      this.draw();
    }
    if (changed.has("previewOriginal")) {
      // Toggling the preview changes the cropped source rect, so refit
      // before redrawing or the image jumps off-centre.
      this.userInteracted = false;
      this.forceFitOnNextRecompute = true;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      requestAnimationFrame(() => this.onResize());
    }
    if (changed.has("editing") && this.editing) {
      // Pre-warm the GL pipeline so the first slider drag doesn't pay
      // for context creation + a 40 MP texture upload on the same
      // frame. If the bitmap isn't here yet, `setBitmap` will run
      // warmup once it arrives.
      this.warmupTonePipeline();
    }
  }

  /** Warm up the tone pipeline with the current bitmap if `editing`
   * is on. Scheduled via `requestIdleCallback` (falling back to a
   * micro-timeout) so the warm-up never delays a paint. */
  private warmupTonePipeline() {
    if (!this.editing) return;
    const bm = this.bitmap;
    if (!bm) return;
    const run = () => {
      if (!this.editing || this.bitmap !== bm) return;
      this.tonePipeline.warmup(bm);
    };
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
    }).requestIdleCallback;
    if (ric) ric(run);
    else window.setTimeout(run, 0);
  }

  private async startLoad() {
    this.loadAbort?.abort();
    // Any pending full-res load is for the previous path; cancel both
    // the linger timer and the in-flight backend job.
    this.cancelFullImageLoad();

    const ac = new AbortController();
    this.loadAbort = ac;

    const path = this.path;
    if (!path) {
      this.status = "idle";
      // Cached bitmaps are owned by full-image-cache; don't close them.
      this.bitmap = null;
      this.bitmapForPath = null;
      this.thumbBitmap?.close?.();
      this.thumbBitmap = null;
      this.thumbForPath = null;
      this.fullBitmap = null;
      this.fullBitmapForPath = null;
      this.draw();
      return;
    }

    this.status = "loading";
    this.errorMsg = "";

    // Drop any stale full bitmap so we don't paint the previous photo.
    // The cache still owns it; we just stop referencing it here.
    if (this.bitmapForPath !== path) {
      this.bitmap = null;
      this.bitmapForPath = null;
    }
    if (this.thumbForPath !== path) {
      this.thumbBitmap?.close?.();
      this.thumbBitmap = null;
      this.thumbForPath = null;
    }
    if (this.fullBitmapForPath !== path) {
      // Full-res bitmaps are owned by full-image-cache; never close.
      this.fullBitmap = null;
      this.fullBitmapForPath = null;
    }

    // Fast path: HD image already in the cross-instance LRU cache.
    // Skip the thumbnail roundtrip and the deferred-decode entirely so
    // navigating between recently-viewed photos is instant.
    const cached = getHdImage(path);
    if (cached) {
      this.bitmap = cached;
      this.bitmapForPath = path;
      this.status = "ready";
      this.recomputeFit();
      this.draw();
      this.warmupTonePipeline();
      this.scheduleFullImageLoad(path, ac);
      return;
    }

    this.draw();

    // Phase 1: thumbnail (cached → near-instant). Always kick this off
    // immediately so even rapid arrow-key navigation shows something.
    // Tagged `urgent` because this is the photo the user is looking at
    // right now — it must jump ahead of any folder-wide batch.
    const thumbHandle = requestThumbnail(path, "urgent");
    void thumbHandle.promise
      .then((b64) => decodeBase64Jpeg(b64))
      .then((bm) => {
        if (ac.signal.aborted || this.path !== path) {
          bm.close?.();
          return;
        }
        // If the full bitmap already arrived, keep that.
        if (this.bitmapForPath === path) {
          bm.close?.();
          return;
        }
        this.thumbBitmap?.close?.();
        this.thumbBitmap = bm;
        this.thumbForPath = path;
        this.recomputeFit();
        this.draw();
      })
      .catch((err) => {
        if (!isCancellation(err)) console.warn("thumbnail preview failed", err);
      });

    // Phase 2: HD encoded bytes → createImageBitmap. Issued immediately
    // so navigation feels snappy. The HD pipeline produces a 1920px-
    // long-side JPEG (cached on disk after the first hit), so the
    // decode is cheap enough that we don't need to defer it the way we
    // would for full-resolution decodes. Rapid arrow-key navigation is
    // still safe: the priority pool drops queued jobs whose request id
    // is cancelled by `loadAbort`.
    void this.loadFullImage(path, ac);

    // Phase 3 (optional): after the user has lingered on this photo
    // for FULL_IMAGE_DELAY_MS, kick off a true full-resolution decode
    // and swap it in once available. Cancelled implicitly when the
    // user navigates away (via `loadAbort`) so arrow-key scrubbing
    // never queues full decodes nobody will see.
    this.scheduleFullImageLoad(path, ac);
  }

  /** Cancel any pending full-res load timer and in-flight decode. */
  private cancelFullImageLoad() {
    if (this.fullLoadTimer !== null) {
      window.clearTimeout(this.fullLoadTimer);
      this.fullLoadTimer = null;
    }
    this.fullLoadAbort?.abort();
    this.fullLoadAbort = null;
    this.fullLoading = false;
  }

  /**
   * Wait FULL_IMAGE_DELAY_MS, then start fetching the full-resolution
   * bitmap (or use the cache if already populated). The delay matters
   * because rapid arrow-key navigation should never trigger a 40 MP
   * decode the user won't actually look at — pinning the cache full
   * of huge bitmaps would also evict the HD entries we *do* want hot.
   *
   * Even a cache hit waits the full {@link FULL_IMAGE_DELAY_MS} so
   * the on-screen experience is consistent: the HD preview is what
   * the user sees first, every time, and the full-res swap is always
   * a deliberate post-linger upgrade. Without this, revisits would
   * pop straight to full-res while first-views go through the HD
   * stage, which made the viewer feel inconsistent on slower
   * machines where the swap is visible.
   */
  private scheduleFullImageLoad(path: string, parent: AbortController) {
    if (!this.enableFullRes) return;
    if (parent.signal.aborted) return;

    this.fullLoading = true;
    this.fullLoadTimer = window.setTimeout(() => {
      this.fullLoadTimer = null;
      if (parent.signal.aborted || this.path !== path) {
        this.fullLoading = false;
        return;
      }

      // Cache hits still go through the linger gate (above) so the
      // user always sees the HD preview first, but the actual swap
      // is synchronous from here on.
      const cached = getFullImage(path);
      if (cached) {
        this.applyFullBitmap(path, cached);
        this.fullLoading = false;
        return;
      }

      const fullAc = new AbortController();
      this.fullLoadAbort = fullAc;
      const onParentAbort = () => fullAc.abort();
      parent.signal.addEventListener("abort", onParentAbort, { once: true });

      void loadFullImage(path, {
        priority: "urgent",
        signal: fullAc.signal,
      })
        .then((bm) => {
          if (fullAc.signal.aborted || this.path !== path) return;
          this.applyFullBitmap(path, bm);
        })
        .catch((err) => {
          if (fullAc.signal.aborted) return;
          console.warn("full-resolution image load failed", err);
        })
        .finally(() => {
          parent.signal.removeEventListener("abort", onParentAbort);
          if (this.fullLoadAbort === fullAc) this.fullLoadAbort = null;
          if (this.path === path) this.fullLoading = false;
        });
    }, FULL_IMAGE_DELAY_MS);
  }

  /**
   * Swap in a full-resolution bitmap for the active photo. Preserves
   * the on-screen display size of any user-driven zoom by adjusting
   * `scale` for the change in source dimensions, so a 200% HD view
   * doesn't jump to a much smaller display when the larger bitmap
   * arrives.
   */
  private applyFullBitmap(path: string, bm: ImageBitmap) {
    if (this.path !== path) return;
    const prevSrc = this.effectiveSource();
    const prevW = prevSrc?.width ?? 0;
    this.fullBitmap = bm;
    this.fullBitmapForPath = path;
    // The rotated cache and tone texture are keyed on the underlying
    // source bitmap; swapping in a new one must drop both.
    this.rotatedCache = null;
    this.tonePipeline.invalidate();
    if (this.userInteracted && prevW > 0) {
      const newSrc = this.effectiveSource();
      const newW = newSrc?.width ?? 0;
      if (newW > 0 && newW !== prevW) {
        this.scale = (this.scale * prevW) / newW;
      }
    }
    this.recomputeFit();
    this.scheduleDraw();
  }

  private async loadFullImage(path: string, ac: AbortController) {
    try {
      // Goes through the shared LRU cache: dedupes concurrent requests,
      // returns instantly if another canvas already decoded this photo,
      // and stores the result for future hits / neighbour preloads.
      // Passing the abort signal lets the cache cancel the backend
      // byte fetch when the user navigates away before the decode
      // starts running on the priority pool.
      const bm = await loadHdImage(path, {
        priority: "urgent",
        signal: ac.signal,
      });
      if (ac.signal.aborted || this.path !== path) return;
      // Cache owns the bitmap; just take a reference.
      this.bitmap = bm;
      this.bitmapForPath = path;
      // Drop the thumb once the full is in.
      this.thumbBitmap?.close?.();
      this.thumbBitmap = null;
      this.thumbForPath = null;
      this.status = "ready";
      this.recomputeFit();
      this.draw();
      this.warmupTonePipeline();
    } catch (err) {
      if (ac.signal.aborted || this.path !== path) return;
      console.error("full image load failed", err);
      this.status = "error";
      this.errorMsg = String(err);
    }
  }

  private get currentBitmap(): ImageBitmap | null {
    // Prefer the full-resolution bitmap when:
    //   * the host opted in (the windowed viewer doesn't),
    //   * we actually have a decoded full-res bitmap for the *current*
    //     photo, and
    //   * the user isn't actively editing this photo right now (during
    //     edits we stay on the HD bitmap so the WebGL tone pipeline
    //     doesn't keep reuploading a 40 MP texture every slider tick).
    if (
      this.enableFullRes &&
      !this.editingActive &&
      this.fullBitmap &&
      this.fullBitmapForPath === this.path
    ) {
      return this.fullBitmap;
    }
    return this.bitmap ?? this.thumbBitmap;
  }

  /** Offscreen canvas holding `currentBitmap` rotated by `rotation`,
   * cached so the tone pipeline + 2D draw both see the rotated pixels
   * without re-rotating per frame. Keyed by `(bitmap, rotation)`. */
  private rotatedCache: {
    source: ImageBitmap;
    rotation: number;
    canvas: HTMLCanvasElement | OffscreenCanvas;
    width: number;
    height: number;
  } | null = null;

  /** The pixel source the rest of the pipeline operates on. When
   * `rotation` is 0 this is the original bitmap; otherwise we lazily
   * render a rotated offscreen canvas and hand that back. */
  private effectiveSource(): {
    source: ToneSource;
    width: number;
    height: number;
  } | null {
    const bm = this.currentBitmap;
    if (!bm) return null;
    const rot = this.normalizedRotation();
    if (rot === 0) {
      return { source: bm, width: bm.width, height: bm.height };
    }
    if (
      this.rotatedCache &&
      this.rotatedCache.source === bm &&
      this.rotatedCache.rotation === rot
    ) {
      return {
        source: this.rotatedCache.canvas,
        width: this.rotatedCache.width,
        height: this.rotatedCache.height,
      };
    }
    const cache = this.buildRotatedCache(bm, rot);
    if (!cache) return { source: bm, width: bm.width, height: bm.height };
    this.rotatedCache = { source: bm, rotation: rot, ...cache };
    return {
      source: cache.canvas,
      width: cache.width,
      height: cache.height,
    };
  }

  /** Normalise rotation into (-180, 180]. The effective rotation
   * tracks the live `rotation` property while the crop tool is open
   * and the persisted `savedCrop.rotation` otherwise — that way the
   * canvas keeps showing the straightened/rotated image after the
   * crop card is dismissed. */
  private normalizedRotation(): number {
    let r: number;
    if (this.cropMode) {
      r = this.rotation || 0;
    } else {
      r = this.savedCrop?.rotation ?? 0;
    }
    if (!Number.isFinite(r)) return 0;
    r = ((r % 360) + 360) % 360;
    if (r > 180) r -= 360;
    return r;
  }

  /** Render the bitmap rotated into an offscreen canvas large enough
   * to hold the rotated bounding box. Returns null on failure. */
  private buildRotatedCache(
    bm: ImageBitmap,
    rotDeg: number,
  ): {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    width: number;
    height: number;
  } | null {
    const rad = (rotDeg * Math.PI) / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    const w = Math.max(1, Math.round(bm.width * c + bm.height * s));
    const h = Math.max(1, Math.round(bm.width * s + bm.height * c));
    let cv: HTMLCanvasElement | OffscreenCanvas;
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (typeof OffscreenCanvas !== "undefined") {
      cv = new OffscreenCanvas(w, h);
      ctx = cv.getContext("2d");
    } else {
      cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      ctx = cv.getContext("2d");
    }
    if (!ctx) return null;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rad);
    ctx.drawImage(bm, -bm.width / 2, -bm.height / 2);
    ctx.restore();
    return { canvas: cv, width: w, height: h };
  }

  /**
   * The crop rectangle currently being applied at draw time, expressed
   * in normalised (0..1) image coordinates. In crop mode the canvas
   * shows the full bitmap (so the user can re-frame against the
   * original); otherwise the persisted crop is honoured.
   */
  private effectiveCrop(): CropEdit | null {
    if (this.cropMode) return null;
    if (this.previewOriginal) return null;
    return this.savedCrop;
  }

  /**
   * Source-image-pixel rectangle of the bitmap currently being drawn.
   * `dispW`/`dispH` are the dimensions used for fit math; `sx`/`sy`/
   * `sw`/`sh` go straight into `ctx.drawImage`. Operates on the
   * rotated source so the persisted crop is interpreted in the
   * post-rotation coordinate space.
   */
  private effectiveRect(
    bm: { width: number; height: number },
  ): { sx: number; sy: number; sw: number; sh: number; dispW: number; dispH: number } {
    const c = this.effectiveCrop();
    if (!c) {
      return { sx: 0, sy: 0, sw: bm.width, sh: bm.height, dispW: bm.width, dispH: bm.height };
    }
    const sx = clamp(c.x, 0, 1) * bm.width;
    const sy = clamp(c.y, 0, 1) * bm.height;
    const sw = Math.max(1, clamp(c.width, 0, 1) * bm.width);
    const sh = Math.max(1, clamp(c.height, 0, 1) * bm.height);
    return { sx, sy, sw, sh, dispW: sw, dispH: sh };
  }

  private onResize() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Measure the canvas itself — not the host — because CSS padding
    // on `:host` (driven by the `fit` attribute) shrinks the canvas
    // while the host's border box stays put.
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.recomputeFit();
    this.draw();
  }

  private recomputeFit() {
    const src = this.effectiveSource();
    if (!src || !this.canvas) {
      this.fitScale = 1;
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, this.canvas.width);
    const ch = Math.max(1, this.canvas.height);
    const { dispW, dispH } = this.effectiveRect(src);
    const aspect = dispW / dispH;
    let useFill = this.sizing === "fill";
    if (this.sizing === "hybrid" && aspect >= 1) {
      const canvasAspect = cw / ch;
      const stretch =
        canvasAspect >= aspect ? canvasAspect / aspect : aspect / canvasAspect;
      // 16:10 ÷ 3:2 = 16/15 ≈ 1.0667 (the configured threshold).
      const HYBRID_MAX_STRETCH = 4 / 3;
      useFill = stretch <= HYBRID_MAX_STRETCH;
    }
    this.fitScale = useFill
      ? Math.max(cw / dispW, ch / dispH)
      : Math.min(cw / dispW, ch / dispH, dpr);
    if (this.forceFitOnNextRecompute) {
      this.scale = this.fitScale;
      this.offsetX = 0;
      this.offsetY = 0;
      this.userInteracted = false;
      this.forceFitOnNextRecompute = false;
    } else if (!this.userInteracted) {
      this.scale = this.fitScale;
    }
  }

  /** Floor scale for wheel-zoom-out: never smaller than the current fit
   * mode would produce. In `contain` mode this prevents zooming out past
   * the full image view; in `proof`/`tight` it preserves the configured
   * margin around the image. */
  private minScale(): number {
    return this.fitScale;
  }

  /** Coalesce multiple repaint requests into one rAF-scheduled draw.
   * Use this everywhere except `onResize` (which paints synchronously
   * to avoid a one-frame flash on layout changes). */
  private scheduleDraw() {
    if (this.drawScheduled) return;
    this.drawScheduled = true;
    requestAnimationFrame(() => this.draw());
  }

  private draw() {
    this.drawScheduled = false;
    const ctx = this.ctx;
    const cv = this.canvas;
    if (!ctx || !cv) return;
    ctx.save();
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (this.background && this.background !== "transparent") {
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
    const bm = this.currentBitmap;
    if (bm) {
      const src = this.effectiveSource()!;
      const { sx, sy, sw, sh, dispW, dispH } = this.effectiveRect(src);
      const drawW = dispW * this.scale;
      const drawH = dispH * this.scale;
      const cx = cv.width / 2 + this.offsetX;
      const cy = cv.height / 2 + this.offsetY;
      const x = cx - drawW / 2;
      const y = cy - drawH / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Tone is applied in crop mode too so the user sees what their
      // adjustments do while re-framing. `previewOriginal` (the
      // before/after toggle) still bypasses tone + crop on purpose.
      // The WebGL path also handles per-photo curve + color and
      // global post-process (color + curve), so we route through it
      // whenever ANY of those is non-identity.
      const pp = this.postProcess;
      // Master post-process switch. When disabled the user still sees
      // their per-photo tone + colour + curve edits (those are the
      // photo's "real" state), but the global look layer (post color,
      // post curve) is skipped entirely. Toggling lets you compare the
      // look against the underlying edit instantly.
      const ppEnabled = pp.enabled;
      const postCurveActive = ppEnabled && !isCurveZero(pp.curve);
      const postColorActive = ppEnabled && !isColorZero(pp.color);
      const editColorActive =
        !!this.savedColor && !isColorZero(this.savedColor);
      const bloomActive =
        !!this.savedBloom && this.savedBloom.strength > 0;
      const applyPipeline =
        !this.previewOriginal &&
        (!isToneZero(this.savedTone) ||
          !isCurveZero(this.savedCurve) ||
          editColorActive ||
          postCurveActive ||
          postColorActive ||
          bloomActive);
      if (applyPipeline) {
        const visX0 = Math.max(0, x);
        const visY0 = Math.max(0, y);
        const visX1 = Math.min(cv.width, x + drawW);
        const visY1 = Math.min(cv.height, y + drawH);
        const visW = Math.max(0, visX1 - visX0);
        const visH = Math.max(0, visY1 - visY0);
        if (visW > 0 && visH > 0) {
          const u0 = (visX0 - x) / drawW;
          const v0 = (visY0 - y) / drawH;
          const u1 = (visX1 - x) / drawW;
          const v1 = (visY1 - y) / drawH;
          const subSx = sx + u0 * sw;
          const subSy = sy + v0 * sh;
          const subSw = (u1 - u0) * sw;
          const subSh = (v1 - v0) * sh;
          const outW = Math.max(
            1,
            Math.min(Math.ceil(visW), Math.ceil(subSw))
          );
          const outH = Math.max(
            1,
            Math.min(Math.ceil(visH), Math.ceil(subSh))
          );
          const toned = this.tonePipeline.render(
            src.source,
            this.savedTone ?? defaultTone(),
            { sx: subSx, sy: subSy, sw: subSw, sh: subSh },
            outW,
            outH,
            {
              curve: this.savedCurve,
              postCurve: postCurveActive ? pp.curve : null,
              editColor: editColorActive ? this.savedColor : null,
              postColor: postColorActive ? pp.color : null,
              bloom: bloomActive ? this.savedBloom : null,
            }
          );
          if (toned) {
            ctx.drawImage(toned, 0, 0, outW, outH, visX0, visY0, visW, visH);
          } else {
            ctx.drawImage(src.source, sx, sy, sw, sh, x, y, drawW, drawH);
          }
        }
      } else {
        ctx.drawImage(src.source, sx, sy, sw, sh, x, y, drawW, drawH);
      }
      if (this.cropMode && this.cropFrame) {
        this.drawCropOverlay(ctx, x, y, drawW, drawH);
      }
      if (this.horizonDrag) {
        this.drawHorizonLine(ctx, x, y, drawW, drawH);
      }
      void bm;
    }
    ctx.restore();
  }

  /**
   * Render the crop overlay: a darkened mask over the rejected area
   * plus a bright frame, rule-of-thirds guides, and slim handles.
   * Handles are drawn as line segments along the inside of each
   * edge (centred 1/3 of the edge length) plus L-bracket corners
   * — a softer, more modern look than blocky squares.
   */
  private drawCropOverlay(
    ctx: CanvasRenderingContext2D,
    imgX: number,
    imgY: number,
    imgW: number,
    imgH: number,
  ) {
    const f = this.cropFrame!;
    const fx = imgX + f.x * imgW;
    const fy = imgY + f.y * imgH;
    const fw = f.width * imgW;
    const fh = f.height * imgH;
    // Darken everything outside the crop frame (use even-odd fill so
    // the inner rectangle is punched out).
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    ctx.rect(imgX, imgY, imgW, imgH);
    ctx.rect(fx, fy, fw, fh);
    ctx.fill("evenodd");
    ctx.restore();
    const dpr = window.devicePixelRatio || 1;
    // Frame border.
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(fx, fy, fw, fh);
    // Rule-of-thirds guides.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    for (let i = 1; i <= 2; i++) {
      const gx = fx + (fw * i) / 3;
      ctx.moveTo(gx, fy);
      ctx.lineTo(gx, fy + fh);
      const gy = fy + (fh * i) / 3;
      ctx.moveTo(fx, gy);
      ctx.lineTo(fx + fw, gy);
    }
    ctx.stroke();
    // Edge bars (centred on each side, ~1/3 of the edge length).
    const barLen = (axis: "h" | "v") =>
      Math.max(20 * dpr, ((axis === "h" ? fw : fh) * 1) / 3);
    const barW = 3 * dpr;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = barW;
    ctx.lineCap = "round";
    ctx.beginPath();
    {
      const lh = barLen("h");
      // North
      ctx.moveTo(fx + fw / 2 - lh / 2, fy);
      ctx.lineTo(fx + fw / 2 + lh / 2, fy);
      // South
      ctx.moveTo(fx + fw / 2 - lh / 2, fy + fh);
      ctx.lineTo(fx + fw / 2 + lh / 2, fy + fh);
    }
    {
      const lv = barLen("v");
      // West
      ctx.moveTo(fx, fy + fh / 2 - lv / 2);
      ctx.lineTo(fx, fy + fh / 2 + lv / 2);
      // East
      ctx.moveTo(fx + fw, fy + fh / 2 - lv / 2);
      ctx.lineTo(fx + fw, fy + fh / 2 + lv / 2);
    }
    ctx.stroke();
    // L-shaped corner brackets.
    const cornerLen = Math.min(20 * dpr, fw / 4, fh / 4);
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    // NW
    ctx.moveTo(fx, fy + cornerLen);
    ctx.lineTo(fx, fy);
    ctx.lineTo(fx + cornerLen, fy);
    // NE
    ctx.moveTo(fx + fw - cornerLen, fy);
    ctx.lineTo(fx + fw, fy);
    ctx.lineTo(fx + fw, fy + cornerLen);
    // SE
    ctx.moveTo(fx + fw, fy + fh - cornerLen);
    ctx.lineTo(fx + fw, fy + fh);
    ctx.lineTo(fx + fw - cornerLen, fy + fh);
    // SW
    ctx.moveTo(fx + cornerLen, fy + fh);
    ctx.lineTo(fx, fy + fh);
    ctx.lineTo(fx, fy + fh - cornerLen);
    ctx.stroke();
    ctx.restore();
  }

  /** Draw the in-progress horizon line during a horizon-pick drag. */
  private drawHorizonLine(
    ctx: CanvasRenderingContext2D,
    imgX: number,
    imgY: number,
    imgW: number,
    imgH: number,
  ) {
    const d = this.horizonDrag;
    if (!d) return;
    const dpr = window.devicePixelRatio || 1;
    const ax = imgX + d.ax * imgW;
    const ay = imgY + d.ay * imgH;
    const bx = imgX + d.bx * imgW;
    const by = imgY + d.by * imgH;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 230, 90, 0.95)";
    ctx.lineWidth = 2 * dpr;
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    // Endpoint dots.
    ctx.fillStyle = "rgba(255, 230, 90, 0.95)";
    for (const [px, py] of [
      [ax, ay],
      [bx, by],
    ] as const) {
      ctx.beginPath();
      ctx.arc(px, py, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private attachInputs() {
    const cv = this.canvas!;
    cv.addEventListener("wheel", this.onWheel, { passive: false });
    cv.addEventListener("pointerdown", this.onPointerDown);
    cv.addEventListener("dblclick", this.onDblClick);
  }

  private onWheel = (e: WheelEvent) => {
    if (this.cropMode) {
      e.preventDefault();
      return;
    }
    if (!this.currentBitmap || !this.canvas) return;
    e.preventDefault();
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * dpr;
    const py = (e.clientY - rect.top) * dpr;
    const factor = Math.exp(-e.deltaY * 0.0015);
    // Floor zoom-out at the current fit. Zooming out past it would just
    // shrink the image inside its (proof) margin or canvas — nothing
    // useful changes.
    const minScale = this.minScale();
    const maxScale = Math.max(20 * dpr, this.fitScale * 20);
    const newScale = Math.min(maxScale, Math.max(minScale, this.scale * factor));
    this.zoomAround(px, py, newScale);
    this.userInteracted = true;
    this.scheduleDraw();
  };

  private zoomAround(px: number, py: number, newScale: number) {
    if (!this.canvas) return;
    const cx = this.canvas.width / 2 + this.offsetX;
    const cy = this.canvas.height / 2 + this.offsetY;
    const k = newScale / this.scale;
    // Keep image-space point under (px, py) anchored as scale changes.
    const newCx = cx + (px - cx) * (1 - k);
    const newCy = cy + (py - cy) * (1 - k);
    this.offsetX = newCx - this.canvas.width / 2;
    this.offsetY = newCy - this.canvas.height / 2;
    this.scale = newScale;
    this.clampOffsets();
  }

  /**
   * Constrain pan so the displayed image always covers the canvas
   * viewport. The proof/tight margin is CSS padding on the host, so
   * the canvas's own dimensions are already the inner viewport — no
   * extra subtraction needed. When the image is smaller than the
   * viewport on an axis (zoomed out), the offset on that axis is
   * locked to 0 to keep it centred.
   */
  private clampOffsets() {
    const src = this.effectiveSource();
    if (!src || !this.canvas) return;
    const { dispW, dispH } = this.effectiveRect(src);
    const viewW = Math.max(1, this.canvas.width);
    const viewH = Math.max(1, this.canvas.height);
    const drawW = dispW * this.scale;
    const drawH = dispH * this.scale;
    if (drawW <= viewW) {
      this.offsetX = 0;
    } else {
      const limit = (drawW - viewW) / 2;
      if (this.offsetX > limit) this.offsetX = limit;
      else if (this.offsetX < -limit) this.offsetX = -limit;
    }
    if (drawH <= viewH) {
      this.offsetY = 0;
    } else {
      const limit = (drawH - viewH) / 2;
      if (this.offsetY > limit) this.offsetY = limit;
      else if (this.offsetY < -limit) this.offsetY = -limit;
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !this.currentBitmap) return;
    if (this.cropMode) {
      this.startCropDrag(e);
      return;
    }
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragOffX = this.offsetX;
    this.dragOffY = this.offsetY;
    this.canvas!.setPointerCapture(e.pointerId);
    this.canvas!.classList.add("dragging");
    this.canvas!.addEventListener("pointermove", this.onPointerMove);
    this.canvas!.addEventListener("pointerup", this.onPointerUp);
    this.canvas!.addEventListener("pointercancel", this.onPointerUp);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dpr = window.devicePixelRatio || 1;
    this.offsetX = this.dragOffX + (e.clientX - this.dragStartX) * dpr;
    this.offsetY = this.dragOffY + (e.clientY - this.dragStartY) * dpr;
    this.clampOffsets();
    this.userInteracted = true;
    this.scheduleDraw();
  };

  private onPointerUp = (e: PointerEvent) => {
    this.dragging = false;
    this.canvas?.classList.remove("dragging");
    try {
      this.canvas?.releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
    this.canvas?.removeEventListener("pointermove", this.onPointerMove);
    this.canvas?.removeEventListener("pointerup", this.onPointerUp);
    this.canvas?.removeEventListener("pointercancel", this.onPointerUp);
  };

  private onDblClick = (e: MouseEvent) => {
    if (this.cropMode) {
      e.preventDefault();
      return;
    }
    if (!this.currentBitmap || !this.canvas) return;
    e.preventDefault();
    const dpr = window.devicePixelRatio || 1;
    const oneToOne = dpr; // 1 image px == 1 css px
    const isFitting = Math.abs(this.scale - this.fitScale) < 1e-3;
    if (isFitting) {
      const rect = this.canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * dpr;
      const py = (e.clientY - rect.top) * dpr;
      this.zoomAround(px, py, oneToOne);
      this.userInteracted = true;
    } else {
      this.scale = this.fitScale;
      this.offsetX = 0;
      this.offsetY = 0;
      this.userInteracted = false;
    }
    this.draw();
  };

  /** Public: reset zoom/pan to fit. */
  resetView() {
    this.userInteracted = false;
    this.recomputeFit();
    this.scale = this.fitScale;
    this.offsetX = 0;
    this.offsetY = 0;
    this.draw();
  }

  // --- Crop mode ---------------------------------------------------------

  /**
   * Public: read the current crop frame (in normalised image
   * coordinates). Returns `null` if no frame is positioned (e.g. the
   * raw bitmap hasn't loaded yet).
   */
  getCropFrame(): CropFrame | null {
    return this.cropFrame ? { ...this.cropFrame } : null;
  }

  /**
   * Public: install a starting crop frame, e.g. when re-opening the
   * editor on a photo that already has a saved crop.
   */
  setCropFrame(frame: CropFrame | null) {
    this.cropFrame = frame ? { ...frame } : null;
    this.draw();
  }

  /**
   * Build the initial crop frame: centred, locked to `cropAspect`, and
   * as large as possible inside the original image.
   */
  private computeInitialCropFrame(): CropFrame | null {
    const src = this.effectiveSource();
    if (!src) return null;
    const aspect = this.cropAspect;
    const bm = this.currentBitmap;
    const θ = (this.normalizedRotation() * Math.PI) / 180;
    const rotated = Math.abs(θ) > 1e-6 && bm != null;
    // Maximum centred axis-aligned rectangle (in canvas pixels) that
    // fits inside the rotated original. With no rotation this is just
    // the canvas itself; with rotation, we solve the two corner-fit
    // inequalities for the largest (W,H) of the requested aspect.
    let maxWpx: number;
    let maxHpx: number;
    if (!rotated) {
      if (aspect && Number.isFinite(aspect) && aspect > 0) {
        // Largest centred rectangle of the requested aspect that
        // fits inside the source. Without this, the new frame would
        // just be the whole image and visually keep the source's
        // native aspect until the user drags a handle.
        const srcAspect = src.width / src.height;
        if (aspect >= srcAspect) {
          // Width-bound: span the full width, derive height.
          maxWpx = src.width;
          maxHpx = src.width / aspect;
        } else {
          // Height-bound: span the full height, derive width.
          maxHpx = src.height;
          maxWpx = src.height * aspect;
        }
      } else {
        maxWpx = src.width;
        maxHpx = src.height;
      }
    } else {
      const acθ = Math.abs(Math.cos(θ));
      const asθ = Math.abs(Math.sin(θ));
      const W = bm!.width;
      const H = bm!.height;
      if (aspect && Number.isFinite(aspect) && aspect > 0) {
        // Rect of width 2a, height 2b centred at origin must satisfy
        //   a·|cos| + b·|sin| ≤ W/2
        //   a·|sin| + b·|cos| ≤ H/2
        // With a = aspect·b → b = min(W/(2(aspect·acθ + asθ)),
        //                              H/(2(aspect·asθ + acθ))).
        const bMax = Math.min(
          W / (2 * (aspect * acθ + asθ)),
          H / (2 * (aspect * asθ + acθ)),
        );
        maxHpx = 2 * bMax;
        maxWpx = aspect * maxHpx;
      } else {
        // No aspect lock: the largest centred AABB inscribed in the
        // rotated rectangle has half-extents
        //   a* = (W·|cos| − H·|sin|) / (cos²−sin²) when |cos|≠|sin|
        // (and the symmetric formula for b*). We just take min of the
        // two binding constraints assuming square — good enough as a
        // default; the user can drag handles outward up to the
        // clamp-to-rotated boundary.
        const denom = Math.max(1e-6, acθ * acθ - asθ * asθ);
        const a = Math.max(0, (W * acθ - H * asθ) / (2 * denom));
        const b = Math.max(0, (H * acθ - W * asθ) / (2 * denom));
        maxWpx = 2 * Math.min(a, src.width / 2);
        maxHpx = 2 * Math.min(b, src.height / 2);
        // Fallback if math degenerates near 45°.
        if (!(maxWpx > 0) || !(maxHpx > 0)) {
          maxWpx = src.width * 0.7;
          maxHpx = src.height * 0.7;
        }
      }
    }
    const fw = Math.min(1, maxWpx / src.width);
    const fh = Math.min(1, maxHpx / src.height);
    return {
      x: (1 - fw) / 2,
      y: (1 - fh) / 2,
      width: fw,
      height: fh,
    };
  }

  /** Test whether all four corners of `f` (in canvas-normalised
   * coords) lie inside the rotated original rectangle. */
  private isFrameInsideRotated(f: CropFrame): boolean {
    const θ = (this.normalizedRotation() * Math.PI) / 180;
    if (Math.abs(θ) < 1e-6) return true;
    const src = this.effectiveSource();
    const bm = this.currentBitmap;
    if (!src || !bm) return true;
    const cθ = Math.cos(θ);
    const sθ = Math.sin(θ);
    const Wp = src.width;
    const Hp = src.height;
    // Half-extents of the original (with a sub-pixel tolerance to
    // forgive floating-point noise at the boundary).
    const W2 = bm.width / 2 + 0.5;
    const H2 = bm.height / 2 + 0.5;
    const corners: Array<[number, number]> = [
      [f.x, f.y],
      [f.x + f.width, f.y],
      [f.x + f.width, f.y + f.height],
      [f.x, f.y + f.height],
    ];
    for (const [nx, ny] of corners) {
      const x = nx * Wp - Wp / 2;
      const y = ny * Hp - Hp / 2;
      const u = x * cθ + y * sθ;
      const v = -x * sθ + y * cθ;
      if (Math.abs(u) > W2 || Math.abs(v) > H2) return false;
    }
    return true;
  }

  /** Clamp `proposed` so that all of its corners lie inside the
   * rotated original. If the proposed frame is already valid it is
   * returned unchanged; otherwise we binary-search a parameter `t` in
   * [0, 1] that linearly interpolates from `fallback` (presumed
   * valid) to `proposed`, picking the largest `t` that still fits.
   * This works for both translation (move) and uniform scaling
   * (resize) drags because both endpoints share the same aspect. */
  private clampFrameToRotated(
    proposed: CropFrame,
    fallback: CropFrame,
  ): CropFrame {
    if (this.isFrameInsideRotated(proposed)) return proposed;
    if (!this.isFrameInsideRotated(fallback)) return proposed;
    const lerp = (t: number): CropFrame => ({
      x: fallback.x + (proposed.x - fallback.x) * t,
      y: fallback.y + (proposed.y - fallback.y) * t,
      width: fallback.width + (proposed.width - fallback.width) * t,
      height: fallback.height + (proposed.height - fallback.height) * t,
    });
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (this.isFrameInsideRotated(lerp(mid))) lo = mid;
      else hi = mid;
    }
    return lerp(lo);
  }

  /**
   * Map a CSS-pixel pointer coordinate to the normalised image
   * position currently under the cursor, or `null` if the pointer is
   * outside the displayed image.
   */
  private cursorToImageNorm(e: PointerEvent): { ix: number; iy: number } | null {
    const src = this.effectiveSource();
    if (!src || !this.canvas) return null;
    const { dispW, dispH } = this.effectiveRect(src);
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * dpr;
    const py = (e.clientY - rect.top) * dpr;
    const drawW = dispW * this.scale;
    const drawH = dispH * this.scale;
    const cx = this.canvas.width / 2 + this.offsetX;
    const cy = this.canvas.height / 2 + this.offsetY;
    const x0 = cx - drawW / 2;
    const y0 = cy - drawH / 2;
    const ix = (px - x0) / drawW;
    const iy = (py - y0) / drawH;
    return { ix, iy };
  }

  /** Pick the crop interaction (move / resize edge / corner) for a
   * pointer position over the image, or `null` if the pointer is
   * outside the frame. The same hit-test drives both the cursor on
   * hover and the drag kind on pointerdown. */
  private hitCropHandle(
    norm: { ix: number; iy: number },
  ): "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null {
    const f = this.cropFrame;
    const src = this.effectiveSource();
    if (!f || !src) return null;
    const { dispW, dispH } = this.effectiveRect(src);
    const dpr = window.devicePixelRatio || 1;
    const tolPx = 14 * dpr;
    const tolNormX = tolPx / (dispW * this.scale);
    const tolNormY = tolPx / (dispH * this.scale);
    const ix = norm.ix;
    const iy = norm.iy;
    const left = f.x;
    const right = f.x + f.width;
    const top = f.y;
    const bottom = f.y + f.height;
    const nearLeft = Math.abs(ix - left) <= tolNormX;
    const nearRight = Math.abs(ix - right) <= tolNormX;
    const nearTop = Math.abs(iy - top) <= tolNormY;
    const nearBottom = Math.abs(iy - bottom) <= tolNormY;
    // Inside-vertical-band test ensures we don't activate a horizontal
    // edge when the cursor is well above/below the frame.
    const insideY = iy >= top - tolNormY && iy <= bottom + tolNormY;
    const insideX = ix >= left - tolNormX && ix <= right + tolNormX;
    if (nearLeft && nearTop) return "nw";
    if (nearRight && nearTop) return "ne";
    if (nearLeft && nearBottom) return "sw";
    if (nearRight && nearBottom) return "se";
    if (nearLeft && insideY) return "w";
    if (nearRight && insideY) return "e";
    if (nearTop && insideX) return "n";
    if (nearBottom && insideX) return "s";
    if (
      ix >= left &&
      ix <= right &&
      iy >= top &&
      iy <= bottom
    ) {
      return "move";
    }
    return null;
  }

  /** Map a hit-test result to the CSS cursor token reflected as a
   * host attribute (see the `:host([cursor=...])` selectors). */
  private cursorTokenFor(
    kind: "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null,
  ): "" | "move" | "ns" | "ew" | "nwse" | "nesw" {
    switch (kind) {
      case "move":
        return "move";
      case "n":
      case "s":
        return "ns";
      case "e":
      case "w":
        return "ew";
      case "nw":
      case "se":
        return "nwse";
      case "ne":
      case "sw":
        return "nesw";
      default:
        return "";
    }
  }

  /** Hover handler that updates the cursor token when no drag is in
   * progress. Attached on cropMode entry, detached on exit. */
  private onCropHover = (e: PointerEvent) => {
    if (this.cropDrag || this.horizonDrag) return;
    if (this.horizonMode) {
      this.cursor = "horizon";
      return;
    }
    const norm = this.cursorToImageNorm(e);
    if (!norm) {
      this.cursor = "";
      return;
    }
    const kind = this.hitCropHandle(norm);
    this.cursor = this.cursorTokenFor(kind);
  };

  private startCropDrag(e: PointerEvent) {
    if (this.horizonMode) {
      this.startHorizonDrag(e);
      return;
    }
    if (!this.cropFrame) return;
    const norm = this.cursorToImageNorm(e);
    if (!norm) return;
    const kind = this.hitCropHandle(norm);
    if (!kind) return;
    this.cropDrag = {
      kind,
      startX: norm.ix,
      startY: norm.iy,
      startFrame: { ...this.cropFrame },
    };
    this.canvas!.setPointerCapture(e.pointerId);
    this.canvas!.addEventListener("pointermove", this.onCropPointerMove);
    this.canvas!.addEventListener("pointerup", this.onCropPointerUp);
    this.canvas!.addEventListener("pointercancel", this.onCropPointerUp);
  }

  private onCropPointerMove = (e: PointerEvent) => {
    if (!this.cropDrag || !this.cropFrame) return;
    const norm = this.cursorToImageNorm(e);
    if (!norm) return;
    const dx = norm.ix - this.cropDrag.startX;
    const dy = norm.iy - this.cropDrag.startY;
    const start = this.cropDrag.startFrame;
    let aspect = this.cropAspect;
    let nf: CropFrame = { ...start };
    if (this.cropDrag.kind === "move") {
      nf.x = clamp(start.x + dx, 0, 1 - start.width);
      nf.y = clamp(start.y + dy, 0, 1 - start.height);
    } else {
      // Resize. Compute new edges, keep the opposite corner anchored.
      let left = start.x;
      let top = start.y;
      let right = start.x + start.width;
      let bottom = start.y + start.height;
      const k = this.cropDrag.kind;
      if (k.includes("w")) left = clamp(start.x + dx, 0, right - 0.02);
      if (k.includes("e"))
        right = clamp(start.x + start.width + dx, left + 0.02, 1);
      if (k.includes("n")) top = clamp(start.y + dy, 0, bottom - 0.02);
      if (k.includes("s"))
        bottom = clamp(start.y + start.height + dy, top + 0.02, 1);
      nf = { x: left, y: top, width: right - left, height: bottom - top };
      // Auto orientation flip: if a corner drag inverts the dominant
      // axis (e.g. user drags an SE handle past the original NW
      // anchor's diagonal so the "natural" frame is now portrait), we
      // swap aspect to its reciprocal and re-derive. This makes the
      // frame snap from landscape↔portrait at the centre as the user
      // crosses it, matching Lightroom / Photos behaviour.
      if (
        aspect &&
        Number.isFinite(aspect) &&
        aspect > 0 &&
        aspect !== 1 &&
        (k === "ne" || k === "nw" || k === "se" || k === "sw")
      ) {
        const src = this.effectiveSource()!;
        const startW = start.width * src.width;
        const startH = start.height * src.height;
        const newW = nf.width * src.width;
        const newH = nf.height * src.height;
        const startLandscape = startW >= startH;
        const proposedLandscape = newW >= newH;
        if (startLandscape !== proposedLandscape) {
          aspect = 1 / aspect;
          this.dispatchEvent(
            new CustomEvent("orientation-flip", { bubbles: true }),
          );
        }
      }
      // Lock aspect: re-derive whichever dimension is "free" given the
      // dragged edge(s).
      if (aspect && Number.isFinite(aspect) && aspect > 0) {
        const src = this.effectiveSource()!;
        nf = enforceAspect(
          nf,
          start,
          aspect,
          this.cropDrag.kind,
          { width: src.width, height: src.height },
        );
      }
    }
    // Constrain to the inscribed rectangle of the rotated original so
    // the crop never includes blank corners introduced by rotation.
    nf = this.clampFrameToRotated(nf, start);
    this.cropFrame = nf;
    this.draw();
    this.dispatchCropChange();
  };

  private onCropPointerUp = (e: PointerEvent) => {
    this.cropDrag = null;
    try {
      this.canvas?.releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
    this.canvas?.removeEventListener("pointermove", this.onCropPointerMove);
    this.canvas?.removeEventListener("pointerup", this.onCropPointerUp);
    this.canvas?.removeEventListener("pointercancel", this.onCropPointerUp);
    this.dispatchCropChange();
    this.dispatchEvent(
      new CustomEvent("crop-commit", { bubbles: true }),
    );
  };

  /** Emit `crop-change` with the live frame so the host can persist
   * incremental edits without an explicit Apply button. */
  private dispatchCropChange() {
    if (!this.cropFrame) return;
    this.dispatchEvent(
      new CustomEvent<CropFrame>("crop-change", {
        bubbles: true,
        detail: { ...this.cropFrame },
      }),
    );
  }

  // --- Horizon (straighten) interaction --------------------------------
  /** Drag state for a horizon line — two pointer-defined points whose
   * angle becomes the implied straighten correction. */
  private horizonDrag:
    | null
    | {
        ax: number;
        ay: number;
        bx: number;
        by: number;
        pointerId: number;
      } = null;

  private startHorizonDrag(e: PointerEvent) {
    const norm = this.cursorToImageNorm(e);
    if (!norm) return;
    this.horizonDrag = {
      ax: norm.ix,
      ay: norm.iy,
      bx: norm.ix,
      by: norm.iy,
      pointerId: e.pointerId,
    };
    this.canvas!.setPointerCapture(e.pointerId);
    this.canvas!.addEventListener("pointermove", this.onHorizonPointerMove);
    this.canvas!.addEventListener("pointerup", this.onHorizonPointerUp);
    this.canvas!.addEventListener("pointercancel", this.onHorizonPointerUp);
    this.draw();
  }

  private onHorizonPointerMove = (e: PointerEvent) => {
    if (!this.horizonDrag) return;
    const norm = this.cursorToImageNorm(e);
    if (!norm) return;
    this.horizonDrag.bx = norm.ix;
    this.horizonDrag.by = norm.iy;
    this.draw();
  };

  private onHorizonPointerUp = (e: PointerEvent) => {
    const drag = this.horizonDrag;
    this.horizonDrag = null;
    try {
      this.canvas?.releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
    this.canvas?.removeEventListener(
      "pointermove",
      this.onHorizonPointerMove,
    );
    this.canvas?.removeEventListener("pointerup", this.onHorizonPointerUp);
    this.canvas?.removeEventListener(
      "pointercancel",
      this.onHorizonPointerUp,
    );
    if (!drag) return;
    const src = this.effectiveSource();
    if (!src) return;
    // Convert to pixel offsets (so pixel-aspect distortion of the
    // normalised coordinates doesn't tilt the angle).
    const dx = (drag.bx - drag.ax) * src.width;
    const dy = (drag.by - drag.ay) * src.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      this.draw();
      return;
    }
    // Angle of the drawn line vs horizontal. Negate so a line that
    // slopes up-to-the-right (positive angle in screen coords) yields
    // a positive correction that rotates the image counter-clockwise
    // back to level.
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Pick the closest horizontal/vertical reference (the user might
    // draw along a vertical edge like a building corner instead of
    // the horizon).
    let correction = -angleDeg;
    if (correction > 90) correction -= 180;
    if (correction < -90) correction += 180;
    this.dispatchEvent(
      new CustomEvent<number>("horizon-line", {
        bubbles: true,
        detail: correction,
      }),
    );
    this.draw();
  };

  render() {
    // Initial blank-canvas load (no bitmap of any kind painted yet)
    // still gets a centred status — the photo isn't on screen so
    // there's nothing to obscure. Once anything is on the canvas, we
    // switch to the bottom-left spinner for the full-res linger
    // step so the picture itself stays visible.
    const initialLoading = this.status === "loading" && !this.currentBitmap;
    const fullResLoading =
      this.enableFullRes &&
      this.fullLoading &&
      !!this.currentBitmap &&
      this.fullBitmapForPath !== this.path;
    return html`
      <canvas></canvas>
      ${this.status === "error"
        ? html`<div class="status error">Failed to load: ${this.errorMsg}</div>`
        : null}
      ${initialLoading ? html`<div class="status">Loading…</div>` : null}
      ${fullResLoading
        ? html`<div
            class="loading-spinner"
            role="status"
            aria-label="Loading full resolution"
          ></div>`
        : null}
    `;
  }
}


declare global {
  interface HTMLElementTagNameMap {
    "pf-image-canvas": PfImageCanvas;
  }
}

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
  setHdImageDecoder,
} from "../../app/hd-image-cache";
import {
  getPhotoEdit,
  isToneZero,
  subscribePhotoEdits,
  type CropEdit,
  type ToneEdit,
} from "../../app/edit-store";

export type ImageFit = "contain" | "proof" | "tight";
export type ImageSizing = "fit" | "fill" | "hybrid";

/** Pending crop frame state, exposed via `getCrop()`. */
export interface CropFrame {
  /** Normalised (0..1) crop in original-image coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  `;

  @property({ type: String })
  path: string | null = null;

  @property({ type: String, reflect: true })
  fit: ImageFit = "contain";

  @property({ type: String, reflect: true })
  sizing: ImageSizing = "fit";

  @property({ type: String })
  background = "transparent";

  /**
   * When `true`, the canvas enters interactive crop mode: zoom/pan are
   * disabled, the image is forced to fit, and an aspect-locked crop
   * frame is overlaid. The frame can be dragged (move) or resized via
   * its 8 handles. The persisted edit, if any, is ignored while in
   * crop mode so the user can re-frame against the full image.
   */
  @property({ type: Boolean, reflect: true })
  cropMode = false;

  /**
   * When `true`, the tone pipeline is pre-warmed (WebGL2 context
   * created, shader compiled, current bitmap uploaded as a texture)
   * so the first slider movement is responsive. Without this warm-
   * up the first drag pays the full GL init + 40 MP texture upload
   * cost on the same frame and the UI feels stuck for ~200 ms.
   */
  @property({ type: Boolean, reflect: true })
  editing = false;

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

  /**
   * When `true`, the canvas enters "horizon pick" mode: the user
   * draws a line across the image and the host receives a
   * `horizon-line` event with the implied straighten angle. The
   * crop card uses this to drive the rotation slider.
   */
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
  private editsUnsubscribe: (() => void) | null = null;
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
      this.scheduleDraw();
    });
  }

  /** Pull the latest persisted crop + tone for the current photo into
   * `savedCrop` / `savedTone`. Cheap (synchronous map lookup). */
  private refreshSavedCrop() {
    if (!this.path) {
      this.savedCrop = null;
      this.savedTone = null;
      return;
    }
    const edit = getPhotoEdit(this.path);
    this.savedCrop = edit?.crop ?? null;
    this.savedTone = edit?.tone ?? null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.loadAbort?.abort();
    // Full bitmap is owned by `full-image-cache`; do NOT close it here.
    this.thumbBitmap?.close?.();
    this.bitmap = null;
    this.thumbBitmap = null;
    this.editsUnsubscribe?.();
    this.editsUnsubscribe = null;
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
      const applyTone =
        !this.previewOriginal && !isToneZero(this.savedTone);
      if (applyTone) {
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
            this.savedTone!,
            { sx: subSx, sy: subSy, sw: subSw, sh: subSh },
            outW,
            outH,
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
    const showLoading = this.status === "loading" && !this.currentBitmap;
    return html`
      <canvas></canvas>
      ${this.status === "error"
        ? html`<div class="status error">Failed to load: ${this.errorMsg}</div>`
        : null}
      ${showLoading ? html`<div class="status">Loading…</div>` : null}
    `;
  }
}

function decodeBase64Jpeg(b64: string): Promise<ImageBitmap> {  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return createOrientedBitmap(new Blob([arr], { type: "image/jpeg" }));
}

/**
 * `createImageBitmap` with EXIF orientation honoured. Older webviews don't
 * accept the `imageOrientation` option and throw `TypeError` — fall back to
 * the no-options form so we still get *some* bitmap (un-rotated).
 */
async function createOrientedBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(blob);
  }
}

// --- full-image decode worker -----------------------------------------------
//
// A single shared worker handles every full-image decode request. Decoding
// off the main thread is what prevents the UI from locking up while a 24 MP
// JPEG is being parsed.

interface WorkerResponse {
  id: number;
  ok: boolean;
  bitmap?: ImageBitmap;
  error?: string;
}

let decoderWorker: Worker | null = null;
let nextDecodeId = 1;
const pendingDecodes = new Map<
  number,
  { resolve: (b: ImageBitmap) => void; reject: (e: unknown) => void }
>();

function getDecoderWorker(): Worker {
  if (decoderWorker) return decoderWorker;
  decoderWorker = new Worker(
    new URL("../../app/full-image-worker.ts", import.meta.url),
    { type: "module" }
  );
  decoderWorker.addEventListener("message", (e: MessageEvent<WorkerResponse>) => {
    const data = e.data;
    const entry = pendingDecodes.get(data.id);
    if (!entry) return;
    pendingDecodes.delete(data.id);
    if (data.ok && data.bitmap) entry.resolve(data.bitmap);
    else entry.reject(new Error(data.error ?? "image decode failed"));
  });
  decoderWorker.addEventListener("error", (e) => {
    console.error("full-image-worker error", e.message);
  });
  return decoderWorker;
}

function decodeInWorker(buffer: ArrayBuffer): Promise<ImageBitmap> {
  const id = nextDecodeId++;
  return new Promise<ImageBitmap>((resolve, reject) => {
    pendingDecodes.set(id, { resolve, reject });
    // Transfer the buffer so we don't pay a copy on the way in.
    getDecoderWorker().postMessage({ id, buffer }, [buffer]);
  });
}

// Hand the worker-backed decoder to the shared HD-image cache so it
// can fetch+decode entries on cache misses (and prefetches from
// `pf-full-view`). Registering at module load means any code path that
// imports the cache after this module is wired up.
setHdImageDecoder(decodeInWorker);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Enforce an aspect ratio on a freshly-resized crop frame by adjusting
 * the dimension that wasn't directly dragged (or shrinking the one that
 * was, if doing so would push the frame outside the image).
 *
 * `kind` indicates which handle was dragged — corner drags resize both
 * dimensions, edge drags resize one and we recompute the other. The
 * anchor (the corner opposite the dragged handle/edge) stays put.
 */
function enforceAspect(
  proposed: CropFrame,
  start: CropFrame,
  aspect: number,
  kind: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
  bm: { width: number; height: number }
): CropFrame {
  // Anchor point (opposite the moved handle).
  const startRight = start.x + start.width;
  const startBottom = start.y + start.height;
  let anchorX = start.x + start.width / 2;
  let anchorY = start.y + start.height / 2;
  if (kind.includes("w")) anchorX = startRight;
  else if (kind.includes("e")) anchorX = start.x;
  if (kind.includes("n")) anchorY = startBottom;
  else if (kind.includes("s")) anchorY = start.y;

  // Image aspect (in normalised coords) is bm.width:bm.height ratio,
  // but our normalised coords are 0..1 in each dimension, so a
  // crop-frame width `w` and height `h` in normalised coords represents
  // a true-pixel ratio of (w * bm.width) / (h * bm.height) — we want
  // that = `aspect`, i.e. h / w = (bm.width / bm.height) / aspect.
  const ratio = bm.width / bm.height / aspect; // h/w in normalised space

  let w = proposed.width;
  let h = proposed.height;
  if (kind === "n" || kind === "s") {
    // Vertical edge drag: adjust width from new height.
    h = proposed.height;
    w = h / ratio;
  } else if (kind === "e" || kind === "w") {
    h = proposed.width * ratio;
    w = proposed.width;
  } else {
    // Corner: pick the dimension that produces the smaller frame
    // (more conservative — keeps within image bounds).
    const wFromH = proposed.height / ratio;
    const hFromW = proposed.width * ratio;
    if (wFromH * proposed.height <= proposed.width * hFromW) {
      w = wFromH;
      h = proposed.height;
    } else {
      w = proposed.width;
      h = hFromW;
    }
  }

  // Re-anchor the frame so the anchor corner/edge stays put.
  let x: number;
  let y: number;
  if (kind.includes("w")) x = anchorX - w;
  else if (kind.includes("e")) x = anchorX;
  else x = anchorX - w / 2;
  if (kind.includes("n")) y = anchorY - h;
  else if (kind.includes("s")) y = anchorY;
  else y = anchorY - h / 2;

  // If the frame escapes the image, shrink to fit while preserving
  // aspect.
  if (x < 0) {
    const shrink = -x;
    w -= shrink;
    h = w * ratio;
    x = 0;
    if (kind.includes("n")) y = anchorY - h;
    else if (kind.includes("s")) y = anchorY;
    else y = anchorY - h / 2;
  }
  if (y < 0) {
    const shrink = -y;
    h -= shrink;
    w = h / ratio;
    y = 0;
    if (kind.includes("w")) x = anchorX - w;
    else if (kind.includes("e")) x = anchorX;
    else x = anchorX - w / 2;
  }
  if (x + w > 1) {
    w = 1 - x;
    h = w * ratio;
  }
  if (y + h > 1) {
    h = 1 - y;
    w = h / ratio;
  }
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    width: clamp(w, 0.02, 1),
    height: clamp(h, 0.02, 1),
  };
}

/**
 * Resolve a `ToneEdit` to the uniforms that drive the WebGL tone
 * shader. Each slider is in `[-100, 100]`; we normalise to `[-1, 1]`
 * (sometimes scaled) here so the shader can stay simple. Mappings:
 *
 *   - **Exposure** → photographic stops, applied as a `2^(e/100)`
 *     multiplier. ±100 ≈ ±1 stop. Acts on every pixel uniformly.
 *
 *   - **Contrast** → S-curve around 0.5 in the shader, scaled by
 *     `c/200` (half as sensitive as a naïve `c/100`). The slider was
 *     previously much too aggressive — at +50 the image clipped hard.
 *
 *   - **Saturation** → `1 + s/100` interpolation between luminance
 *     and the original colour.
 *
 *   - **Blacks / Shadows / Highlights / Whites** → genuine tonal-
 *     region adjustments, applied per-pixel in the shader as a
 *     luminance-weighted RGB offset. Blacks/whites are *endpoint*
 *     pulls (steep falloff into pure black / pure white, the way
 *     Capture One's Levels-style "Black"/"White" sliders behave),
 *     while shadows/highlights are smooth bumps centred on the
 *     lower / upper midtones. The four regions are designed so a
 *     single slider only nudges its own zone — e.g. dragging Blacks
 *     leaves the highlights untouched.
 *
 *   The per-region shape and sensitivity is fully configurable by
 *   {@link TONE_REGION}: each region declares an `amplitude` (max
 *   luminance offset at slider ±100 and peak weight) plus a
 *   `weightExp` shape that drives the GLSL weight expression.
 *   Endpoint regions use `pow((1-L), n)` / `pow(L, n)`; midtone
 *   regions use a normalised bump `K · L^a · (1-L)^b` that peaks at
 *   `L = a/(a+b)` with peak value 1.
 */

/**
 * Per-region tunables for the Blacks / Shadows / Highlights / Whites
 * sliders. Tweak these to make the sliders more or less aggressive
 * and to widen / narrow the luminance band each one targets.
 *
 * `amplitude` — maximum signed luminance offset at slider ±100 and
 *   peak weight. The smaller this number, the less the slider does.
 *
 * `weightExp` — the shape of the per-region weight curve:
 *   - `{ kind: "endpoint-low",  exp: n }` →  weight = (1-L)^n
 *     (Blacks — bigger `n` = sharper localisation at L≈0, i.e. only
 *     very dark pixels move).
 *   - `{ kind: "endpoint-high", exp: n }` →  weight = L^n
 *     (Whites — bigger `n` = sharper localisation at L≈1).
 *   - `{ kind: "midtone", a, b }` →  weight = K · L^a · (1-L)^b
 *     (Shadows / Highlights — bump centred at L = a/(a+b);
 *     larger a+b narrows the bump). K is auto-computed so the bump
 *     peaks at exactly 1.0.
 */
type RegionWeight =
  | { kind: "endpoint-low"; exp: number }
  | { kind: "endpoint-high"; exp: number }
  | { kind: "midtone"; a: number; b: number };

const TONE_REGION: Record<
  "blacks" | "shadows" | "highlights" | "whites",
  { amplitude: number; weightExp: RegionWeight }
> = {
  // Endpoint pulls — sharp falloff so only the darkest / brightest
  // pixels are affected. Higher exponents than the previous (6) make
  // the slider feel less twitchy and more targeted.
  blacks: {
    amplitude: 0.25,
    weightExp: { kind: "endpoint-low", exp: 10 },
  },
  whites: {
    amplitude: 0.25,
    weightExp: { kind: "endpoint-high", exp: 10 },
  },
  // Midtone bumps — narrowed (a+b raised from 4 to 6) and lower
  // amplitude so the slider only nudges its lobe.
  shadows: {
    amplitude: 0.18,
    weightExp: { kind: "midtone", a: 1, b: 5 },
  },
  highlights: {
    amplitude: 0.18,
    weightExp: { kind: "midtone", a: 5, b: 1 },
  },
};

/** GLSL float literal with a decimal point, so the WebGL2 compiler
 *  treats it as a float and not an int. */
function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : n.toString();
}

/** Build the GLSL weight expression for a region from its
 *  {@link RegionWeight} descriptor. The result is a fragment of
 *  GLSL that evaluates to a `float` weight in `[0, 1]`. */
function regionWeightGlsl(w: RegionWeight): string {
  switch (w.kind) {
    case "endpoint-low":
      return `pow(oneMinusL, ${glslFloat(w.exp)})`;
    case "endpoint-high":
      return `pow(L, ${glslFloat(w.exp)})`;
    case "midtone": {
      // Bump w(L) = L^a · (1-L)^b peaks at L = a/(a+b) with peak
      // value (a^a · b^b) / (a+b)^(a+b). Multiply by the reciprocal
      // (`norm`) so the weight tops out at 1.
      const { a, b } = w;
      const peak = (Math.pow(a, a) * Math.pow(b, b)) /
        Math.pow(a + b, a + b);
      const norm = peak > 0 ? 1 / peak : 1;
      return `${glslFloat(norm)} * pow(L, ${glslFloat(a)}) * pow(oneMinusL, ${glslFloat(b)})`;
    }
  }
}

function toneCoefficients(t: ToneEdit): {
  exposure: number;
  contrast: number;
  saturation: number;
  blacks: number;
  shadows: number;
  highlights: number;
  whites: number;
} {
  return {
    exposure: Math.pow(2, t.exposure / 100),
    // Halved sensitivity — slider [-100,100] → contrast factor [0.5, 1.5].
    contrast: Math.max(0, 1 + t.contrast / 200),
    saturation: Math.max(0, 1 + t.saturation / 100),
    // Region sliders pass through normalised; the shader scales them
    // by per-region max-offset constants.
    blacks: t.blacks / 100,
    shadows: t.shadows / 100,
    highlights: t.highlights / 100,
    whites: t.whites / 100,
  };
}

/**
 * GPU pipeline that renders an `ImageBitmap` with brightness/contrast/
 * saturation applied by a fragment shader, into an internal canvas
 * that the main 2D canvas can `drawImage()` from.
 *
 * We use this instead of Canvas2D's `ctx.filter` because that property
 * is unsupported (or unreliable) in older WebKit versions — including
 * the WKWebView Tauri ships against on macOS — which is why the
 * sliders previously appeared to do nothing.
 *
 * Caching: the source texture is uploaded once per bitmap (a 40 MP
 * upload is the expensive part). Re-rendering with new tone uniforms
 * is essentially free.
 */
type ToneSource =
  | ImageBitmap
  | HTMLCanvasElement
  | OffscreenCanvas;

class TonePipeline {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private texture: WebGLTexture | null = null;
  private uploadedBitmap: ToneSource | null = null;
  private uniforms: {
    exposure: WebGLUniformLocation | null;
    contrast: WebGLUniformLocation | null;
    saturation: WebGLUniformLocation | null;
    blacks: WebGLUniformLocation | null;
    shadows: WebGLUniformLocation | null;
    highlights: WebGLUniformLocation | null;
    whites: WebGLUniformLocation | null;
    srcOffset: WebGLUniformLocation | null;
    srcScale: WebGLUniformLocation | null;
  } = {
    exposure: null,
    contrast: null,
    saturation: null,
    blacks: null,
    shadows: null,
    highlights: null,
    whites: null,
    srcOffset: null,
    srcScale: null,
  };
  private failed = false;

  constructor() {
    this.canvas = document.createElement("canvas");
  }

  /**
   * Render the sub-rectangle `(srcRect.sx, sy)..(+sw, +sh)` of `bm`
   * with `tone` applied, into an internal canvas of size `outW × outH`.
   * The output canvas can then be copied with `drawImage()`. Returns
   * `null` if WebGL initialisation failed.
   *
   * Rendering at the *display* size (rather than the bitmap's native
   * size) keeps the per-frame cost proportional to what's visible: a
   * 40 MP source feeding a 2 MP viewport processes 2 MP fragments,
   * not 40 MP, and the subsequent `drawImage` copy is cheap.
   */
  render(
    bm: ToneSource,
    tone: ToneEdit,
    srcRect: { sx: number; sy: number; sw: number; sh: number },
    outW: number,
    outH: number,
  ): HTMLCanvasElement | null {
    if (this.failed) return null;
    if (!this.gl) {
      const gl = this.canvas.getContext("webgl2", {
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null;
      if (!gl) {
        this.failed = true;
        console.warn("WebGL2 unavailable — tone adjustments disabled");
        return null;
      }
      this.gl = gl;
      if (!this.initProgram()) {
        this.failed = true;
        return null;
      }
    }
    const gl = this.gl;
    if (this.canvas.width !== outW) this.canvas.width = outW;
    if (this.canvas.height !== outH) this.canvas.height = outH;
    if (this.uploadedBitmap !== bm) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bm
      );
      this.uploadedBitmap = bm;
    }
    const c = toneCoefficients(tone);
    const sx = srcRect.sx / bm.width;
    const sy = srcRect.sy / bm.height;
    const sw = srcRect.sw / bm.width;
    const sh = srcRect.sh / bm.height;
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.uniforms.exposure, c.exposure);
    gl.uniform1f(this.uniforms.contrast, c.contrast);
    gl.uniform1f(this.uniforms.saturation, c.saturation);
    gl.uniform1f(this.uniforms.blacks, c.blacks);
    gl.uniform1f(this.uniforms.shadows, c.shadows);
    gl.uniform1f(this.uniforms.highlights, c.highlights);
    gl.uniform1f(this.uniforms.whites, c.whites);
    gl.uniform2f(this.uniforms.srcOffset, sx, sy);
    gl.uniform2f(this.uniforms.srcScale, sw, sh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.canvas;
  }

  /** Drop the cached texture upload so the next `render()` re-uploads.
   * Called when the canvas swaps to a different bitmap. */
  invalidate() {
    this.uploadedBitmap = null;
  }

  /** Pre-initialise the GL context, compile the shader program, and
   * upload `bm` as a texture so the next `render()` only needs to
   * issue a draw call. Safe to call repeatedly with the same bitmap;
   * a no-op if the pipeline is already warm for that bitmap. */
  warmup(bm: ToneSource): void {
    if (this.failed) return;
    if (!this.gl) {
      const gl = this.canvas.getContext("webgl2", {
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null;
      if (!gl) {
        this.failed = true;
        return;
      }
      this.gl = gl;
      if (!this.initProgram()) {
        this.failed = true;
        return;
      }
    }
    if (this.uploadedBitmap === bm) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bm
    );
    this.uploadedBitmap = bm;
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.program = null;
    this.texture = null;
    this.vao = null;
    this.gl = null;
    this.uploadedBitmap = null;
  }

  private initProgram(): boolean {
    const gl = this.gl!;
    // Y is flipped in clip space so the GL framebuffer's bottom-left
    // origin lines up with `drawImage`'s top-left read order: without
    // this flip, copying the GL canvas into a 2D canvas produces an
    // upside-down image.
    const vsSource = `#version 300 es
      in vec2 a_pos;
      uniform vec2 u_srcOffset;
      uniform vec2 u_srcScale;
      out vec2 v_uv;
      void main() {
        vec2 q = a_pos * 0.5 + 0.5;
        v_uv = u_srcOffset + q * u_srcScale;
        gl_Position = vec4(a_pos.x, -a_pos.y, 0.0, 1.0);
      }
    `;
    // Pipeline (in order):
    //   1. Exposure       — global multiply.
    //   2. Region offsets — Capture-One-style Blacks/Shadows/
    //      Highlights/Whites sliders. Each is a luminance-weighted
    //      additive offset using bumps that don't overlap much, so
    //      e.g. dragging Blacks only moves the dark end. The exact
    //      shape and amplitude per region is configured in the
    //      module-level `TONE_REGION` table.
    //   3. Contrast — S-curve around 0.5.
    //   4. Saturation — interpolate towards luminance.
    const wB = regionWeightGlsl(TONE_REGION.blacks.weightExp);
    const wS = regionWeightGlsl(TONE_REGION.shadows.weightExp);
    const wH = regionWeightGlsl(TONE_REGION.highlights.weightExp);
    const wW = regionWeightGlsl(TONE_REGION.whites.weightExp);
    const aB = glslFloat(TONE_REGION.blacks.amplitude);
    const aS = glslFloat(TONE_REGION.shadows.amplitude);
    const aH = glslFloat(TONE_REGION.highlights.amplitude);
    const aW = glslFloat(TONE_REGION.whites.amplitude);
    const fsSource = `#version 300 es
      precision highp float;
      uniform sampler2D u_tex;
      uniform float u_exposure;
      uniform float u_contrast;
      uniform float u_saturation;
      uniform float u_blacks;
      uniform float u_shadows;
      uniform float u_highlights;
      uniform float u_whites;
      in vec2 v_uv;
      out vec4 outColor;

      const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

      void main() {
        vec4 src = texture(u_tex, v_uv);
        vec3 col = src.rgb * u_exposure;

        // Per-tonal-region adjustments. Compute luminance once, derive
        // four non-overlapping weights, and add a uniform-RGB offset
        // so chroma is preserved. Using clamped luminance for weights
        // keeps the highlight bump effective even after Exposure has
        // pushed the brightest pixels above 1.0.
        float L = clamp(dot(col, LUMA), 0.0, 1.0);
        float oneMinusL = 1.0 - L;

        float wBlacks    = ${wB};
        float wWhites    = ${wW};
        float wShadows   = ${wS};
        float wHighlights= ${wH};

        float offset =
            u_blacks     * ${aB} * wBlacks
          + u_shadows    * ${aS} * wShadows
          + u_highlights * ${aH} * wHighlights
          + u_whites     * ${aW} * wWhites;
        col += vec3(offset);

        // S-curve around 0.5.
        col = (col - 0.5) * u_contrast + 0.5;

        // Saturation: interpolate between greyscale and colour.
        float postLuma = dot(col, LUMA);
        col = mix(vec3(postLuma), col, u_saturation);

        outColor = vec4(col, src.a);
      }
    `;
    const vs = this.compile(gl.VERTEX_SHADER, vsSource);
    const fs = this.compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return false;
    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("tone shader link failed:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return false;
    }
    this.program = program;
    this.uniforms.exposure = gl.getUniformLocation(program, "u_exposure");
    this.uniforms.contrast = gl.getUniformLocation(program, "u_contrast");
    this.uniforms.saturation = gl.getUniformLocation(program, "u_saturation");
    this.uniforms.blacks = gl.getUniformLocation(program, "u_blacks");
    this.uniforms.shadows = gl.getUniformLocation(program, "u_shadows");
    this.uniforms.highlights = gl.getUniformLocation(program, "u_highlights");
    this.uniforms.whites = gl.getUniformLocation(program, "u_whites");
    this.uniforms.srcOffset = gl.getUniformLocation(program, "u_srcOffset");
    this.uniforms.srcScale = gl.getUniformLocation(program, "u_srcScale");

    // Fullscreen quad as two triangles in clip space.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // prettier-ignore
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,  1, -1,  -1,  1,
        -1,  1,  1, -1,   1,  1,
      ]),
      gl.STATIC_DRAW
    );
    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    // Texture: linear filtering, clamp.
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texture = tex;
    return true;
  }

  private compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("tone shader compile failed:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-image-canvas": PfImageCanvas;
  }
}

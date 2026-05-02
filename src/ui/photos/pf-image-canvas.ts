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
  getFullImage,
  loadFullImage,
  setFullImageDecoder,
} from "../../app/full-image-cache";

export type ImageFit = "contain" | "proof" | "tight";
export type ImageSizing = "fit" | "fill";

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
  /** Defers the expensive full-image fetch+decode so quickly skipping
   * past photos doesn't pile up parallel decodes that starve the photo
   * the user actually settles on. */
  private fullLoadTimer: number | null = null;
  private static FULL_LOAD_DELAY_MS = 250;
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOffX = 0;
  private dragOffY = 0;

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
    if (this.path) this.startLoad();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.loadAbort?.abort();
    if (this.fullLoadTimer !== null) {
      window.clearTimeout(this.fullLoadTimer);
      this.fullLoadTimer = null;
    }
    // Full bitmap is owned by `full-image-cache`; do NOT close it here.
    this.thumbBitmap?.close?.();
    this.bitmap = null;
    this.thumbBitmap = null;
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("path")) {
      this.userInteracted = false;
      this.forceFitOnNextRecompute = true;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
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
    if (changed.has("background")) {
      this.style.setProperty("--pf-canvas-bg", this.background);
      this.draw();
    }
  }

  private async startLoad() {
    this.loadAbort?.abort();
    if (this.fullLoadTimer !== null) {
      window.clearTimeout(this.fullLoadTimer);
      this.fullLoadTimer = null;
    }
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

    // Fast path: full image already in the cross-instance LRU cache.
    // Skip the thumbnail roundtrip and the deferred-decode entirely so
    // navigating between recently-viewed photos is instant.
    const cached = getFullImage(path);
    if (cached) {
      this.bitmap = cached;
      this.bitmapForPath = path;
      this.status = "ready";
      this.recomputeFit();
      this.draw();
      return;
    }

    this.draw();

    // Phase 1: thumbnail (cached → near-instant). Always kick this off
    // immediately so even rapid arrow-key navigation shows something.
    const thumbHandle = requestThumbnail(path);
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

    // Phase 2: full encoded bytes → createImageBitmap. Defer by 250 ms so
    // that flicking past photos doesn't queue up expensive decodes for
    // every intermediate frame; only the photo the user actually settles
    // on pays the full-render cost.
    this.fullLoadTimer = window.setTimeout(() => {
      this.fullLoadTimer = null;
      if (ac.signal.aborted || this.path !== path) return;
      void this.loadFullImage(path, ac);
    }, PfImageCanvas.FULL_LOAD_DELAY_MS);
  }

  private async loadFullImage(path: string, ac: AbortController) {
    try {
      // Goes through the shared LRU cache: dedupes concurrent requests,
      // returns instantly if another canvas already decoded this photo,
      // and stores the result for future hits / neighbour preloads.
      const bm = await loadFullImage(path);
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
    const bm = this.currentBitmap;
    if (!bm || !this.canvas) {
      this.fitScale = 1;
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, this.canvas.width);
    const ch = Math.max(1, this.canvas.height);
    // Sizing mode picks the floor scale: `fit` (default) is the
    // largest scale that fits inside the canvas (capped at 1:1
    // image-px ↔ device-px); `fill` is the smallest scale that
    // fully covers the canvas — the long axis gets cropped, no dpr
    // cap so we always cover even on hi-DPR displays.
    this.fitScale =
      this.sizing === "fill"
        ? Math.max(cw / bm.width, ch / bm.height)
        : Math.min(cw / bm.width, ch / bm.height, dpr);
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

  private draw() {
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
      const drawW = bm.width * this.scale;
      const drawH = bm.height * this.scale;
      const cx = cv.width / 2 + this.offsetX;
      const cy = cv.height / 2 + this.offsetY;
      const x = cx - drawW / 2;
      const y = cy - drawH / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bm, x, y, drawW, drawH);
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
    this.draw();
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
    const bm = this.currentBitmap;
    if (!bm || !this.canvas) return;
    const viewW = Math.max(1, this.canvas.width);
    const viewH = Math.max(1, this.canvas.height);
    const drawW = bm.width * this.scale;
    const drawH = bm.height * this.scale;
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
    this.draw();
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

function decodeBase64Jpeg(b64: string): Promise<ImageBitmap> {
  const bin = atob(b64);
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

// Hand the worker-backed decoder to the shared full-image cache so it
// can fetch+decode entries on cache misses (and prefetches from
// `pf-full-view`). Registering at module load means any code path that
// imports the cache after this module is wired up.
setFullImageDecoder(decodeInWorker);

declare global {
  interface HTMLElementTagNameMap {
    "pf-image-canvas": PfImageCanvas;
  }
}

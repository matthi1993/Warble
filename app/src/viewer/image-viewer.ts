import {
  CropOverlay,
  HorizonOverlay,
  ImageExporter,
  ImageGeometry,
  RenderPipeline,
  type CropFrame,
  type Overlay,
} from "@warble/render";
import { CropGestures } from "./crop-gestures";
import { CropSession } from "./crop-session";
import { EditStateSync } from "./edit-state-sync";
import { FullImageUpgrade } from "./full-image-upgrade";
import { HorizonGesture } from "./horizon-gesture";
import { ImageLoader, type LoadStatus } from "./image-loader";
import { ImageSources } from "./image-sources";
import { LongPress } from "./long-press";
import { SettingsChanges } from "./settings-changes";
import { TapGestures } from "./tap-gestures";
import type { ViewerDependencies } from "./viewer-dependencies";
import { ViewerEdits } from "./viewer-edits";
import { ViewerGeometry } from "./viewer-geometry";
import { ViewerInput } from "./viewer-input";
import { ViewerScene, type ViewerPipeline } from "./viewer-scene";
import type { ChangedSettings, ViewerHost } from "./viewer-settings";
import { ViewerSurface } from "./viewer-surface";
import { ViewportGestures } from "./viewport-gestures";

/** Everything behind the `pf-image-canvas` element, free of the UI framework. */
export class ImageViewer {
  readonly sources: ImageSources;
  readonly scene: ViewerScene;
  private readonly edits: ViewerEdits;
  private readonly upgrade: FullImageUpgrade;
  private readonly loader: ImageLoader;
  private readonly crop: CropSession;
  private readonly horizon: HorizonGesture;
  private readonly input: ViewerInput;
  private readonly editSync: EditStateSync;
  private readonly changes: SettingsChanges;
  private readonly exporter: ImageExporter;

  constructor(
    private readonly host: ViewerHost,
    private readonly dependencies: ViewerDependencies,
    pipeline: ViewerPipeline = new RenderPipeline(),
    geometry = new ImageGeometry(),
  ) {
    const { images, edits } = dependencies;
    this.sources = new ImageSources(host);
    this.edits = new ViewerEdits(host, edits);
    const surface = new ViewerSurface();
    const viewerGeometry = new ViewerGeometry(host, this.sources, this.edits, surface, geometry);
    this.scene = new ViewerScene(host, surface, this.sources, this.edits, viewerGeometry, pipeline, () =>
      this.overlays(),
    );
    this.upgrade = new FullImageUpgrade(host, this.scene, images, this.sources);
    this.loader = new ImageLoader(host, this.scene, images, this.sources, this.upgrade);
    this.crop = new CropSession(host, this.edits, viewerGeometry);
    this.horizon = new HorizonGesture(host, this.scene);
    const taps = new TapGestures(host, this.scene);
    const longPress = new LongPress(host, this.scene, taps);
    const viewportGestures = new ViewportGestures(this.scene, taps, longPress);
    const cropGestures = new CropGestures(host, this.scene, this.crop, this.horizon);
    this.input = new ViewerInput(host, this.scene, viewportGestures, cropGestures, taps, longPress);
    this.editSync = new EditStateSync(host, edits, this.edits, this.scene, this.crop);
    this.changes = new SettingsChanges(host, this.scene, this.loader, this.edits, this.crop, this.input);
    this.exporter = new ImageExporter(pipeline);
  }

  connect(canvas: HTMLCanvasElement): void {
    this.scene.attach(canvas);
    this.scene.surface.observe(() => this.scene.resize());
    this.input.attach(canvas);
    this.scene.resize();
    if (this.host.path) {
      this.edits.refreshSavedCrop();
      this.loader.start();
    }
    this.editSync.connect();
  }

  disconnect(): void {
    this.scene.surface.disconnect();
    this.loader.stop();
    this.scene.releaseImage();
    this.input.detach();
    this.sources.clear();
    this.editSync.disconnect();
    this.scene.pipeline.dispose();
  }

  settingsChanged(changed: ChangedSettings): void {
    this.changes.apply(changed);
  }

  get status(): LoadStatus {
    return this.loader.status;
  }

  get errorMessage(): string {
    return this.loader.errorMessage;
  }

  get awaitingFirstImage(): boolean {
    return this.loader.status === "loading" && !this.sources.current;
  }

  get upgradingToFullResolution(): boolean {
    const { path, enableFullRes } = this.host;
    return enableFullRes && this.upgrade.loading && !!this.sources.current && this.sources.fullPath !== path;
  }

  get imageReady(): boolean {
    return this.loader.ready;
  }

  beginEditInteraction(): void {
    this.scene.quality.beginEdit();
  }

  endEditInteraction(): void {
    this.scene.quality.endEdit();
  }

  reloadSource(): void {
    this.loader.reload();
  }

  resetView(): void {
    this.scene.viewport.userInteracted = false;
    this.scene.fit();
    this.scene.viewport.snapToFit();
    this.scene.redraw();
  }

  /** Renders the whole edited photo, so zoom, pan and the frame never end up in the file. */
  async exportJpeg(): Promise<Uint8Array> {
    const path = this.host.path;
    if (!path) throw new Error("no photo is loaded");
    const source = await this.dependencies.images.loadFull(path);
    if (this.host.path !== path) throw new Error("photo changed during export");
    const original = this.host.previewOriginal;
    return this.exporter.exportJpeg({
      source,
      rotation: original ? 0 : this.edits.rotation(),
      crop: original || !this.edits.cropEnabled() ? null : this.edits.savedCrop,
      recipe: this.edits.recipe(),
      smoothingQuality: this.host.smoothingQuality,
    });
  }

  getCropFrame(): CropFrame | null {
    return this.crop.frame ? { ...this.crop.frame } : null;
  }

  setCropFrame(frame: CropFrame | null): void {
    this.crop.frame = frame ? { ...frame } : null;
    this.scene.redraw();
  }

  private overlays(): Overlay[] {
    const overlays: Overlay[] = [];
    if (this.host.cropMode && this.crop.frame && this.edits.cropEnabled()) {
      overlays.push(new CropOverlay(this.crop.frame));
    }
    if (this.horizon.line) overlays.push(new HorizonOverlay(this.horizon.line));
    return overlays;
  }
}

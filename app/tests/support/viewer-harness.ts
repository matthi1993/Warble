import { vi } from "vitest";
import { ImageGeometry, PresentationRotator, SourceRotator, type RotatedCanvas } from "@warble/render";
import { ImageViewer } from "@viewer/image-viewer";
import type { ChangedSettings } from "@viewer/viewer-settings";
import { FakeEdits, FakeHost, FakeImages, FakePipeline } from "./viewer-fakes";

type Listener = (event: never) => void;

interface FakeEvent {
  clientX?: number;
  clientY?: number;
  deltaY?: number;
  pointerId?: number;
  pointerType?: string;
  button?: number;
}

export const ignoredContext = new Proxy({}, { get: () => () => {}, set: () => true });

/** Stands in for the canvas element: remembers listeners so tests can send it events. */
export class FakeCanvasElement {
  width = 0;
  height = 0;
  readonly classList = { add: () => {}, remove: () => {} };
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    public cssWidth: number,
    public cssHeight: number,
  ) {}

  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.cssWidth, height: this.cssHeight };
  }

  getContext() {
    return ignoredContext;
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  setPointerCapture(): void {}

  releasePointerCapture(): void {}

  emit(type: string, event: FakeEvent = {}): { defaultPrevented: boolean } {
    const sent = {
      type,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      defaultPrevented: false,
      preventDefault: () => void (sent.defaultPrevented = true),
      ...event,
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(sent as never);
    return sent;
  }
}

export interface Screen {
  width: number;
  height: number;
  pixelRatio: number;
}

/** Replaces the browser globals the viewer uses and the timers it sets. Undo with `uninstallBrowser`. */
export function installBrowser(screen: Screen = { width: 1200, height: 800, pixelRatio: 1 }) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const window = {
    innerWidth: screen.width,
    innerHeight: screen.height,
    devicePixelRatio: screen.pixelRatio,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  vi.stubGlobal("window", window);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    disconnect(): void {}
  });
  return window;
}

export function uninstallBrowser(): void {
  vi.unstubAllGlobals();
  vi.useRealTimers();
}

export async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

export function createViewer(canvasSize = { width: 1200, height: 800 }) {
  const host = new FakeHost();
  const images = new FakeImages();
  const edits = new FakeEdits();
  const pipeline = new FakePipeline();
  const rotations: RotatedCanvas[] = [];
  const offscreenCanvas = (width = 0, height = 0) =>
    ({ width, height, getContext: () => ignoredContext }) as unknown as HTMLCanvasElement;
  const geometry = new ImageGeometry(
    new SourceRotator((width, height) => {
      rotations.push(offscreenCanvas(width, height));
      return rotations[rotations.length - 1];
    }),
    new PresentationRotator(offscreenCanvas),
  );
  const viewer = new ImageViewer(host, { images, edits }, pipeline, geometry);
  const canvas = new FakeCanvasElement(canvasSize.width, canvasSize.height);
  return {
    host,
    images,
    edits,
    pipeline,
    rotations,
    viewer,
    canvas,
    scene: viewer.scene,
    sources: viewer.sources,
    connect: () => viewer.connect(canvas as unknown as HTMLCanvasElement),
    /** Sets element properties the way a Lit update reports them. */
    change(settings: Partial<FakeHost>): void {
      Object.assign(host, settings);
      viewer.settingsChanged(new Set(Object.keys(settings)) as unknown as ChangedSettings);
    },
  };
}

export type ViewerFixture = ReturnType<typeof createViewer>;

import { describe, expect, it } from "vitest";
import {
  EMPTY_RECIPE,
  ImageView,
  ViewLayout,
  Viewport,
  cropRegion,
  visibleRegion,
  type DisplayImage,
  type ImageRenderer,
  type Overlay,
  type RenderRequest,
  type RenderedImage,
  type ViewFrame,
} from "../src";
import { RecordingContext, fakeImage } from "./support/canvas-fakes";

class FakeRenderer implements ImageRenderer {
  readonly requests: RenderRequest[] = [];
  changes = true;
  available = true;

  changesImage(): boolean {
    return this.changes;
  }

  render(request: RenderRequest): RenderedImage | null {
    this.requests.push(request);
    if (!this.available) return null;
    return { width: request.outputWidth, height: request.outputHeight } as RenderedImage;
  }
}

function viewFixture() {
  const recording = new RecordingContext();
  const renderer = new FakeRenderer();
  const view = new ImageView(recording.context, renderer);
  const source = fakeImage(2400, 1600);
  const image: DisplayImage = { source, region: cropRegion(source, null) };
  const viewport = new Viewport();
  const frame = (overrides: Partial<ViewFrame> = {}): ViewFrame => {
    const layout = overrides.layout ?? new ViewLayout({ width: 1200, height: 800 }, 0, 0, 1);
    return {
      image,
      recipe: EMPTY_RECIPE,
      viewport,
      layout,
      style: { background: "transparent", frameColor: "#fff", frameRadius: 0, smoothingQuality: "high" },
      renderScale: 1,
      overlays: [],
      ...overrides,
    };
  };
  viewport.fit("fit", { canvas: { width: 1200, height: 800 }, view: { width: 1200, height: 800 }, image: image.region });
  return { recording, renderer, view, source, image, viewport, frame };
}

describe("ImageView", () => {
  it("draws the unedited source directly when the recipe changes nothing", () => {
    const { recording, renderer, view, source, frame } = viewFixture();
    renderer.changes = false;
    view.draw(frame());
    expect(renderer.requests).toHaveLength(0);
    expect(recording.argsOf("drawImage")).toEqual([[source, 0, 0, 2400, 1600, 0, 0, 1200, 800]]);
    expect(recording.argsOf("fillRect")).toHaveLength(0);
  });

  it("renders the edited image at canvas resolution and scales it down while interacting", () => {
    const { recording, renderer, view, source, frame } = viewFixture();
    view.draw(frame());
    expect(renderer.requests[0]).toMatchObject({
      source,
      region: { x: 0, y: 0, width: 2400, height: 1600 },
      outputWidth: 1200,
      outputHeight: 800,
      effectSize: { width: 1200, height: 800 },
    });
    view.draw(frame({ renderScale: 0.6 }));
    expect(renderer.requests[1]).toMatchObject({
      outputWidth: 720,
      outputHeight: 480,
      effectSize: { width: 1200, height: 800 },
    });
    expect(recording.argsOf("drawImage")[1].slice(1)).toEqual([0, 0, 720, 480, 0, 0, 1200, 800]);
  });

  it("renders only the part of a zoomed image that is on the canvas", () => {
    const { renderer, view, viewport, frame } = viewFixture();
    viewport.scale = 2;
    viewport.offsetX = 600;
    view.draw(frame());
    expect(renderer.requests[0].region).toEqual({ x: 600, y: 600, width: 600, height: 400 });
    expect([renderer.requests[0].outputWidth, renderer.requests[0].outputHeight]).toEqual([600, 400]);
  });

  it("falls back to the unedited source when the renderer cannot render", () => {
    const { recording, renderer, view, source, frame } = viewFixture();
    renderer.available = false;
    view.draw(frame());
    expect(recording.argsOf("drawImage")).toEqual([[source, 0, 0, 2400, 1600, 0, 0, 1200, 800]]);
  });

  it("paints the background, then the frame around the image, then clips the image to rounded corners", () => {
    const { recording, view, viewport, frame } = viewFixture();
    const layout = new ViewLayout({ width: 1200, height: 800 }, 10, 20, 2);
    const source = fakeImage(2160, 1360);
    const image = { source, region: cropRegion(source, null) };
    viewport.fit("fit", { canvas: layout.canvas, view: layout.view, image: image.region });
    view.draw(
      frame({
        image,
        layout,
        style: { background: "#111", frameColor: "#eee", frameRadius: 4, smoothingQuality: "low" },
      }),
    );
    expect(recording.argsOf("fillRect")).toEqual([
      [0, 0, 1200, 800],
      [40, 40, 1120, 720],
    ]);
    expect(recording.argsOf("set fillStyle")).toEqual([["#111"], ["#eee"]]);
    expect(recording.argsOf("roundRect")).toEqual([[60, 60, 1080, 680, 8]]);
    expect(recording.argsOf("set imageSmoothingQuality")).toEqual([["low"]]);
    const order = recording.names();
    expect(order.indexOf("clip")).toBeLessThan(order.indexOf("drawImage"));
    expect(order.filter((name) => name === "save")).toHaveLength(order.filter((name) => name === "restore").length);
  });

  it("paints overlays over the image with the image's rectangle and the pixel ratio", () => {
    const { view, viewport, frame } = viewFixture();
    const painted: unknown[][] = [];
    const overlay: Overlay = { paint: (_context, image, pixelRatio) => painted.push([image, pixelRatio]) };
    viewport.scale = 1;
    view.draw(frame({ overlays: [overlay], layout: new ViewLayout({ width: 1200, height: 800 }, 0, 0, 2) }));
    expect(painted).toEqual([[{ x: -600, y: -400, width: 2400, height: 1600 }, 2]]);
  });

  it("only clears the canvas when there is no image or it lies outside the margins", () => {
    const { recording, view, viewport, frame } = viewFixture();
    view.draw(frame({ image: null }));
    viewport.offsetX = 5000;
    view.draw(frame());
    expect(recording.argsOf("clearRect")).toEqual([[0, 0, 1200, 800], [0, 0, 1200, 800]]);
    expect(recording.argsOf("drawImage")).toHaveLength(0);
  });
});

describe("visibleRegion", () => {
  it("never asks for more pixels than the source region holds", () => {
    const visible = visibleRegion({ x: 100, y: 100, width: 1000, height: 600 }, { width: 1200, height: 800 }, {
      x: 0, y: 0, width: 50, height: 30,
    });
    expect(visible!.output).toEqual({ width: 50, height: 30 });
    expect(visible!.target).toEqual({ x: 100, y: 100, width: 1000, height: 600 });
  });

  it("is empty when the image lies outside the canvas", () => {
    const canvas = { width: 1200, height: 800 };
    expect(visibleRegion({ x: 1300, y: 0, width: 100, height: 100 }, canvas, { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
  });
});

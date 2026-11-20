import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CropOverlay,
  HorizonOverlay,
  ImageExporter,
  JpegEncoder,
  SourceRotator,
  type ImageRenderer,
  type RenderRequest,
  type RenderedImage,
  type RotatedCanvas,
} from "../src";
import { FakeCanvas, RecordingContext, fakeImage } from "./support/canvas-fakes";

class FakeEncoder extends JpegEncoder {
  readonly encoded: unknown[][] = [];

  override async encode(image: CanvasImageSource, width: number, height: number): Promise<Uint8Array> {
    this.encoded.push([image, width, height]);
    return new Uint8Array([0xff, 0xd8]);
  }
}

function exporterFixture(rendered: RenderedImage | null = { width: 1, height: 1 } as RenderedImage) {
  const requests: RenderRequest[] = [];
  const renderer: ImageRenderer = {
    changesImage: () => true,
    render: (request) => {
      requests.push(request);
      return rendered;
    },
  };
  const rotated = new FakeCanvas();
  const rotator = new SourceRotator((width, height) => {
    rotated.width = width;
    rotated.height = height;
    return rotated as unknown as RotatedCanvas;
  });
  const encoder = new FakeEncoder();
  return { exporter: new ImageExporter(renderer, rotator, encoder), requests, rotated, encoder, rendered };
}

describe("ImageExporter", () => {
  const request = { rotation: 0, crop: null, recipe: { photo: {}, post: {} }, smoothingQuality: "high" as const };

  it("renders the whole source at full resolution with the photo layer only", async () => {
    const { exporter, requests, encoder, rendered } = exporterFixture();
    const source = fakeImage(6000, 4000);
    const photo = { analog: { vignette: 10, halation: 0, chromaticAberration: 0 } };
    const post = { analog: { vignette: 50, halation: 0, chromaticAberration: 0 } };
    const bytes = await exporter.exportJpeg({ ...request, source, recipe: { photo, post } });
    expect(requests).toEqual([
      {
        source,
        recipe: { photo, post: {} },
        region: { x: 0, y: 0, width: 6000, height: 4000 },
        outputWidth: 6000,
        outputHeight: 4000,
      },
    ]);
    expect(encoder.encoded).toEqual([[rendered, 6000, 4000]]);
    expect([...bytes]).toEqual([0xff, 0xd8]);
  });

  it("crops the rotated source and rounds the output to whole pixels", async () => {
    const { exporter, requests, rotated } = exporterFixture();
    const crop = { x: 0.1, y: 0.2, width: 0.333, height: 0.5 };
    await exporter.exportJpeg({ ...request, source: fakeImage(400, 200), rotation: 90, crop });
    expect(requests[0].source).toBe(rotated);
    expect(requests[0].region.x).toBeCloseTo(20);
    expect(requests[0].region.width).toBeCloseTo(66.6);
    expect([requests[0].outputWidth, requests[0].outputHeight]).toEqual([67, 200]);
  });

  it("fails loudly when the image cannot be rotated or rendered", async () => {
    const unrendered = exporterFixture(null);
    await expect(unrendered.exporter.exportJpeg({ ...request, source: fakeImage(4, 2) })).rejects.toThrow(
      "could not render edited image",
    );
    const unrotated = exporterFixture();
    unrotated.rotated.contextAvailable = false;
    await expect(
      unrotated.exporter.exportJpeg({ ...request, source: fakeImage(4, 2), rotation: 5 }),
    ).rejects.toThrow("could not rotate image for export");
  });
});

describe("JpegEncoder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("copies the rendered image to an offscreen canvas and encodes it at quality 0.92", async () => {
    const encodes: unknown[] = [];
    const canvases: FakeCanvas[] = [];
    class FakeOffscreenCanvas extends FakeCanvas {
      constructor(width: number, height: number) {
        super(width, height);
        canvases.push(this);
      }
      async convertToBlob(options: unknown): Promise<Blob> {
        encodes.push(options);
        return new Blob([new Uint8Array([1, 2, 3])]);
      }
    }
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    const rendered = {} as CanvasImageSource;
    const bytes = await new JpegEncoder().encode(rendered, 300, 200);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(encodes).toEqual([{ type: "image/jpeg", quality: 0.92 }]);
    expect(canvases[0].recording.argsOf("drawImage")).toEqual([[rendered, 0, 0, 300, 200]]);
  });

  it("falls back to an element canvas where OffscreenCanvas cannot encode", async () => {
    const canvas = Object.assign(new FakeCanvas(), {
      toBlob(done: (blob: Blob | null) => void, type: string, quality: number) {
        done(type === "image/jpeg" && quality === 0.92 ? new Blob([new Uint8Array([9])]) : null);
      },
    });
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", { createElement: () => canvas });
    expect([...(await new JpegEncoder().encode({} as CanvasImageSource, 30, 20))]).toEqual([9]);
    expect([canvas.width, canvas.height]).toEqual([30, 20]);
  });
});

describe("overlays", () => {
  const image = { x: 100, y: 50, width: 1000, height: 600 };

  it("the crop overlay darkens everything outside the frame and outlines the frame", () => {
    const recording = new RecordingContext();
    new CropOverlay({ x: 0.1, y: 0.5, width: 0.5, height: 0.25 }).paint(recording.context, image, 2);
    expect(recording.argsOf("rect")).toEqual([[100, 50, 1000, 600], [200, 350, 500, 150]]);
    expect(recording.argsOf("fill")).toEqual([["evenodd"]]);
    expect(recording.argsOf("strokeRect")).toEqual([[200, 350, 500, 150]]);
    expect(recording.argsOf("set lineWidth")).toEqual([[2], [6]]);
    expect(recording.argsOf("stroke")).toHaveLength(3);
  });

  it("the horizon overlay draws a dashed line between its two end points", () => {
    const recording = new RecordingContext();
    new HorizonOverlay({ ax: 0, ay: 0.5, bx: 1, by: 1 }).paint(recording.context, image, 2);
    expect(recording.argsOf("moveTo")).toEqual([[100, 350]]);
    expect(recording.argsOf("lineTo")).toEqual([[1100, 650]]);
    expect(recording.argsOf("setLineDash")).toEqual([[[12, 8]], [[]]]);
    expect(recording.argsOf("arc").map((args) => args.slice(0, 3))).toEqual([[100, 350, 6], [1100, 650, 6]]);
  });
});

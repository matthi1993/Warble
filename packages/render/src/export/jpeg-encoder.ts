const JPEG_QUALITY = 0.92;

export class JpegEncoder {
  /**
   * `image` is copied to a 2D canvas first because a WebGL canvas does not
   * keep its drawing buffer for encoding. OffscreenCanvas encodes off the main
   * thread where the webview has the complete API.
   */
  async encode(image: CanvasImageSource, width: number, height: number): Promise<Uint8Array> {
    const offscreen =
      typeof OffscreenCanvas !== "undefined" && typeof OffscreenCanvas.prototype.convertToBlob === "function";
    const canvas = offscreen ? new OffscreenCanvas(width, height) : document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) throw new Error("could not create export canvas");
    context.drawImage(image, 0, 0, width, height);
    const blob = offscreen
      ? await (canvas as OffscreenCanvas).convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY })
      : await this.elementBlob(canvas as HTMLCanvasElement);
    return new Uint8Array(await blob.arrayBuffer());
  }

  private elementBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed"))),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  }
}

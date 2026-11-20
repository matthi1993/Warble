import type { ImageDecoder } from "../ports/image-decoder";

export class OrientedBitmapDecoder implements ImageDecoder {
  constructor(private readonly mimeType?: string) {}

  async decode(bytes: ArrayBuffer): Promise<ImageBitmap> {
    const blob = new Blob([bytes], this.mimeType ? { type: this.mimeType } : undefined);
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // Older webviews reject the imageOrientation option.
      return await createImageBitmap(blob);
    }
  }
}

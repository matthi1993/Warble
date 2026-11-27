export interface ImageDecoder {
  decode(bytes: ArrayBuffer): Promise<ImageBitmap>;
}

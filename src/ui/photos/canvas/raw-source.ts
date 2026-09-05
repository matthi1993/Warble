/**
 * Linear RGB16 image transferred from the native RAW decoder.
 *
 * The data is interleaved RGB, little-endian, one unsigned 16-bit sample per
 * channel. It is deliberately not an ImageBitmap: browser image decoders
 * would convert it to an 8-bit display image before WebGL sees it.
 */
export interface RawImageSource {
  readonly kind: "raw16";
  readonly width: number;
  readonly height: number;
  readonly data: Uint16Array;
}


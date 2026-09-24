/// <reference lib="webworker" />
/**
 * Off-main-thread JPEG/PNG decoder.
 *
 * Receives an encoded image `ArrayBuffer` (transferred), runs
 * `createImageBitmap` on the worker thread (so the main thread stays free
 * for input handling and rendering), and posts the resulting `ImageBitmap`
 * back as a transferable.
 *
 * On macOS WebKit (Tauri's WKWebView) `createImageBitmap` does noticeable
 * synchronous work when called from the main thread for large (~24 MP)
 * JPEGs. Moving it here keeps the UI responsive during full-image load.
 */

interface DecodeRequest {
  id: number;
  buffer: ArrayBuffer;
  mime?: string;
}

interface DecodeOk {
  id: number;
  ok: true;
  bitmap: ImageBitmap;
}

interface DecodeErr {
  id: number;
  ok: false;
  error: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", async (e: MessageEvent<DecodeRequest>) => {
  const { id, buffer, mime } = e.data;
  try {
    const blob = new Blob([buffer], mime ? { type: mime } : undefined);
    let bm: ImageBitmap;
    try {
      bm = await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // Older webviews don't accept `imageOrientation`; fall back.
      bm = await createImageBitmap(blob);
    }
    const msg: DecodeOk = { id, ok: true, bitmap: bm };
    ctx.postMessage(msg, [bm]);
  } catch (err) {
    const msg: DecodeErr = { id, ok: false, error: String(err) };
    ctx.postMessage(msg);
  }
});

export {};

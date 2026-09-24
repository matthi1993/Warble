/**
 * Shared full-image decode worker + cache wiring.
 *
 * A single shared worker handles every full-image decode request so
 * the UI thread never blocks on a 24 MP JPEG parse. This module
 * registers the worker-backed decoder with both the HD and full-res
 * caches; importing it once (via `pf-image-canvas`) is all that's
 * required.
 */
import {
  setHdImageDecoder,
} from "@services/images/hd-image-cache";
import {
  setFullImageDecoder,
} from "@services/images/full-image-cache";

/**
 * `createImageBitmap` with EXIF orientation honoured. Older webviews
 * don't accept the `imageOrientation` option and throw `TypeError` —
 * fall back to the no-options form so we still get *some* bitmap.
 */
async function createOrientedBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(blob);
  }
}

/** Decode binary JPEG bytes returned by thumbnail IPC into an oriented bitmap. */
export function decodeJpegBytes(bytes: ArrayBuffer): Promise<ImageBitmap> {
  return createOrientedBitmap(new Blob([bytes], { type: "image/jpeg" }));
}

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
    new URL("../../../services/images/full-image-worker.ts", import.meta.url),
    { type: "module" }
  );
  decoderWorker.addEventListener(
    "message",
    (e: MessageEvent<WorkerResponse>) => {
      const data = e.data;
      const entry = pendingDecodes.get(data.id);
      if (!entry) return;
      pendingDecodes.delete(data.id);
      if (data.ok && data.bitmap) entry.resolve(data.bitmap);
      else entry.reject(new Error(data.error ?? "image decode failed"));
    }
  );
  decoderWorker.addEventListener("error", (e) => {
    console.error("full-image-worker error", e.message);
    const error = new Error(e.message || "image decoder worker failed");
    for (const pending of pendingDecodes.values()) pending.reject(error);
    pendingDecodes.clear();
    decoderWorker?.terminate();
    decoderWorker = null;
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

// Wire the worker-backed decoder into both image caches. The two
// caches keep independent LRU stores but share this one worker, so
// HD + full-res decodes still serialise cooperatively.
setHdImageDecoder(decodeInWorker);
setFullImageDecoder(decodeInWorker);

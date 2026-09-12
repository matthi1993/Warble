import { invoke } from "@tauri-apps/api/core";
import {
  beginTask,
  cancelTaskRequest,
  isTaskCancellation,
  nextRequestId,
} from "./task-manager";
import type { RawImageSource } from "@ui/photos/canvas/raw-source";

const MAGIC = "WRAW16\0\0";
const VERSION = 1;
const HEADER_BYTES = 24;
const HOST_IS_LITTLE_ENDIAN =
  new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

interface PendingEntry {
  promise: Promise<RawImageSource>;
  requestId: number;
  refcount: number;
}

const cache = new Map<string, RawImageSource>();
const pending = new Map<string, PendingEntry>();
const MAX_RAW_IMAGES = 1;
export interface LoadOptions {
  signal?: AbortSignal;
  /** Optional reduced working image for future thumbnail/edit previews. */
  maxLongSide?: number;
}

export function getRawImage(path: string): RawImageSource | null {
  const image = cache.get(path);
  if (!image) return null;
  cache.delete(path);
  cache.set(path, image);
  return image;
}

export function loadRawImage(
  path: string,
  options: LoadOptions = {},
): Promise<RawImageSource> {
  const signal = options.signal;
  if (signal?.aborted) {
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }

  // A reduced editing proxy and a full sensor image are different resources,
  // so keep their cache and in-flight request identities separate.
  const key = `${path}\0${options.maxLongSide ?? 0}`;
  const cached = getRawImage(key);
  if (cached) return Promise.resolve(cached);

  let entry = pending.get(key);
  if (!entry) {
    entry = startLoad(key, path, options.maxLongSide);
  } else {
    entry.refcount += 1;
  }

  const captured = entry;
  return new Promise<RawImageSource>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      releaseRef(key, captured);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    captured.promise.then(
      (image) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolve(image);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function startLoad(
  key: string,
  path: string,
  maxLongSide: number | undefined,
): PendingEntry {
  const requestId = nextRequestId();
  const task = beginTask({
    kind: "raw-image",
    label: "Opening RAW image",
    priority: "urgent",
    target: path,
  });
  const entry: PendingEntry = {
    promise: undefined as unknown as Promise<RawImageSource>,
    requestId,
    refcount: 1,
  };
  entry.promise = (async () => {
    try {
      const buffer = await invoke<ArrayBuffer>("get_raw_image_bytes", {
        photoPath: path,
        requestId,
        maxLongSide: maxLongSide ?? null,
      });
      const image = parseRawImage(buffer);
      cache.set(key, image);
      while (cache.size > MAX_RAW_IMAGES) {
        const oldest = cache.keys().next().value as string | undefined;
        if (!oldest) break;
        cache.delete(oldest);
      }
      return image;
    } catch (error) {
      task.finish(isTaskCancellation(error) ? "cancelled" : "failed");
      throw error;
    } finally {
      task.finish();
      if (pending.get(key) === entry) pending.delete(key);
    }
  })();
  pending.set(key, entry);
  return entry;
}

function releaseRef(key: string, entry: PendingEntry): void {
  entry.refcount -= 1;
  if (entry.refcount > 0) return;
  cancelTaskRequest(entry.requestId);
  if (pending.get(key) === entry) pending.delete(key);
}

function parseRawImage(buffer: ArrayBuffer): RawImageSource {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error("RAW image payload is truncated");
  }
  const bytes = new Uint8Array(buffer, 0, 8);
  const magic = String.fromCharCode(...bytes);
  if (magic !== MAGIC) throw new Error("Invalid RAW image payload");
  const header = new DataView(buffer);
  const version = header.getUint32(8, true);
  const width = header.getUint32(12, true);
  const height = header.getUint32(16, true);
  const channels = header.getUint32(20, true);
  if (version !== VERSION || channels !== 3 || width < 1 || height < 1) {
    throw new Error("Unsupported RAW image payload");
  }
  const sampleCount = width * height * channels;
  if (!Number.isSafeInteger(sampleCount) || HEADER_BYTES + sampleCount * 2 > buffer.byteLength) {
    throw new Error("RAW image payload has invalid dimensions");
  }
  // WebKit runs on little-endian Apple hardware, so this is normally a
  // zero-copy view over the IPC payload. Keep the conversion fallback for
  // correctness if the frontend is ever run on a big-endian host.
  let data: Uint16Array;
  if (HOST_IS_LITTLE_ENDIAN) {
    data = new Uint16Array(buffer, HEADER_BYTES, sampleCount);
  } else {
    data = new Uint16Array(sampleCount);
    const view = new DataView(buffer, HEADER_BYTES);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = view.getUint16(i * 2, true);
    }
  }
  return { kind: "raw16", width, height, data };
}

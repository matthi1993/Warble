import type { ImageDecoder } from "../ports/image-decoder";

interface DecodeResponse {
  id: number;
  ok: boolean;
  bitmap?: ImageBitmap;
  error?: string;
}

interface PendingDecode {
  resolve(bitmap: ImageBitmap): void;
  reject(error: unknown): void;
}

export class WorkerImageDecoder implements ImageDecoder {
  private worker: Worker | null = null;
  private lastDecodeId = 0;
  private readonly pending = new Map<number, PendingDecode>();

  decode(bytes: ArrayBuffer): Promise<ImageBitmap> {
    const id = ++this.lastDecodeId;
    return new Promise<ImageBitmap>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.activeWorker().postMessage({ id, buffer: bytes }, [bytes]);
    });
  }

  private activeWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./image-decode-worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<DecodeResponse>) => this.settle(event.data));
    worker.addEventListener("error", (event) => {
      console.error("image decode worker error", event.message);
      this.failPending(new Error(event.message || "image decoder worker failed"));
    });
    this.worker = worker;
    return worker;
  }

  private settle(response: DecodeResponse): void {
    const decode = this.pending.get(response.id);
    if (!decode) return;
    this.pending.delete(response.id);
    if (response.ok && response.bitmap) decode.resolve(response.bitmap);
    else decode.reject(new Error(response.error ?? "image decode failed"));
  }

  private failPending(error: unknown): void {
    for (const decode of this.pending.values()) decode.reject(error);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}

/// <reference lib="webworker" />
import { OrientedBitmapDecoder } from "./oriented-bitmap-decoder";

interface DecodeRequest {
  id: number;
  buffer: ArrayBuffer;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
const decoder = new OrientedBitmapDecoder();

scope.addEventListener("message", async (event: MessageEvent<DecodeRequest>) => {
  const { id, buffer } = event.data;
  try {
    const bitmap = await decoder.decode(buffer);
    scope.postMessage({ id, ok: true, bitmap }, [bitmap]);
  } catch (error) {
    scope.postMessage({ id, ok: false, error: String(error) });
  }
});

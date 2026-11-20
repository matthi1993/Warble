import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerImageDecoder } from "../src";
import { FakeBitmap } from "./support/fakes";

class FakeWorker extends EventTarget {
  static readonly spawned: FakeWorker[] = [];
  readonly decodeIds: number[] = [];
  terminated = false;

  constructor() {
    super();
    FakeWorker.spawned.push(this);
  }

  postMessage(message: { id: number }): void {
    this.decodeIds.push(message.id);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(data: unknown): void {
    this.dispatchEvent(Object.assign(new Event("message"), { data }));
  }

  fail(message: string): void {
    this.dispatchEvent(Object.assign(new Event("error"), { message }));
  }
}

describe("WorkerImageDecoder", () => {
  afterEach(() => {
    FakeWorker.spawned.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("matches worker replies to their decode and replaces a crashed worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const decoder = new WorkerImageDecoder();
    const first = decoder.decode(new ArrayBuffer(1));
    const second = decoder.decode(new ArrayBuffer(1));
    const third = decoder.decode(new ArrayBuffer(1));
    const [worker] = FakeWorker.spawned;
    const [firstId, secondId] = worker.decodeIds;

    const bitmap = new FakeBitmap();
    worker.respond({ id: secondId, ok: true, bitmap });
    worker.respond({ id: firstId, ok: false, error: "corrupt" });
    expect(await second).toBe(bitmap);
    await expect(first).rejects.toThrow("corrupt");

    worker.fail("out of memory");
    await expect(third).rejects.toThrow("out of memory");
    expect(worker.terminated).toBe(true);

    void decoder.decode(new ArrayBuffer(1));
    expect(FakeWorker.spawned.length).toBe(2);
  });
});

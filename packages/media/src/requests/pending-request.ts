import type { TaskHandle, TaskPriority } from "@warble/core";

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, background: 3 };

export class PendingRequest<T> {
  result!: Promise<T>;
  private readonly consumers = new Map<symbol, TaskPriority>();
  private readonly cancellation = new AbortController();
  private currentPriority: TaskPriority;

  constructor(
    readonly id: number,
    readonly task: TaskHandle,
    priority: TaskPriority,
  ) {
    this.currentPriority = priority;
  }

  get priority(): TaskPriority {
    return this.currentPriority;
  }

  get cancelled(): boolean {
    return this.cancellation.signal.aborted;
  }

  get hasConsumers(): boolean {
    return this.consumers.size > 0;
  }

  join(priority: TaskPriority): symbol {
    const consumer = Symbol();
    this.consumers.set(consumer, priority);
    return consumer;
  }

  setConsumerPriority(consumer: symbol, priority: TaskPriority): void {
    this.consumers.set(consumer, priority);
  }

  leave(consumer: symbol): void {
    this.consumers.delete(consumer);
  }

  adoptHighestConsumerPriority(): boolean {
    const highest = [...this.consumers.values()].sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b])[0];
    if (!highest || highest === this.currentPriority) return false;
    this.currentPriority = highest;
    return true;
  }

  cancel(): void {
    this.cancellation.abort();
  }

  whenCancelled(): Promise<never> {
    return new Promise<never>((_, reject) => {
      this.cancellation.signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  }

  resultUnlessAborted(signal: AbortSignal | undefined, onAbort: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => {
        onAbort();
        reject(new DOMException("aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.result.then(
        (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  }
}

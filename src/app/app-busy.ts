type BusyListener = (label: string | null) => void;

const operations = new Map<symbol, string>();
const listeners = new Set<BusyListener>();

function currentLabel(): string | null {
  const labels = [...operations.values()];
  return labels.length > 0 ? labels[labels.length - 1] : null;
}

function notify(): void {
  const label = currentLabel();
  for (const listener of listeners) listener(label);
}

/** Begin an app-wide blocking operation and return an idempotent cleanup. */
export function beginAppBusy(label: string): () => void {
  const token = Symbol(label);
  operations.set(token, label);
  notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    operations.delete(token);
    notify();
  };
}

export function subscribeAppBusy(listener: BusyListener): () => void {
  listeners.add(listener);
  listener(currentLabel());
  return () => listeners.delete(listener);
}

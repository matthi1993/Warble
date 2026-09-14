import type { ToolScope } from "./tool";

export interface ToolPreview {
  id: string;
  scope: ToolScope;
}

let activePreview: ToolPreview | null = null;
const listeners = new Set<(preview: ToolPreview | null) => void>();

export function getToolPreview(): ToolPreview | null {
  return activePreview;
}

export function startToolPreview(preview: ToolPreview): void {
  activePreview = preview;
  for (const listener of listeners) listener(activePreview);
}

export function endToolPreview(preview: ToolPreview): void {
  if (activePreview?.id !== preview.id || activePreview.scope !== preview.scope) return;
  activePreview = null;
  for (const listener of listeners) listener(null);
}

export function subscribeToolPreview(
  listener: (preview: ToolPreview | null) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

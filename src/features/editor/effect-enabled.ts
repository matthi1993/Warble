import type { ToolScope } from "./tool";

const STORAGE_KEY = "warble.disabledEffects.v1";
type DisabledEffects = { post: string[]; photo: Record<string, string[]> };

function load(): DisabledEffects {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<DisabledEffects> | null;
    return {
      post: Array.isArray(value?.post) ? value.post : [],
      photo: value?.photo && typeof value.photo === "object" ? value.photo : {},
    };
  } catch {
    return { post: [], photo: {} };
  }
}

const disabled = load();
export interface EffectEnabledChange {
  scope: ToolScope;
  path: string | null;
  id: string;
}
const listeners = new Set<(change: EffectEnabledChange) => void>();

export function isEffectEnabled(scope: ToolScope, path: string | null, id: string): boolean {
  return !(scope === "post" ? disabled.post : path ? disabled.photo[path] ?? [] : []).includes(id);
}

export function setEffectEnabled(scope: ToolScope, path: string | null, id: string, enabled: boolean): void {
  if (scope === "photo" && !path) return;
  const current = scope === "post" ? disabled.post : disabled.photo[path!] ?? [];
  const next = enabled ? current.filter((key) => key !== id) : [...new Set([...current, id])];
  if (scope === "post") disabled.post = next;
  else if (next.length) disabled.photo[path!] = next;
  else delete disabled.photo[path!];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(disabled));
  } catch (error) {
    console.warn("Could not persist disabled effects", error);
  }
  for (const listener of listeners) listener({ scope, path, id });
}

export function subscribeEffectEnabled(listener: (change: EffectEnabledChange) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

import { Emitter, type Unsubscribe } from "@warble/core";
import type { LayerId } from "@warble/render";
import type { KeyValueStorage } from "../ports/key-value-storage";

const STORAGE_KEY = "warble.disabledEffects.v1";

interface DisabledEffects {
  post: string[];
  photo: Record<string, string[]>;
}

export interface EffectEnabledChange {
  readonly scope: LayerId;
  readonly path: string | null;
  readonly id: string;
}

/** Remembers which effects are switched off: per photo for the photo layer, globally for Post. */
export class EffectToggleStore {
  private readonly changes = new Emitter<EffectEnabledChange>();
  private readonly disabled: DisabledEffects;

  constructor(private readonly storage: KeyValueStorage | null) {
    this.disabled = this.load();
  }

  isEnabled(scope: LayerId, path: string | null, id: string): boolean {
    return !this.disabledIds(scope, path).includes(id);
  }

  setEnabled(scope: LayerId, path: string | null, id: string, enabled: boolean): void {
    if (scope === "photo" && !path) return;
    const current = this.disabledIds(scope, path);
    const next = enabled ? current.filter((disabledId) => disabledId !== id) : [...new Set([...current, id])];
    if (scope === "post") this.disabled.post = next;
    else if (next.length) this.disabled.photo[path!] = next;
    else delete this.disabled.photo[path!];
    this.save();
    this.changes.emit({ scope, path, id });
  }

  toggle(scope: LayerId, path: string | null, id: string): void {
    this.setEnabled(scope, path, id, !this.isEnabled(scope, path, id));
  }

  subscribe(listener: (change: EffectEnabledChange) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  private disabledIds(scope: LayerId, path: string | null): string[] {
    if (scope === "post") return this.disabled.post;
    return path ? this.disabled.photo[path] ?? [] : [];
  }

  private load(): DisabledEffects {
    try {
      const stored = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? "null") as Partial<DisabledEffects> | null;
      return {
        post: Array.isArray(stored?.post) ? stored.post : [],
        photo: stored?.photo && typeof stored.photo === "object" ? stored.photo : {},
      };
    } catch {
      return { post: [], photo: {} };
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.disabled));
    } catch (error) {
      console.warn("Could not persist disabled effects", error);
    }
  }
}

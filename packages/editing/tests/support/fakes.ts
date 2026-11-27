import {
  EditingContext,
  type EditRepository,
  type KeyValueStorage,
  type PersistedPhotoEdit,
  type ToolHost,
} from "../../src";

export class FakeEditRepository implements EditRepository {
  readonly rows = new Map<string, PersistedPhotoEdit>();
  effectsJson: string | null = null;
  presetsJson: string | null = null;

  async getPhotoEdits(): Promise<PersistedPhotoEdit[]> {
    return [...this.rows.values()];
  }

  async setPhotoEdit(edit: PersistedPhotoEdit): Promise<void> {
    this.rows.set(edit.path, structuredClone(edit));
  }

  async clearPhotoEdit(path: string): Promise<void> {
    this.rows.delete(path);
  }

  async getPhotoEffects(): Promise<string | null> {
    return this.effectsJson;
  }

  async setPhotoEffects(effectsJson: string): Promise<void> {
    this.effectsJson = effectsJson;
  }

  async getPostProcessPresets(): Promise<string | null> {
    return this.presetsJson;
  }

  async setPostProcessPresets(presetsJson: string): Promise<void> {
    this.presetsJson = presetsJson;
  }
}

export class MemoryStorage implements KeyValueStorage {
  private readonly items = new Map<string, string>();

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) this.items.set(key, JSON.stringify(value));
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  read<T>(key: string): T {
    return JSON.parse(this.items.get(key) ?? "null") as T;
  }
}

/** Lets pending promise chains run without touching timers, which a test may have faked. */
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

export function createEditing() {
  const repository = new FakeEditRepository();
  const storage = new MemoryStorage();
  return { repository, storage, context: EditingContext.create(repository, storage) };
}

export interface FakeHost extends ToolHost {
  editTarget: string | null;
  frame: { x: number; y: number; width: number; height: number } | null;
  updates: number;
  flushes: number;
  activeTool: string | null | undefined;
}

export function fakeHost(editTarget: string | null): FakeHost {
  const host: FakeHost = {
    editTarget,
    frame: null,
    updates: 0,
    flushes: 0,
    activeTool: undefined,
    canvas: { getCropFrame: () => host.frame },
    requestUpdate: () => {
      host.updates += 1;
    },
    revealEditPanel: () => {},
    flushActiveEdit: () => {
      host.flushes += 1;
    },
    setActiveTool: (toolId) => {
      host.activeTool = toolId;
    },
  };
  return host;
}

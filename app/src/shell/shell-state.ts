import { ShellFields } from "./shell-fields";

export interface UpdateHost {
  requestUpdate(): void;
}

export type ShellFieldName = keyof ShellFields;

/** Field name to the value it had before the first change since the last render. */
export type ShellChanges = ReadonlyMap<ShellFieldName, unknown>;

export class ShellState extends ShellFields {
  private pendingChanges = new Map<ShellFieldName, unknown>();

  constructor(private readonly host: UpdateHost) {
    super();
    // The first render reports every field as changed, like Lit does for initial property values.
    for (const name of Object.keys(new ShellFields()) as ShellFieldName[]) {
      this.pendingChanges.set(name, undefined);
    }
  }

  get showsLibraryPhotos(): boolean {
    return this.mode === "allPhotos" || this.mode === "favorites" || this.mode === "days";
  }

  get hasSelection(): boolean {
    return this.selectedFolderId !== null || this.mode !== "folders";
  }

  change(patch: Partial<ShellFields>): void {
    let changed = false;
    for (const name of Object.keys(patch) as ShellFieldName[]) {
      if (Object.is(this[name], patch[name])) continue;
      if (!this.pendingChanges.has(name)) this.pendingChanges.set(name, this[name]);
      changed = true;
    }
    if (!changed) return;
    Object.assign(this, patch);
    this.host.requestUpdate();
  }

  /** Re-renders for data that lives outside this state, such as ratings or the date tree. */
  refresh(): void {
    this.host.requestUpdate();
  }

  takeChanges(): ShellChanges {
    const changes = this.pendingChanges;
    this.pendingChanges = new Map();
    return changes;
  }
}

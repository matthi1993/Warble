/** Copied edits by tool id; each entry is what that tool's `serializeEdit` returned. */
export type EditSnapshot = Readonly<Record<string, unknown>>;

export class EditClipboard {
  private snapshot: EditSnapshot | null = null;

  get content(): EditSnapshot | null {
    return this.snapshot;
  }

  store(snapshot: EditSnapshot): void {
    this.snapshot = snapshot;
  }
}

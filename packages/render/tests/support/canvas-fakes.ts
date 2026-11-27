export interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** A 2D context that records method calls and remembers assigned properties. */
export class RecordingContext {
  readonly calls: RecordedCall[] = [];
  readonly context: CanvasRenderingContext2D;

  constructor() {
    const properties: Record<string, unknown> = {};
    this.context = new Proxy(properties, {
      get: (target, name: string) =>
        name in target
          ? target[name]
          : (...args: unknown[]) => {
              this.calls.push({ name, args });
            },
      set: (target, name: string, value) => {
        target[name] = value;
        this.calls.push({ name: `set ${name}`, args: [value] });
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  }

  argsOf(name: string): (readonly unknown[])[] {
    return this.calls.filter((call) => call.name === name).map((call) => call.args);
  }

  names(): string[] {
    return this.calls.map((call) => call.name);
  }
}

export class FakeCanvas {
  readonly recording = new RecordingContext();
  contextAvailable = true;

  constructor(
    public width = 0,
    public height = 0,
  ) {}

  getContext(): CanvasRenderingContext2D | null {
    return this.contextAvailable ? this.recording.context : null;
  }
}

export function fakeImage(width: number, height: number): ImageBitmap {
  return { width, height, close() {} } as unknown as ImageBitmap;
}

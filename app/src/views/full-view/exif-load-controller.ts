import type { TaskTracker } from "@warble/core";
import type { ExifMetadata, ExifReader } from "@warble/library";
import type { ImageRequests } from "@warble/media";
import type { UpdateHost } from "./update-host";

export interface ExifLoadServices {
  readonly exif: Pick<ExifReader, "read">;
  readonly requests: Pick<ImageRequests, "nextRequestId" | "cancelRequest">;
  readonly tasks: Pick<TaskTracker, "begin">;
}

export class ExifLoadController {
  private currentPath: string | null = null;
  private currentAbort: AbortController | null = null;
  private generation = 0;
  private metadata: ExifMetadata | null = null;

  constructor(
    private readonly host: UpdateHost,
    private readonly services: ExifLoadServices,
  ) {}

  /** `null` while loading, `{}` when the file has no readable metadata. */
  get exif(): ExifMetadata | null {
    return this.metadata;
  }

  syncToPath(path: string | null): void {
    if (path === this.currentPath) return;
    this.currentAbort?.abort();
    this.currentAbort = null;
    this.currentPath = path;
    this.metadata = null;
    const generation = ++this.generation;
    this.host.requestUpdate();
    if (path !== null) this.load(path, generation);
  }

  private load(path: string, generation: number): void {
    const abort = new AbortController();
    this.currentAbort = abort;
    const requestId = this.services.requests.nextRequestId();
    const task = this.services.tasks.begin({
      kind: "exif",
      label: "Reading EXIF data",
      priority: "urgent",
      target: path,
    });
    const onAbort = () => {
      this.services.requests.cancelRequest(requestId);
      task.finish("cancelled");
    };
    abort.signal.addEventListener("abort", onAbort, { once: true });
    const superseded = () => abort.signal.aborted || generation !== this.generation;
    void this.services.exif
      .read(path, requestId)
      .then((metadata) => {
        if (superseded()) return;
        this.metadata = metadata;
        this.host.requestUpdate();
      })
      .catch((error) => {
        if (superseded()) return;
        task.finish("failed");
        console.warn("Failed to read EXIF metadata", error);
        this.metadata = {};
        this.host.requestUpdate();
      })
      .finally(() => {
        abort.signal.removeEventListener("abort", onAbort);
        if (this.currentAbort === abort) this.currentAbort = null;
        task.finish();
      });
  }
}

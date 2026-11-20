import type { EditingContext, EditTool, ToolHost, ToolRegistry } from "@warble/editing";

export interface PostPanelHost {
  requestUpdate(): void;
}

/** The Post panel edits the global settings with the same tools as a photo, without a photo or a canvas. */
export class PostPanelController {
  readonly tools: EditTool[];
  readonly toolHost: ToolHost;

  private stopListening: Array<() => void> = [];

  constructor(
    private readonly host: PostPanelHost,
    private readonly editing: EditingContext,
    toolRegistry: ToolRegistry,
  ) {
    this.tools = toolRegistry.createTools("post", editing);
    this.toolHost = {
      editTarget: null,
      canvas: null,
      requestUpdate: () => host.requestUpdate(),
      revealEditPanel: () => undefined,
      flushActiveEdit: () => undefined,
      setActiveTool: () => undefined,
    };
  }

  get enabled(): boolean {
    return this.editing.post.enabled;
  }

  toggleEnabled(): void {
    this.editing.post.setEnabled(!this.enabled);
  }

  connect(): void {
    const update = () => this.host.requestUpdate();
    this.stopListening = [this.editing.post.subscribe(update), this.editing.toggles.subscribe(update)];
  }

  disconnect(): void {
    for (const stop of this.stopListening) stop();
    this.stopListening = [];
  }
}

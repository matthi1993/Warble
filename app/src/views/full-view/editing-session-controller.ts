import type { Unsubscribe } from "@warble/core";
import {
  ALL_EDITS_TOGGLE,
  type EditingContext,
  type EditorCanvas,
  type EditTool,
  type ToolCanvasOverrides,
  type ToolHost,
  type ToolKeyEvent,
  type ToolRegistry,
} from "@warble/editing";
import type { EditClipboard } from "./edit-clipboard";
import type { StageModel } from "./stage-model";
import type { UpdateHost } from "./update-host";

export interface EditingSessionServices {
  readonly editing: EditingContext;
  readonly tools: Pick<ToolRegistry, "createTools">;
  readonly clipboard: EditClipboard;
}

export interface EditingSessionView extends UpdateHost {
  canvas(): EditorCanvas | null;
  revealEditPanel(): void;
}

export class EditingSessionController {
  readonly tools: EditTool[];
  readonly toolHost: ToolHost;
  private activeToolId: string | null = null;
  private subscriptions: Unsubscribe[] = [];

  constructor(
    private readonly view: EditingSessionView,
    private readonly stage: Pick<StageModel, "editTarget">,
    private readonly services: EditingSessionServices,
  ) {
    this.tools = services.tools.createTools("photo", services.editing);
    this.toolHost = {
      get editTarget(): string | null {
        return stage.editTarget;
      },
      get canvas(): EditorCanvas | null {
        return view.canvas();
      },
      requestUpdate: () => view.requestUpdate(),
      revealEditPanel: () => view.revealEditPanel(),
      flushActiveEdit: () => this.flushTarget(),
      setActiveTool: (toolId) => this.setActiveTool(toolId),
    };
  }

  connect(): void {
    const { photoEdits, post, toggles } = this.services.editing;
    this.subscriptions = [
      photoEdits.subscribe((change) => {
        const concernsTarget = change.path === null || change.path === this.stage.editTarget;
        if (change.payload === "edits" && concernsTarget) this.view.requestUpdate();
      }),
      post.subscribe(() => this.view.requestUpdate()),
      toggles.subscribe(() => this.view.requestUpdate()),
    ];
  }

  disconnect(): void {
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
  }

  get editsEnabled(): boolean {
    return this.services.editing.toggles.isEnabled("photo", this.stage.editTarget, ALL_EDITS_TOGGLE);
  }

  get postProcessEnabled(): boolean {
    return this.services.editing.post.enabled;
  }

  toggleEditsEnabled(): void {
    this.services.editing.toggles.toggle("photo", this.stage.editTarget, ALL_EDITS_TOGGLE);
  }

  togglePostProcess(): void {
    const { post } = this.services.editing;
    post.setEnabled(!post.enabled);
  }

  activeTool(): EditTool | null {
    return this.tool(this.activeToolId);
  }

  toggleTool(tool: EditTool): void {
    this.view.revealEditPanel();
    if (this.activeToolId === tool.id) {
      tool.deactivate(this.toolHost);
      this.setActiveTool(null);
    } else {
      this.activeTool()?.deactivate(this.toolHost);
      tool.activate(this.toolHost);
      this.setActiveTool(tool.id);
    }
  }

  toggleToolById(id: string): void {
    const tool = this.tool(id);
    if (tool) this.toggleTool(tool);
  }

  toggleCard(toolId: string): void {
    this.view.revealEditPanel();
    const tool = this.tool(toolId);
    if (tool) tool.cardOpen = !tool.cardOpen;
    this.view.requestUpdate();
  }

  deactivateActiveTool(): void {
    this.activeTool()?.deactivate(this.toolHost);
    this.setActiveTool(null);
  }

  /** Returns `true` when the tool that owns the canvas consumed the key. */
  handleToolKey(event: ToolKeyEvent): boolean {
    if (!this.activeTool()?.handleKey(event, this.toolHost)) return false;
    this.view.requestUpdate();
    return true;
  }

  syncFromStore(): void {
    const target = this.stage.editTarget;
    for (const tool of this.tools) tool.syncFromStore(target);
  }

  async flushTarget(): Promise<void> {
    const target = this.stage.editTarget;
    if (target) await this.services.editing.photoEdits.flush(target);
  }

  canvasOverrides(): ToolCanvasOverrides {
    return this.activeTool()?.applyToCanvas() ?? {};
  }

  canvasCropChanged(): void {
    this.activeTool()?.onCanvasCropChange(this.toolHost);
  }

  canvasOrientationFlipped(): void {
    this.activeTool()?.onCanvasOrientationFlip(this.toolHost);
  }

  canvasHorizonDrawn(delta: number): void {
    if (Number.isFinite(delta)) this.activeTool()?.onCanvasHorizonLine(this.toolHost, delta);
  }

  /** Returns `false` when there is no image to copy from. */
  copyEdits(): boolean {
    const target = this.stage.editTarget;
    if (!target) return false;
    const snapshot: Record<string, unknown> = {};
    for (const tool of this.tools) {
      const data = tool.serializeEdit(target);
      if (data !== null) snapshot[tool.id] = data;
    }
    this.services.clipboard.store(snapshot);
    return true;
  }

  /** Returns `false` when nothing was copied or there is no image to paste onto. */
  pasteEdits(): boolean {
    const snapshot = this.services.clipboard.content;
    if (!snapshot || !this.stage.editTarget) return false;
    for (const tool of this.tools) {
      if (tool.id in snapshot) void tool.applyEdit(this.toolHost, snapshot[tool.id]);
    }
    this.view.requestUpdate();
    return true;
  }

  async resetAll(): Promise<void> {
    await Promise.all(this.tools.map((tool) => tool.reset(this.toolHost)));
  }

  hasAnyEdit(): boolean {
    const target = this.stage.editTarget;
    return target !== null && this.tools.some((tool) => tool.hasEdits(target));
  }

  private tool(id: string | null): EditTool | null {
    return this.tools.find((tool) => tool.id === id) ?? null;
  }

  private setActiveTool(toolId: string | null): void {
    if (this.activeToolId === toolId) return;
    this.activeToolId = toolId;
    this.view.requestUpdate();
  }
}

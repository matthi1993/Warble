import type { EditTool, ToolHost } from "@warble/editing";
import type { TemplateResult } from "lit";

export type ToolCardRenderer<T extends EditTool = EditTool> = (tool: T, host: ToolHost) => TemplateResult;

/** Maps a tool id to the function that draws the tool's card. Open: any area may register more cards. */
export class ToolCardRegistry {
  private readonly renderers = new Map<string, ToolCardRenderer>();

  register<T extends EditTool>(toolId: T["id"], renderer: ToolCardRenderer<T>): this {
    if (this.renderers.has(toolId)) throw new Error(`A card for tool "${toolId}" is already registered`);
    this.renderers.set(toolId, renderer as ToolCardRenderer);
    return this;
  }

  has(toolId: string): boolean {
    return this.renderers.has(toolId);
  }

  render(tool: EditTool, host: ToolHost): TemplateResult {
    const renderer = this.renderers.get(tool.id);
    if (!renderer) throw new Error(`No card is registered for tool "${tool.id}"`);
    return renderer(tool, host);
  }
}

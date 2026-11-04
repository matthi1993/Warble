import type { ToolShaderModule } from "./shader-types";
import { EDITOR_TOOLS } from "../registry";

export const TOOL_SHADER_MODULES: readonly ToolShaderModule[] =
  EDITOR_TOOLS.flatMap((tool) => tool.shader ? [tool.shader] : []);

export function composeToolDeclarations(): string {
  return TOOL_SHADER_MODULES.map((module) => module.declarations).join("\n");
}

export function composeToolFunctions(): string {
  return TOOL_SHADER_MODULES.map((module) => module.functions).join("\n");
}

export function composeToolStage(stage: "source" | "photo" | "post"): string {
  return TOOL_SHADER_MODULES
    .map((module) => module[`${stage}Apply`] ?? "")
    .join("\n");
}

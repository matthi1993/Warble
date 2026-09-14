import { ColorTool, readColorToolValue } from "./tools/color/color.logic";
import { CropTool } from "./tools/crop/crop.logic";
import { CurveTool, readCurveToolValue } from "./tools/curve/curve.logic";
import { GrainTool, readGrainToolValue } from "./tools/grain/grain.logic";
import { BloomTool, readBloomToolValue } from "./tools/bloom/bloom.logic";
import { SharpenTool, readSharpenToolValue } from "./tools/sharpen/sharpen.logic";
import { ToneTool, readToneToolValue } from "./tools/tone/tone.logic";
import type { ToolShaderModule } from "./rendering/shader-types";
import type { EditTool, ToolScope } from "./tool";
import { colorShader } from "./tools/color/color.shader";
import { curveShader } from "./tools/curve/curve.shader";
import { grainShader } from "./tools/grain/grain.shader";
import { sharpenShader } from "./tools/sharpen/sharpen.shader";
import { toneShader } from "./tools/tone/tone.shader";
import { bloomShader } from "./tools/bloom/bloom.shader";

export interface EditorToolRegistration {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly scopes: readonly ToolScope[];
  readonly shader?: ToolShaderModule;
  readValue?(scope: ToolScope, path: string | null): unknown;
  create(scope: ToolScope): EditTool;
}

/** The only list that decides which tools exist and where they appear. */
export const EDITOR_TOOLS: readonly EditorToolRegistration[] = [
  {
    id: "crop",
    title: "Crop",
    order: 10,
    scopes: ["photo"],
    create: () => new CropTool(),
  },
  {
    id: "tone",
    title: "Tone",
    order: 20,
    scopes: ["photo", "post"],
    shader: toneShader,
    readValue: readToneToolValue,
    create: (scope) => new ToneTool(scope),
  },
  {
    id: "color",
    title: "Color",
    order: 30,
    scopes: ["photo", "post"],
    shader: colorShader,
    readValue: readColorToolValue,
    create: (scope) => new ColorTool(scope),
  },
  {
    id: "curve",
    title: "Curve",
    order: 40,
    scopes: ["photo", "post"],
    shader: curveShader,
    readValue: readCurveToolValue,
    create: (scope) => new CurveTool(scope),
  },
  {
    id: "sharpen",
    title: "Sharpen",
    order: 50,
    scopes: ["photo", "post"],
    shader: sharpenShader,
    readValue: readSharpenToolValue,
    create: (scope) => new SharpenTool(scope),
  },
  {
    id: "bloom",
    title: "Bloom",
    order: 15,
    scopes: ["post"],
    shader: bloomShader,
    readValue: () => readBloomToolValue(),
    create: () => new BloomTool("post"),
  },
  {
    id: "grain",
    title: "Grain",
    order: 60,
    scopes: ["photo", "post"],
    shader: grainShader,
    readValue: readGrainToolValue,
    create: (scope) => new GrainTool(scope),
  },
];

export function createEditorTools(scope: ToolScope): EditTool[] {
  return EDITOR_TOOLS
    .filter((tool) => tool.scopes.includes(scope))
    .sort((a, b) => a.order - b.order)
    .map((tool) => tool.create(scope));
}

export function toolShaders(): readonly ToolShaderModule[] {
  return EDITOR_TOOLS.flatMap((tool) => tool.shader ? [tool.shader] : []);
}

export function readEditorToolValues(
  scope: ToolScope,
  path: string | null,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    EDITOR_TOOLS
      .filter((tool) => tool.shader && tool.scopes.includes(scope) && tool.readValue)
      .map((tool) => [tool.id, tool.readValue!(scope, path)]),
  );
}

export function hasActiveEditorToolValues(
  values: Readonly<Record<string, unknown>>,
): boolean {
  return EDITOR_TOOLS.some(
    (tool) => tool.shader?.isActive(values[tool.id]) === true,
  );
}

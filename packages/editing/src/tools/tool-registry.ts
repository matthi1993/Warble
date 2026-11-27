import type { EditingContext } from "../editing-context";
import { AnalogTool } from "./analog-tool";
import { BloomTool } from "./bloom-tool";
import { ClarityTool } from "./clarity-tool";
import { ColorTool } from "./color-tool";
import { CropTool } from "./crop-tool";
import { CurveTool } from "./curve-tool";
import type { EditTool } from "./edit-tool";
import { GrainTool } from "./grain-tool";
import { SharpenTool } from "./sharpen-tool";
import { ToneTool } from "./tone-tool";
import type { ToolScope } from "./tool-host";

export interface ToolRegistration {
  readonly id: string;
  readonly title: string;
  /** Position in the panel; lower comes first. */
  readonly order: number;
  readonly scopes: readonly ToolScope[];
  create(scope: ToolScope, context: EditingContext): EditTool;
}

/** Decides which tools exist, where they appear and in which order. */
export class ToolRegistry {
  private readonly registered = new Map<string, ToolRegistration>();

  static standard(): ToolRegistry {
    const photoAndPost: readonly ToolScope[] = ["photo", "post"];
    return new ToolRegistry()
      .register({
        id: "crop",
        title: "Crop",
        order: 10,
        scopes: ["photo"],
        create: (scope, context) => new CropTool(scope, context),
      })
      .register({
        id: "bloom",
        title: "Bloom",
        order: 15,
        scopes: ["post"],
        create: (scope, context) => new BloomTool(scope, context),
      })
      .register({
        id: "tone",
        title: "Tone",
        order: 20,
        scopes: photoAndPost,
        create: (scope, context) => new ToneTool(scope, context),
      })
      .register({
        id: "clarity",
        title: "Clarity / Structure",
        order: 25,
        scopes: photoAndPost,
        create: (scope, context) => new ClarityTool(scope, context),
      })
      .register({
        id: "color",
        title: "Color",
        order: 30,
        scopes: photoAndPost,
        create: (scope, context) => new ColorTool(scope, context),
      })
      .register({
        id: "curve",
        title: "Curve",
        order: 40,
        scopes: photoAndPost,
        create: (scope, context) => new CurveTool(scope, context),
      })
      .register({
        id: "sharpen",
        title: "Sharpen",
        order: 50,
        scopes: photoAndPost,
        create: (scope, context) => new SharpenTool(scope, context),
      })
      .register({
        id: "grain",
        title: "Grain",
        order: 60,
        scopes: photoAndPost,
        create: (scope, context) => new GrainTool(scope, context),
      })
      .register({
        id: "analog",
        title: "Analog Effects",
        order: 70,
        scopes: photoAndPost,
        create: (scope, context) => new AnalogTool(scope, context),
      });
  }

  register(registration: ToolRegistration): this {
    if (this.registered.has(registration.id)) {
      throw new Error(`Tool "${registration.id}" is already registered`);
    }
    this.registered.set(registration.id, registration);
    return this;
  }

  get(id: string): ToolRegistration | undefined {
    return this.registered.get(id);
  }

  /** Tools with the same order keep their registration order. */
  get registrations(): ToolRegistration[] {
    return [...this.registered.values()].sort((first, second) => first.order - second.order);
  }

  forScope(scope: ToolScope): ToolRegistration[] {
    return this.registrations.filter((registration) => registration.scopes.includes(scope));
  }

  createTools(scope: ToolScope, context: EditingContext): EditTool[] {
    return this.forScope(scope).map((registration) => registration.create(scope, context));
  }
}

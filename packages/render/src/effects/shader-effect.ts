import { Effect, type EffectLayers } from "./effect";

/** GLSL fragments that the adjustment stage composes into one program. */
export interface EffectShader {
  readonly declarations: string;
  readonly functions: string;
  readonly sourceApply?: string;
  readonly photoApply: string;
  readonly postApply: string;
}

export interface EffectUniforms {
  readonly sourceScaleX: number;
  readonly sourceScaleY: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  set1f(name: string, value: number): void;
  set1i(name: string, value: number): void;
  set2f(name: string, x: number, y: number): void;
  set3f(name: string, x: number, y: number, z: number): void;
  set3fv(name: string, value: Float32Array): void;
}

export interface EffectTexture {
  readonly handle: WebGLTexture | null;
  dispose(): void;
}

/** Keyed by the sampler uniform each texture is bound to. */
export type EffectTextures = Readonly<Record<string, EffectTexture>>;

export abstract class ShaderEffect<S, T extends EffectTextures = EffectTextures> extends Effect<S> {
  abstract readonly shader: EffectShader;

  abstract bind(uniforms: EffectUniforms, layers: EffectLayers<S>, textures: T): void;

  createTextures(_gl: WebGL2RenderingContext): T {
    return {} as T;
  }
}

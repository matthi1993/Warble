/** A shader fragment owned by one editor tool and composed into one program. */
export interface ToolShaderModule {
  readonly id: string;
  readonly declarations: string;
  readonly functions: string;
  readonly photoApply: string;
  readonly postApply: string;
  isActive(value: unknown): boolean;
  bind(
    context: ToolShaderBindingContext,
    photoValue: unknown,
    postValue: unknown,
  ): void;
}

export interface EditorRenderValues {
  readonly photo: Readonly<Record<string, unknown>>;
  readonly post: Readonly<Record<string, unknown>>;
}

export interface ToolShaderBindingContext {
  readonly sourceScaleX: number;
  readonly sourceScaleY: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  set1f(name: string, value: number): void;
  set1i(name: string, value: number): void;
  set2f(name: string, x: number, y: number): void;
  set3f(name: string, x: number, y: number, z: number): void;
  set3fv(name: string, value: Float32Array): void;
  bindCurve(scope: "photo" | "post", value: unknown): void;
}

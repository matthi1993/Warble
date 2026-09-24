import type { PhotoEdit } from "@domain/edits";
import type { CropEdit, ToneEdit, ColorEdit, CurveEdit } from "@domain/edits";
import type { SharpenSettings, GrainSettings, BloomSettings } from "@domain/edits";
import type { PostProcessSettings } from "@services/post-process/post-process-store";
import type { ToolScope } from "./tool";

export interface EditorState {
  getPhotoEdit(path: string): PhotoEdit | null;
  setPhotoCrop(path: string, value: CropEdit | null): void;
  setPhotoTone(path: string, value: ToneEdit | null): void;
  setPhotoColor(path: string, value: ColorEdit | null): void;
  setPhotoCurve(path: string, value: CurveEdit | null): void;
  flushPhotoEdit(path: string): Promise<void>;
  getPhotoSharpen(path: string | null): SharpenSettings | null;
  setPhotoSharpen(path: string, value: SharpenSettings | null): void;
  getPhotoGrain(path: string | null): GrainSettings | null;
  setPhotoGrain(path: string, value: GrainSettings | null): void;
  getPostProcess(): PostProcessSettings;
  setPostTone(value: ToneEdit): void;
  resetPostTone(): void;
  setPostColor(value: ColorEdit): void;
  resetPostColor(): void;
  setPostCurve(value: CurveEdit): void;
  resetPostCurve(): void;
  setPostSharpen(value: SharpenSettings): void;
  resetPostSharpen(): void;
  setPostGrain(value: GrainSettings): void;
  resetPostGrain(): void;
  setPostBloom(value: BloomSettings): void;
  resetPostBloom(): void;
  isEffectEnabled(scope: ToolScope, path: string | null, id: string): boolean;
  setEffectEnabled(scope: ToolScope, path: string | null, id: string, enabled: boolean): void;
}

import type { ColorEdit, CurveEdit, ToneEdit } from "@warble/render";
import type { CropEdit } from "../crop/crop-edit";

export interface PhotoEdit {
  crop: CropEdit | null;
  tone: ToneEdit | null;
  curve: CurveEdit | null;
  color: ColorEdit | null;
}

/** `path` is `null` when any photo may have changed, for example after a reload. */
export interface PhotoEditChange {
  readonly path: string | null;
  /** Which of the two saved payloads changed: the crop/tone/curve/color row or the effects document. */
  readonly payload: "edits" | "effects";
}

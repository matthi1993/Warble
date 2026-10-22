import type { EditorState } from "@features/editor/editor-state";
import {
  flushPhotoEdit, getPhotoEdit, setPhotoColor, setPhotoCrop,
  setPhotoCurve, setPhotoTone,
} from "@services/edits/edits-store";
import {
  getPhotoAnalog, setPhotoAnalog, getPhotoClarity, getPhotoGrain, getPhotoSharpen, setPhotoClarity, setPhotoGrain, setPhotoSharpen,
} from "@services/effects/effects-store";
import {
  setPostAnalog, resetPostAnalog, getPostProcess, resetPostClarity, setPostClarity, resetPostBloom, resetPostColor, resetPostCurve,
  resetPostGrain, resetPostSharpen, resetPostTone, setPostBloom,
  setPostColor, setPostCurve, setPostGrain, setPostSharpen, setPostTone,
} from "@services/post-process/post-process-store";
import { isEffectEnabled, setEffectEnabled } from "@services/effects/effect-enabled-store";

export const editorStateAdapter: EditorState = {
  flushPhotoEdit, getPhotoEdit, setPhotoColor, setPhotoCrop,
  setPhotoCurve, setPhotoTone, getPhotoAnalog, setPhotoAnalog, getPhotoClarity, setPhotoClarity, getPhotoGrain, getPhotoSharpen,
  setPhotoGrain, setPhotoSharpen, getPostProcess,
  setPostAnalog, resetPostAnalog, resetPostClarity, setPostClarity, resetPostBloom, resetPostColor, resetPostCurve, resetPostGrain,
  resetPostSharpen, resetPostTone, setPostBloom, setPostColor,
  setPostCurve, setPostGrain, setPostSharpen, setPostTone,
  isEffectEnabled, setEffectEnabled,
};

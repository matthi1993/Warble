import type { PostProcessSettings } from "../post/post-process-settings";

/** The master switch is not a tool value, so a preset does not carry it. */
export type PostProcessPresetValues = Omit<PostProcessSettings, "enabled">;

export interface PostProcessPreset {
  id: string;
  name: string;
  values: PostProcessPresetValues;
}

export interface PresetExportFile {
  version: 1;
  postProcess: Array<Omit<PostProcessPreset, "id">>;
}

import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export const VIDEO_EXTENSIONS = ["mov", "mp4", "m4v"] as const;

export function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(`.${ext}`));
}

/** The native command checks the imported root before granting asset access. */
export async function videoSource(path: string): Promise<string> {
  const localPath = await invoke<string>("get_video_source", { photoPath: path });
  return convertFileSrc(localPath);
}

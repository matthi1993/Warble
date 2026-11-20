import type { ImageBackend } from "../ports/image-backend";

export const VIDEO_EXTENSIONS = ["mov", "mp4", "m4v"] as const;

export class VideoSources {
  static isVideo(path: string): boolean {
    return VIDEO_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(`.${extension}`));
  }

  constructor(private readonly backend: ImageBackend) {}

  sourceFor(path: string): Promise<string> {
    return this.backend.videoSource(path);
  }
}

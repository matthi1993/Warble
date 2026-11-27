import type { Photo } from "./photo";
import { RAW_EXTS } from "./variants";

export type MediaType = "image" | "raw" | "movie";

export const VIDEO_EXTENSIONS = ["mov", "mp4", "m4v"] as const;

export function photoMediaTypes(photo: Photo): Set<MediaType> {
  const extensions = [
    ...(photo.extensions ?? []),
    ...(photo.files ?? []).map((file) => file.extension),
    photo.path.split(".").pop() ?? "",
  ];
  return new Set(extensions.map(mediaTypeOfExtension));
}

export function variantCount(photo: Photo): number {
  const files = photo.files ?? [];
  if (files.length === 0) return 1;
  return Math.max(1, new Set(files.map((file) => file.variant)).size);
}

function mediaTypeOfExtension(extension: string): MediaType {
  const normalized = extension.toLowerCase();
  if (RAW_EXTS.includes(normalized)) return "raw";
  if (VIDEO_EXTENSIONS.some((videoExtension) => videoExtension === normalized)) return "movie";
  return "image";
}

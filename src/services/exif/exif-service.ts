/**
 * Tauri-IPC service for reading EXIF metadata for a single photo.
 * Backed by the Rust `get_exif_metadata` command which decodes on a
 * worker thread and caches results in-process so repeated reads are
 * cheap.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ExifMetadata } from "@domain/exif";

export async function fetchExif(photoPath: string): Promise<ExifMetadata> {
  const meta = await invoke<ExifMetadata | null>("get_exif_metadata", {
    photoPath,
  });
  return meta ?? {};
}

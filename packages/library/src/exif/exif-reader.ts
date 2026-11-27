import type { MetadataBackend } from "../ports/metadata-backend";
import type { ExifMetadata } from "./exif-metadata";

export class ExifReader {
  constructor(private readonly backend: Pick<MetadataBackend, "getExifMetadata">) {}

  async read(photoPath: string, requestId?: number): Promise<ExifMetadata> {
    return (await this.backend.getExifMetadata(photoPath, requestId)) ?? {};
  }
}

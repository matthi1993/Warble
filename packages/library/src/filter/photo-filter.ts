import type { Photo } from "../photo/photo";
import { type MediaType, photoMediaTypes } from "../photo/media-type";
import type { ColorLabel, PhotoRating } from "../rating/rating";

export interface PhotoFilterCriteria {
  minStars: number;
  labels: ReadonlySet<Exclude<ColorLabel, "">>;
  types: ReadonlySet<MediaType>;
  camera: string;
  lens: string;
  minFocalLength: number | null;
  maxFocalLength: number | null;
  /** YYYY-MM-DD, inclusive; "" for no bound. */
  startDate: string;
  /** YYYY-MM-DD, inclusive; "" for no bound. */
  endDate: string;
}

export interface PhotoRatingLookup {
  get(path: string): PhotoRating;
}

export class PhotoFilter {
  constructor(
    private readonly criteria: PhotoFilterCriteria,
    private readonly ratings: PhotoRatingLookup,
  ) {}

  static emptyCriteria(): PhotoFilterCriteria {
    return {
      minStars: 0,
      labels: new Set(),
      types: new Set(),
      camera: "",
      lens: "",
      minFocalLength: null,
      maxFocalLength: null,
      startDate: "",
      endDate: "",
    };
  }

  get active(): boolean {
    const { types, minStars, labels } = this.criteria;
    return types.size > 0 || minStars > 0 || labels.size > 0 || this.usesMetadata;
  }

  /** Returns the same array instance when no criterion is active. */
  apply(photos: Photo[], metadataLoading = false): Photo[] {
    if (!this.active) return photos;
    return photos.filter((photo) => this.matches(photo, metadataLoading));
  }

  private get usesMetadata(): boolean {
    const { camera, lens, minFocalLength, maxFocalLength, startDate, endDate } = this.criteria;
    return (
      camera !== "" ||
      lens !== "" ||
      minFocalLength !== null ||
      maxFocalLength !== null ||
      startDate !== "" ||
      endDate !== ""
    );
  }

  private matches(photo: Photo, metadataLoading: boolean): boolean {
    const { types, minStars, labels } = this.criteria;
    if (types.size > 0 && ![...photoMediaTypes(photo)].some((type) => types.has(type))) {
      return false;
    }
    const { rating, label } = this.ratings.get(photo.path);
    if (minStars > 0 && rating < minStars) return false;
    if (labels.size > 0 && (label === "" || !labels.has(label))) return false;
    // A photo whose metadata is still queued stays visible until its batch arrives,
    // so the grid does not briefly report an empty result.
    if (this.usesMetadata && metadataLoading && !photo.filterInfo) return true;
    return this.matchesMetadata(photo);
  }

  private matchesMetadata(photo: Photo): boolean {
    const { camera, lens, minFocalLength, maxFocalLength, startDate, endDate } = this.criteria;
    const info = photo.filterInfo;
    if (camera && !containsIgnoringCase(info?.camera, camera)) return false;
    if (lens && !containsIgnoringCase(info?.lens, lens)) return false;
    const focalLength = info?.focalLengthMm;
    if (minFocalLength !== null && (focalLength == null || focalLength < minFocalLength)) {
      return false;
    }
    if (maxFocalLength !== null && (focalLength == null || focalLength > maxFocalLength)) {
      return false;
    }
    const dateTaken = info?.dateTaken ?? "";
    if (startDate && dateTaken < startDate) return false;
    if (endDate && dateTaken > endDate) return false;
    return true;
  }
}

function containsIgnoringCase(value: string | null | undefined, search: string): boolean {
  return value?.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ?? false;
}

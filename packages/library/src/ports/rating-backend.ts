import type { ColorLabel } from "../rating/rating";

export interface PersistedPhotoRating {
  path: string;
  rating: number;
  label: string;
  ratedAt: number;
}

export interface RatingBackend {
  getPhotoRatings(): Promise<PersistedPhotoRating[]>;
  /** Resolves with the persisted `ratedAt` timestamp, or 0 when the row was deleted. */
  setPhotoRating(path: string, rating: number, label: ColorLabel): Promise<number>;
}

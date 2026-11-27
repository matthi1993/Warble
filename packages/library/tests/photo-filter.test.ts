import { describe, expect, it } from "vitest";
import {
  type Photo,
  type PhotoFilterCriteria,
  PhotoFilter,
  type PhotoRating,
  cameraOptions,
  getDayGroups,
  lensOptions,
} from "../src";

const photos: Photo[] = [
  {
    path: "/a/one.jpg",
    filename: "one",
    extensions: ["jpg", "raf"],
    filterInfo: { camera: "FUJIFILM X-T5", lens: "XF 23mm", focalLengthMm: 23, dateTaken: "2026-10-07" },
  },
  {
    path: "/a/two.jpg",
    filename: "two",
    filterInfo: { camera: "Canon EOS R5", lens: "RF 50mm", focalLengthMm: 50, dateTaken: "2026-10-09" },
  },
  { path: "/a/clip.mov", filename: "clip", filterInfo: { dateTaken: "2026-10-07" } },
  { path: "/a/pending.jpg", filename: "pending" },
];

const ratings = new Map<string, PhotoRating>([
  ["/a/one.jpg", { rating: 4, label: "green", ratedAt: 1 }],
  ["/a/two.jpg", { rating: 2, label: "red", ratedAt: 1 }],
]);
const ratingLookup = {
  get: (path: string): PhotoRating => ratings.get(path) ?? { rating: 0, label: "", ratedAt: 0 },
};

function filtered(criteria: Partial<PhotoFilterCriteria>, metadataLoading = false): string[] {
  const filter = new PhotoFilter({ ...PhotoFilter.emptyCriteria(), ...criteria }, ratingLookup);
  return filter.apply(photos, metadataLoading).map((photo) => photo.filename);
}

describe("PhotoFilter", () => {
  it("returns the input array untouched when no criterion is active", () => {
    const filter = new PhotoFilter(PhotoFilter.emptyCriteria(), ratingLookup);
    expect(filter.active).toBe(false);
    expect(filter.apply(photos)).toBe(photos);
  });

  it("filters by minimum stars, labels, and media types", () => {
    expect(filtered({ minStars: 3 })).toEqual(["one"]);
    expect(filtered({ labels: new Set(["red", "blue"]) })).toEqual(["two"]);
    expect(filtered({ types: new Set(["raw"]) })).toEqual(["one"]);
    expect(filtered({ types: new Set(["movie"]) })).toEqual(["clip"]);
    expect(filtered({ types: new Set(["image"]), minStars: 1 })).toEqual(["one", "two"]);
  });

  it("matches camera and lens case-insensitively and ignores surrounding spaces", () => {
    expect(filtered({ camera: " fujifilm " })).toEqual(["one"]);
    expect(filtered({ lens: "rf" })).toEqual(["two"]);
  });

  it("applies inclusive focal length and date ranges, excluding photos without the value", () => {
    expect(filtered({ minFocalLength: 23, maxFocalLength: 35 })).toEqual(["one"]);
    expect(filtered({ startDate: "2026-10-08" })).toEqual(["two"]);
    expect(filtered({ endDate: "2026-10-07" })).toEqual(["one", "clip", "pending"]);
    expect(filtered({ startDate: "2026-10-07", endDate: "2026-10-07" })).toEqual(["one", "clip"]);
  });

  it("keeps photos whose metadata is still loading, but not past star and label filters", () => {
    expect(filtered({ camera: "canon" }, true)).toEqual(["two", "pending"]);
    expect(filtered({ camera: "canon" }, false)).toEqual(["two"]);
    expect(filtered({ camera: "canon", minStars: 1 }, true)).toEqual(["two"]);
  });
});

describe("getDayGroups", () => {
  it("groups by capture day, oldest first, with undated photos last", () => {
    const groups = getDayGroups([photos[3], photos[1], photos[0], photos[2]]);
    expect(groups.map((group) => [group.date, group.photos.map((photo) => photo.filename)])).toEqual([
      ["2026-10-07", ["one", "clip"]],
      ["2026-10-09", ["two"]],
      [null, ["pending"]],
    ]);
  });
});

describe("filter options", () => {
  it("lists distinct cameras and lenses alphabetically", () => {
    const duplicate: Photo = { ...photos[0], path: "/a/three.jpg" };
    expect(cameraOptions([...photos, duplicate])).toEqual(["Canon EOS R5", "FUJIFILM X-T5"]);
    expect(lensOptions([...photos, duplicate])).toEqual(["RF 50mm", "XF 23mm"]);
  });
});

export type SlideshowTransition = "fade" | "instant";

export interface SlideshowSettings {
  durationSeconds: number;
  transition: SlideshowTransition;
}

export const SLIDESHOW_DURATIONS = [5, 10, 20, 60, 300, 3600] as const;

const STORAGE_KEY = "warble.slideshow.v1";
const DEFAULTS: SlideshowSettings = { durationSeconds: 5, transition: "fade" };

export class SlideshowSettingsStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">) {}

  load(): SlideshowSettings {
    try {
      const value = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? "null");
      const duration = value?.durationSeconds;
      return {
        durationSeconds: Number.isFinite(duration) && duration >= 1 && duration <= 86400 ? duration : 5,
        transition: value?.transition === "instant" ? "instant" : "fade",
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  save(settings: SlideshowSettings): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage can be unavailable or full; the settings then last for this session only.
    }
  }
}

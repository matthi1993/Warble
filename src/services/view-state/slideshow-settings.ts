export type SlideshowTransition = "fade" | "instant";

export interface SlideshowSettings {
  durationSeconds: number;
  transition: SlideshowTransition;
}

export const SLIDESHOW_DURATIONS = [5, 10, 20, 60, 300, 3600] as const;
const STORAGE_KEY = "warble.slideshow.v1";

export function loadSlideshowSettings(): SlideshowSettings {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      durationSeconds: Number.isFinite(value?.durationSeconds) && value.durationSeconds >= 1 && value.durationSeconds <= 86400
        ? value.durationSeconds : 5,
      transition: value?.transition === "instant" ? "instant" : "fade",
    };
  } catch {
    return { durationSeconds: 5, transition: "fade" };
  }
}

export function saveSlideshowSettings(settings: SlideshowSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Playback still works when storage is unavailable.
  }
}
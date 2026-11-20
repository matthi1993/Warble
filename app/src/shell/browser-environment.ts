export class BrowserEnvironment {
  get isIPad(): boolean {
    const userAgent = this.userAgent;
    return /iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && (navigator.maxTouchPoints ?? 0) > 1);
  }

  get isNarrowScreen(): boolean {
    return window.matchMedia("(max-width: 700px)").matches;
  }

  get revealLabel(): string {
    const userAgent = this.userAgent;
    if (/Mac|iPhone|iPad/i.test(userAgent)) return "Show in Finder";
    if (/Win/i.test(userAgent)) return "Show in Explorer";
    return "Show in File Manager";
  }

  /** Two frames, so a busy overlay is on screen before blocking native work starts. */
  waitForPaint(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  private get userAgent(): string {
    return typeof navigator === "undefined" ? "" : navigator.userAgent ?? "";
  }
}

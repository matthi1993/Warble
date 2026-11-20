export class DeviceProfile {
  constructor(private readonly device: Pick<Navigator, "userAgent" | "maxTouchPoints">) {}

  static current(): DeviceProfile {
    return new DeviceProfile(navigator);
  }

  /** iPadOS reports a Macintosh user agent; touch points tell it apart from a Mac. */
  get isIPad(): boolean {
    const userAgent = this.device.userAgent ?? "";
    return /iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && this.device.maxTouchPoints > 1);
  }
}

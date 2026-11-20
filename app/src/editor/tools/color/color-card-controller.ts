import type { ColorChannel, ColorEdit } from "@warble/render";

export type ColorAxis = "hue" | "saturation" | "luminance";

export interface ColorCardHost {
  currentValue(): ColorEdit;
  requestUpdate(): void;
  emitChange(next: ColorEdit): void;
}

/** Edits one axis (hue, saturation or luminance) at a time, per colour channel and for all colours. */
export class ColorCardController {
  axis: ColorAxis = "hue";

  constructor(private readonly host: ColorCardHost) {}

  selectAxis(axis: ColorAxis): void {
    this.axis = axis;
    this.host.requestUpdate();
  }

  channelValue(channel: ColorChannel): number {
    return this.host.currentValue().channels[channel]?.[this.axis] ?? 0;
  }

  get globalValue(): number {
    return this.host.currentValue()[this.axis];
  }

  setChannel(channel: ColorChannel, amount: number): void {
    const value = this.host.currentValue();
    const channels = { ...value.channels, [channel]: { ...value.channels[channel], [this.axis]: amount } };
    this.host.emitChange({ ...value, channels });
  }

  resetChannel(channel: ColorChannel): void {
    if (this.host.currentValue().channels[channel]?.[this.axis] !== 0) this.setChannel(channel, 0);
  }

  setGlobal(amount: number): void {
    const value = this.host.currentValue();
    if (value[this.axis] !== amount) this.host.emitChange({ ...value, [this.axis]: amount });
  }

  resetGlobal(): void {
    this.setGlobal(0);
  }

  toggleBlackAndWhite(): void {
    const value = this.host.currentValue();
    this.host.emitChange({ ...value, blackAndWhite: !value.blackAndWhite });
  }
}

import { Effect } from "../effect";
import { defaultAnalog, isAnalogZero, type AnalogSettings } from "./analog-settings";

/** Analog has no shader fragment; `AnalogStage` renders it after the adjustments. */
export class AnalogEffect extends Effect<AnalogSettings> {
  readonly id = "analog";

  defaults(): AnalogSettings {
    return defaultAnalog();
  }

  isNeutral(settings: AnalogSettings | null | undefined): boolean {
    return isAnalogZero(settings);
  }
}

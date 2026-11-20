import { ToolCardRegistry } from "./tool-card-registry";
import { renderAnalogCard } from "./tools/analog/analog-card-renderer";
import { renderBloomCard } from "./tools/bloom/bloom-card-renderer";
import { renderClarityCard } from "./tools/clarity/clarity-card-renderer";
import { renderColorCard } from "./tools/color/color-card-renderer";
import { renderCropCard } from "./tools/crop/crop-card-renderer";
import { renderCurveCard } from "./tools/curve/curve-card-renderer";
import { renderGrainCard } from "./tools/grain/grain-card-renderer";
import { renderSharpenCard } from "./tools/sharpen/sharpen-card-renderer";
import { renderToneCard } from "./tools/tone/tone-card-renderer";

/** The cards of every standard tool. A new tool adds its card with one more `register` call. */
export const toolCards = new ToolCardRegistry()
  .register("crop", renderCropCard)
  .register("bloom", renderBloomCard)
  .register("tone", renderToneCard)
  .register("clarity", renderClarityCard)
  .register("color", renderColorCard)
  .register("curve", renderCurveCard)
  .register("sharpen", renderSharpenCard)
  .register("grain", renderGrainCard)
  .register("analog", renderAnalogCard);

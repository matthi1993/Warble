import { chromeStyles } from "./chrome.styles";
import { editFooterStyles } from "./edit-footer.styles";
import { menuStyles } from "./menus.styles";
import { sidePanelStyles } from "./side-panel.styles";
import { slideshowSettingsStyles } from "./slideshow-settings.styles";
import { stageStyles } from "./stage.styles";
import { touchStyles } from "./touch.styles";

/** In cascade order: the touch overrides have to come last. */
export const fullViewStyles = [
  chromeStyles,
  menuStyles,
  stageStyles,
  slideshowSettingsStyles,
  sidePanelStyles,
  editFooterStyles,
  touchStyles,
];

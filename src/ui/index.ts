/**
 * UI side-effect entry. Registers globally-used Lit components and
 * loads the design-token CSS. Imported once from `src/app/main.ts`.
 *
 * Components only used inside a single view (e.g. cards) register
 * themselves via direct side-effect imports at their consumer.
 */
import "./styles/global.css";
import "./icons/pf-icon";
import "./controls/pf-button";
import "./controls/pf-icon-button";
import "./controls/pf-slider";
import "./controls/pf-theme-toggle";
import "./folders/pf-folder-tree-item";

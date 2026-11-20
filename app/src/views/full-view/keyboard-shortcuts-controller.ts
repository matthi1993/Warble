import { RATING_LABEL_KEYS, type RatingStore } from "@warble/library";
import type { EditingSessionController } from "./editing-session-controller";
import type { PhotoNavigationController } from "./photo-navigation-controller";
import type { SidePanelController } from "./side-panel-controller";
import type { StageModel } from "./stage-model";
import type { VariantActionsController } from "./variant-actions-controller";

interface Shortcut {
  readonly keys: readonly string[];
  readonly editModeOnly?: boolean;
  run(): void;
}

export interface ShortcutTargets {
  readonly stage: StageModel;
  readonly editing: EditingSessionController;
  readonly navigation: PhotoNavigationController;
  readonly panel: SidePanelController;
  readonly variants: Pick<VariantActionsController, "deletePhoto">;
  readonly ratings: Pick<RatingStore, "applyShortcut">;
}

/** `f`, `Escape`, `g`, `p` and Space are owned by the app shell; the full view must not consume them. */
export class KeyboardShortcutsController {
  /** Checked top to bottom; the first match wins. */
  private readonly shortcuts: readonly Shortcut[];

  constructor(private readonly targets: ShortcutTargets) {
    const { editing, navigation, panel, variants } = targets;
    this.shortcuts = [
      { keys: ["ArrowLeft"], run: () => navigation.go(-1) },
      { keys: ["ArrowRight"], run: () => navigation.go(1) },
      { keys: ["Delete", "Backspace"], run: () => void variants.deletePhoto() },
      { keys: ["i", "I"], editModeOnly: true, run: () => panel.toggleTab("info") },
      { keys: ["c", "C"], editModeOnly: true, run: () => editing.toggleToolById("crop") },
      { keys: ["b", "B"], editModeOnly: true, run: () => editing.toggleCard("tone") },
      { keys: ["u", "U"], editModeOnly: true, run: () => editing.toggleCard("curve") },
      { keys: ["x", "X"], editModeOnly: true, run: () => panel.toggleTab("post") },
      { keys: ["h", "H"], editModeOnly: true, run: () => editing.toggleCard("color") },
      { keys: ["m", "M"], editModeOnly: true, run: () => panel.openTab("post") },
    ];
  }

  handle(event: KeyboardEvent): void {
    if (this.typedIntoControl(event) || event.code === "Space") return;
    if (this.targets.stage.presenting) {
      this.handlePresentationKey(event);
      return;
    }
    const { editing } = this.targets;
    if (editing.handleToolKey(event)) return;
    if (event.key === "Escape" || event.key === "Enter") {
      editing.deactivateActiveTool();
      return;
    }
    if (this.handleClipboardKey(event) || this.runShortcut(event)) return;
    this.applyRating(event);
  }

  /** Text fields, selects and video controls own their keystrokes, for example while a preset is being named. */
  private typedIntoControl(event: KeyboardEvent): boolean {
    const origin = event.composedPath()[0];
    return (
      origin instanceof HTMLInputElement ||
      origin instanceof HTMLTextAreaElement ||
      origin instanceof HTMLSelectElement ||
      origin instanceof HTMLVideoElement ||
      (origin instanceof HTMLElement && origin.isContentEditable)
    );
  }

  private handlePresentationKey(event: KeyboardEvent): void {
    const modified = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
    if (modified || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    this.targets.navigation.go(event.key === "ArrowRight" ? 1 : -1);
  }

  private handleClipboardKey(event: KeyboardEvent): boolean {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "v") return false;
    const done = key === "c" ? this.targets.editing.copyEdits() : this.targets.editing.pasteEdits();
    if (done) event.preventDefault();
    return true;
  }

  private runShortcut(event: KeyboardEvent): boolean {
    const editMode = this.targets.stage.editable;
    const shortcut = this.shortcuts.find(
      (candidate) => (!candidate.editModeOnly || editMode) && candidate.keys.includes(event.key),
    );
    if (!shortcut) return false;
    event.preventDefault();
    shortcut.run();
    return true;
  }

  private applyRating(event: KeyboardEvent): void {
    const photo = this.targets.stage.currentPhoto;
    if (!photo || !RATING_LABEL_KEYS.has(event.key)) return;
    event.preventDefault();
    this.targets.ratings.applyShortcut([photo.path], event.key);
  }
}

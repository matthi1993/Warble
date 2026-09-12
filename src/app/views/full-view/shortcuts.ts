/**
 * Central registry for all keyboard shortcuts handled by the
 * full-screen viewer. Keeping every binding in one table makes it
 * easy to see at a glance which letters are taken, generate the hint
 * line in the stage, and avoid collisions when new tools land.
 *
 * App-shell-owned keys (`f`, `Escape`, `g`) are intentionally NOT
 * listed here — the shell handles them before the viewer does and we
 * must not consume them.
 */

import type { PfFullView } from "@app/full-view";

export interface ShortcutDef {
  /** Display string (e.g. "P", "←", "C"). Used by the in-stage hint
   *  + any future cheatsheet overlay. */
  readonly label: string;
  /** One or more KeyboardEvent.key values that trigger the action.
   *  Case-insensitive matching is handled by the dispatcher. */
  readonly keys: readonly string[];
  /** Short description for tooltips / hint string. */
  readonly description: string;
  /** True if the shortcut only fires while the viewer is in edit
   *  mode (i.e. the active variant is an editable format — JPEG or
   *  RAW). */
  readonly editModeOnly?: boolean;
  /** Imperative action against the viewer host. */
  readonly run: (host: PfFullView) => void;
}

/**
 * The single source of truth for full-view shortcuts. Add new tools
 * here; the dispatcher + hint line will pick them up automatically.
 *
 * Order matters: the dispatcher walks top-to-bottom and stops at the
 * first match.
 */
export function buildShortcuts(): readonly ShortcutDef[] {
  // We import lazily inside `run` callbacks so we don't form a
  // circular import at module evaluation time (full-view.ts imports
  // this module). Calls reach into private members of the host — we
  // use `any` to bypass the visibility check at compile time. The
  // shape is enforced by the host methods themselves at runtime.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const call = (host: PfFullView, fn: string, ...args: unknown[]) =>
    (host as any)[fn](...args);

  return [
    {
      label: "←",
      keys: ["ArrowLeft"],
      description: "Previous photo",
      run: (h) => call(h, "go", -1),
    },
    {
      label: "→",
      keys: ["ArrowRight"],
      description: "Next photo",
      run: (h) => call(h, "go", 1),
    },
    {
      label: "P",
      keys: ["p", "P"],
      description: "Cycle proof / fit",
      run: (h) => call(h, "cycleFit"),
    },
    {
      label: "⌫",
      keys: ["Delete", "Backspace"],
      description: "Delete photo",
      run: (h) => call(h, "deletePhoto"),
    },
    {
      label: "I",
      keys: ["i", "I"],
      description: "Info panel",
      editModeOnly: true,
      run: (h) => call(h, "toggleTab", "info"),
    },
    {
      label: "C",
      keys: ["c", "C"],
      description: "Crop tool",
      editModeOnly: true,
      run: (h) => call(h, "toggleToolById", "crop"),
    },
    {
      label: "B",
      keys: ["b", "B"],
      description: "Basic / tone",
      editModeOnly: true,
      run: (h) => call(h, "toggleToneCard"),
    },
    {
      label: "U",
      keys: ["u", "U"],
      description: "Tone curve",
      editModeOnly: true,
      run: (h) => call(h, "toggleCurveCard"),
    },
    {
      label: "X",
      keys: ["x", "X"],
      description: "Post-process panel",
      editModeOnly: true,
      run: (h) => call(h, "toggleTab", "post"),
    },
    {
      label: "H",
      keys: ["h", "H"],
      description: "Color (HSL)",
      editModeOnly: true,
      run: (h) => call(h, "toggleColorCard"),
    },
    {
      label: "M",
      keys: ["m", "M"],
      description: "Post curve",
      editModeOnly: true,
      run: (h) => call(h, "togglePostCurveCard"),
    },
  ];
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Build the human-readable hint string used by the stage overlay
 *  (the small grey help text under the photo). */
export function buildHintLine(
  shortcuts: readonly ShortcutDef[],
  extras: readonly string[] = []
): string {
  const parts = shortcuts.map((s) => `${s.label} ${s.description}`);
  return [...parts, ...extras].join(" · ");
}

/** Dispatch a keyboard event against the registry. Returns `true` if
 *  the event was consumed. */
export function dispatchShortcut(
  e: KeyboardEvent,
  shortcuts: readonly ShortcutDef[],
  host: PfFullView,
  isEditMode: boolean
): boolean {
  for (const s of shortcuts) {
    if (s.editModeOnly && !isEditMode) continue;
    if (!s.keys.includes(e.key)) continue;
    e.preventDefault();
    s.run(host);
    return true;
  }
  return false;
}

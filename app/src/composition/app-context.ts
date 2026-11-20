import { BusyState, TaskTracker } from "@warble/core";
import { EditingContext, RecipeBuilder, ToolRegistry } from "@warble/editing";
import type { Platform } from "../platform/platform";
import { CacheSettingsStore } from "../state/cache-settings-store";
import { SlideshowSettingsStore } from "../state/slideshow-settings-store";
import { ViewStateStore } from "../state/view-state-store";
import { LibraryServices } from "./library-services";
import { MediaServices } from "./media-services";

/** Creates every shared object once. Views read their dependencies from here. */
export class AppContext {
  readonly tasks = new TaskTracker();
  readonly busy = new BusyState(this.tasks);
  readonly cacheSettings: CacheSettingsStore;
  readonly viewState: ViewStateStore;
  readonly slideshow: SlideshowSettingsStore;
  readonly media: MediaServices;
  readonly library: LibraryServices;
  readonly editing: EditingContext;
  readonly recipes: RecipeBuilder;
  readonly tools = ToolRegistry.standard();

  constructor(readonly platform: Platform) {
    this.cacheSettings = new CacheSettingsStore(platform.settings);
    this.viewState = new ViewStateStore(platform.settings);
    this.slideshow = new SlideshowSettingsStore(platform.storage);
    this.media = new MediaServices(platform.images, this.tasks, this.cacheSettings);
    this.library = new LibraryServices(platform.library, this.tasks, this.media);
    this.editing = EditingContext.create(platform.edits, platform.storage);
    this.recipes = new RecipeBuilder(this.editing);
  }

  start(): void {
    void this.media.start();
    void this.editing.load();
  }
}

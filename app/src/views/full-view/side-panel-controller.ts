import type { StageModel } from "./stage-model";
import type { UpdateHost } from "./update-host";

export type SidePanelTab = "info" | "edit" | "post" | "slideshow";

export class SidePanelController {
  private tab: SidePanelTab | null = null;

  constructor(
    private readonly host: UpdateHost,
    private readonly stage: Pick<StageModel, "activeVideoPath">,
  ) {}

  get activeTab(): SidePanelTab | null {
    return this.tab;
  }

  get open(): boolean {
    return this.tab !== null;
  }

  get showsEditingTab(): boolean {
    return this.isEditingTab(this.tab);
  }

  isAvailable(tab: SidePanelTab): boolean {
    return !this.stage.activeVideoPath || !this.isEditingTab(tab);
  }

  openTab(tab: SidePanelTab): void {
    this.set(tab);
  }

  toggleTab(tab: SidePanelTab): void {
    if (!this.isAvailable(tab)) return;
    this.set(this.tab === tab ? null : tab);
  }

  closeEditingTabs(): void {
    if (this.showsEditingTab) this.set(null);
  }

  private isEditingTab(tab: SidePanelTab | null): boolean {
    return tab === "edit" || tab === "post";
  }

  private set(tab: SidePanelTab | null): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.host.requestUpdate();
  }
}

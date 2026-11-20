import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "@app/platform/settings-backend";
import { AppViewController } from "@app/shell/app-view-controller";
import { ShellState } from "@app/shell/shell-state";
import { CountingHost, createShellFixture, photo, settle } from "./support/shell-fakes";

function appViewFixture(persisted: AppViewState | null | Error) {
  const fixture = createShellFixture();
  const saved: AppViewState[] = [];
  const reloads: boolean[] = [];
  const settings = {
    getAppView: async () => {
      if (persisted instanceof Error) throw persisted;
      return persisted;
    },
    setAppView: async (view: AppViewState) => void saved.push(view),
  };
  const folderSelection = {
    reloadSelected: async () => {
      reloads.push(fixture.state.includeSubfolders);
      fixture.photoList.setPhotos([photo("/root/a.jpg"), photo("/root/sub/b.jpg")]);
    },
  };
  const appView = new AppViewController(fixture.state, settings, folderSelection);
  /** Stands in for the element's `updated()` callback after a render. */
  const rendered = () => appView.persistChanges(fixture.state.takeChanges());
  return { ...fixture, saved, reloads, appView, rendered };
}

describe("ShellState", () => {
  it("reports every field as changed for the first render", () => {
    const changes = new ShellState(new CountingHost()).takeChanges();
    expect(changes.has("imports")).toBe(true);
    expect(changes.get("fullViewIndex")).toBeUndefined();
  });

  it("requests a render only for real changes and remembers the value from before the batch", () => {
    const host = new CountingHost();
    const state = new ShellState(host);
    state.takeChanges();
    state.change({ fullViewIndex: null, sidebarCollapsed: false });
    expect(host.updates).toBe(0);
    state.change({ fullViewIndex: 2 });
    state.change({ fullViewIndex: 5, detailOpen: true });
    expect(host.updates).toBe(2);
    const changes = state.takeChanges();
    expect([...changes.keys()]).toEqual(["fullViewIndex", "detailOpen"]);
    expect(changes.get("fullViewIndex")).toBeNull();
    expect(state.takeChanges().size).toBe(0);
  });
});

describe("AppViewController", () => {
  it("restores the panels, the selected photo and the full view", async () => {
    const { state, appView } = appViewFixture({
      path: "/root/b.jpg",
      view: "full",
      sidebarCollapsed: true,
      editPanelOpen: true,
      includeSubfolders: false,
    });
    state.change({ selectedFolderId: "/root", photos: [photo("/root/a.jpg"), photo("/root/b.jpg")] });
    await appView.restore();
    expect(state).toMatchObject({ sidebarCollapsed: true, editPanelOpen: true, includeSubfolders: false });
    expect(state.selectedPhoto?.path).toBe("/root/b.jpg");
    expect(state.fullViewIndex).toBe(1);
  });

  it("loads the subfolder photos before looking for the persisted photo", async () => {
    const { state, reloads, appView } = appViewFixture({ path: "/root/sub/b.jpg", view: "grid", includeSubfolders: true });
    state.change({ selectedFolderId: "/root", photos: [photo("/root/a.jpg")] });
    await appView.restore();
    expect(reloads).toEqual([true]);
    expect(state.selectedPhoto?.path).toBe("/root/sub/b.jpg");
    expect(state.fullViewIndex).toBeNull();
  });

  it("ignores a persisted photo that is no longer listed and non-boolean flags", async () => {
    const { state, reloads, appView } = appViewFixture({ path: "/gone.jpg", view: "full", sidebarCollapsed: null });
    state.change({ photos: [photo("/root/a.jpg")] });
    await appView.restore();
    expect(state.selectedPhoto).toBeNull();
    expect(state.fullViewIndex).toBeNull();
    expect(state.sidebarCollapsed).toBe(false);
    expect(reloads).toEqual([]);
  });

  it("does not write anything back before the persisted view was read", async () => {
    const { state, saved, appView, rendered } = appViewFixture(null);
    state.change({ sidebarCollapsed: true });
    rendered();
    await appView.restore();
    rendered();
    await settle();
    expect(saved).toEqual([]);
  });

  it("saves the view whenever the photo, the surface or a panel changes", async () => {
    const { state, saved, appView, rendered } = appViewFixture(null);
    const shown = photo("/root/a.jpg");
    await appView.restore();
    state.takeChanges();

    state.change({ photos: [shown], filterMetadataLoading: true, detailOpen: true });
    rendered();
    await settle();
    expect(saved).toEqual([]);

    state.change({ selectedPhoto: shown, fullViewIndex: 0 });
    rendered();
    state.change({ fullViewIndex: null, sidebarCollapsed: true, editPanelOpen: true, includeSubfolders: true });
    rendered();
    await settle();
    expect(saved).toEqual([
      { path: "/root/a.jpg", view: "full", sidebarCollapsed: false, editPanelOpen: false, includeSubfolders: false },
      { path: "/root/a.jpg", view: "grid", sidebarCollapsed: true, editPanelOpen: true, includeSubfolders: true },
    ]);
  });

  it("still saves later changes when the persisted view cannot be read", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { state, saved, appView, rendered } = appViewFixture(new Error("store unavailable"));
    await appView.restore();
    state.takeChanges();
    state.change({ sidebarCollapsed: true });
    rendered();
    await settle();
    expect(saved).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith("Failed to restore last view", expect.any(Error));
    errors.mockRestore();
  });
});

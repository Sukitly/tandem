import { createStore } from "zustand/vanilla";
import type { ChangeTarget } from "@/changes/change-target.ts";
import { readPreference, writePreference } from "@/lib/preferences.ts";
import { navigate, parseRoute, type Route, routeHash } from "./navigation.ts";
import { type PanelTab, userPreferences } from "./user-preferences.ts";

export type { PanelTab } from "./user-preferences.ts";
export function panelTabOf(value: unknown): PanelTab {
  return userPreferences.panelTab.parse(typeof value === "string" ? value : null);
}

export interface WorkbenchState {
  selected: number | null;
  draft: number | null;
  adding: boolean;
  filesShown: boolean;
  showHiddenFiles: boolean;
  panelTab: PanelTab;
  changeTarget: ChangeTarget | null;
  mobile: boolean;
  select(id: number | null): void;
  newConversation(workspaceId: number): void;
  followRoute(route: Route): void;
  setMobile(mobile: boolean): void;
  showFiles(shown: boolean): void;
  showTab(tab: PanelTab): void;
  setShowHiddenFiles(show: boolean): void;
  addProject(): void;
  setAdding(adding: boolean): void;
  revealChange(target: ChangeTarget): void;
  forgetChangeTarget(): void;
}

/** A scoped UI store. Server catalogs and snapshots remain outside Zustand. Actions have stable identities. */
export function createWorkbenchStore(mobile: boolean, hash = "") {
  const route = parseRoute(hash);
  return createStore<WorkbenchState>()((set, get) => ({
    selected: route.kind === "conversation" ? route.id : null,
    draft: null,
    adding: false,
    mobile,
    filesShown: !mobile && readPreference(userPreferences.filesShown),
    panelTab: readPreference(userPreferences.panelTab),
    showHiddenFiles: readPreference(userPreferences.showHiddenFiles),
    changeTarget: null,
    select(id) {
      set({ selected: id, draft: null });
      navigate(routeHash(id === null ? { kind: "none" } : { kind: "conversation", id }) || "/");
    },
    newConversation(workspaceId) {
      set({ selected: null, draft: workspaceId });
      navigate("/");
    },
    followRoute(route) {
      if (route.kind === "conversation") set({ selected: route.id, draft: null });
      else if (route.kind === "none") set({ selected: null });
    },
    setMobile(mobile) {
      if (get().mobile === mobile) return;
      set({ mobile, filesShown: !mobile && readPreference(userPreferences.filesShown) });
    },
    showFiles(filesShown) {
      if (!get().mobile) writePreference(userPreferences.filesShown, filesShown);
      set({ filesShown });
    },
    showTab(panelTab) {
      writePreference(userPreferences.panelTab, panelTab);
      set({ panelTab });
    },
    setShowHiddenFiles(showHiddenFiles) {
      writePreference(userPreferences.showHiddenFiles, showHiddenFiles);
      set({ showHiddenFiles });
    },
    addProject: () => set({ adding: true }),
    setAdding: (adding) => set({ adding }),
    revealChange(changeTarget) {
      get().showFiles(true);
      get().showTab("changes");
      set({ changeTarget });
    },
    forgetChangeTarget: () => set({ changeTarget: null }),
  }));
}
export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>;

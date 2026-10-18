import { createStore } from "zustand/vanilla";
import type { ChangeTarget } from "@/changes/change-target.ts";
import { preferences } from "@/lib/preferences.ts";
import { navigate, parseRoute, type Route, routeHash } from "./navigation.ts";

export type PanelTab = "files" | "changes" | "terminal" | "preview";
export function panelTabOf(value: unknown): PanelTab {
  return value === "changes" || value === "terminal" || value === "preview" ? value : "files";
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
    filesShown: !mobile && preferences.getItem("tandem.filesShown") !== "false",
    panelTab: panelTabOf(preferences.getItem("tandem.panelTab")),
    showHiddenFiles: preferences.getItem("tandem.showHiddenFiles") === "true",
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
      set({ mobile, filesShown: !mobile && preferences.getItem("tandem.filesShown") !== "false" });
    },
    showFiles(filesShown) {
      if (!get().mobile) preferences.setItem("tandem.filesShown", String(filesShown));
      set({ filesShown });
    },
    showTab(panelTab) {
      preferences.setItem("tandem.panelTab", panelTab);
      set({ panelTab });
    },
    setShowHiddenFiles(showHiddenFiles) {
      preferences.setItem("tandem.showHiddenFiles", String(showHiddenFiles));
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

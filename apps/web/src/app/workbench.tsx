import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { ChangeTarget } from "@/changes/change-target.ts";
import type { ProjectComments } from "@/comments/project-comments.ts";
import type { OpenedFile, ProjectFiles } from "@/files/project-files.ts";
import { useDisposable } from "@/hooks/use-disposable.ts";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { AddProjectDialog } from "./add-project-dialog.tsx";
import { ProjectResources } from "./project-resources.ts";
import { SnapshotProvider } from "./query-client.tsx";
import { createWorkbenchStore, type WorkbenchState, type WorkbenchStore } from "./workbench-store.ts";

export { panelTabOf } from "./workbench-store.ts";

/** The files and comments of each project, kept as long as the project is listed. */
interface ProjectResourceAccess {
  files(workspaceId: number): ProjectFiles;
  comments(workspaceId: number): ProjectComments;
}

/** Ways to take the panel to a place: the file or the change a message or a comment is about. */
interface PanelNavigation {
  openFile(path: string, place?: Omit<OpenedFile, "path">): void;
  openChange(target: Omit<ChangeTarget, "workspaceId">): void;
}

const Context = createContext<{
  store: WorkbenchStore;
  resources: ProjectResourceAccess;
  navigation: PanelNavigation;
  workspaceId: number | null;
} | null>(null);

function useWorkbenchContext() {
  const context = useContext(Context);
  if (context === null) throw new Error("The workbench must be used inside WorkbenchProvider");
  return context;
}

/** The workbench's own UI state: select only what a component uses. Nothing here is the server's, or the address's. */
export function useWorkbench(): WorkbenchState;
export function useWorkbench<T>(select: (state: WorkbenchState) => T): T;
export function useWorkbench<T>(select?: (state: WorkbenchState) => T): T | WorkbenchState {
  const { store } = useWorkbenchContext();
  return useStore(
    store,
    useShallow((state) => (select === undefined ? state : select(state))),
  );
}

/** The files and comments of a project, which survive the project's panel being closed or its page being left. */
export function useProjectResources(): ProjectResourceAccess {
  return useWorkbenchContext().resources;
}

export function usePanelNavigation(): PanelNavigation {
  return useWorkbenchContext().navigation;
}

/** The project the open page is about, if it is about one: what the panel beside the page shows. */
export function useOpenWorkspaceId(): number | null {
  return useWorkbenchContext().workspaceId;
}

/** `workspaceId` is the project the page that is open is about, which the workbench's panel shows. */
export function WorkbenchProvider({
  workspaceId = null,
  children,
}: {
  workspaceId?: number | null;
  children: ReactNode;
}) {
  return (
    <SnapshotProvider>
      <WorkbenchSession workspaceId={workspaceId}>{children}</WorkbenchSession>
    </SnapshotProvider>
  );
}

function WorkbenchSession({ workspaceId, children }: { workspaceId: number | null; children: ReactNode }) {
  const { workspaces, files, comments } = useConnected();
  const client = useQueryClient();
  const mobile = useIsMobile();
  const [store] = useState(() => createWorkbenchStore(mobile));
  const [registry] = useState(() => new ProjectResources(files, comments, client));
  const listed = useReplicatedState(workspaces.state)?.workspaces;

  useEffect(() => store.getState().setMobile(mobile), [store, mobile]);
  useEffect(() => {
    if (listed !== undefined) registry.retain(listed.map((workspace) => workspace.id));
  }, [listed, registry]);
  useDisposable(registry);

  const resources = useMemo<ProjectResourceAccess>(
    () => ({ files: (id) => registry.get(id).files, comments: (id) => registry.get(id).comments }),
    [registry],
  );
  const navigation = useMemo<PanelNavigation>(
    () => ({
      openFile(path, place) {
        if (workspaceId === null) return;
        store.getState().showFiles(true);
        store.getState().showTab("files");
        registry.get(workspaceId).files.open(path, place);
      },
      openChange(target) {
        if (workspaceId !== null) store.getState().revealChange({ workspaceId, ...target });
      },
    }),
    [registry, store, workspaceId],
  );
  const value = useMemo(
    () => ({ store, resources, navigation, workspaceId }),
    [store, resources, navigation, workspaceId],
  );
  return (
    <Context.Provider value={value}>
      {children}
      <ProjectDialog />
    </Context.Provider>
  );
}

function ProjectDialog() {
  const { adding, setAdding } = useWorkbench((state) => ({ adding: state.adding, setAdding: state.setAdding }));
  return <AddProjectDialog open={adding} onOpenChange={setAdding} />;
}

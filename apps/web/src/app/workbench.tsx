import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { useRoute } from "./navigation.ts";
import { ProjectResources } from "./project-resources.ts";
import { errorMessage, SnapshotProvider } from "./query-client.tsx";
import { createWorkbenchStore, type WorkbenchState, type WorkbenchStore } from "./workbench-store.ts";

export { type PanelTab, panelTabOf } from "./workbench-store.ts";

interface WorkbenchActions {
  projectFiles(workspaceId: number): ProjectFiles;
  comments(workspaceId: number): ProjectComments;
  openFile(path: string, place?: Omit<OpenedFile, "path">): void;
  openChange(target: Omit<ChangeTarget, "workspaceId">): void;
  removeProject(workspaceId: number): void;
  renameConversation(id: number, title: string): Promise<void>;
  removeConversation(id: number): Promise<void>;
  reportFailure(title: string, error: unknown): void;
}
type Workbench = WorkbenchState & WorkbenchActions & { workspaceId: number | null };
const Context = createContext<{
  store: WorkbenchStore;
  actions: WorkbenchActions;
  workspaceId: number | null;
} | null>(null);

/** Select only the state and actions a component uses. The context itself never carries a UI snapshot. */
export function useWorkbench(): Workbench;
export function useWorkbench<T>(select: (state: Workbench) => T): T;
export function useWorkbench<T>(select?: (state: Workbench) => T): T | Workbench {
  const context = useContext(Context);
  if (context === null) throw new Error("useWorkbench() must be used inside WorkbenchProvider");
  const { store, actions, workspaceId } = context;
  return useStore(
    store,
    useShallow((state) => {
      const value = { ...state, ...actions, workspaceId };
      return select === undefined ? value : select(value);
    }),
  );
}

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  return (
    <SnapshotProvider>
      <WorkbenchSession>{children}</WorkbenchSession>
    </SnapshotProvider>
  );
}

function WorkbenchSession({ children }: { children: ReactNode }) {
  const { workspaces, conversations, files, comments } = useConnected();
  const client = useQueryClient();
  const mobile = useIsMobile();
  const route = useRoute();
  const [store] = useState(() => createWorkbenchStore(mobile, window.location.hash));
  const [resources] = useState(() => new ProjectResources(files, comments, client));
  const selected = useStore(store, (state) => state.selected);
  const draft = useStore(store, (state) => state.draft);
  const listed = useReplicatedState(workspaces.state)?.workspaces;
  const summaries = useReplicatedState(conversations.state)?.conversations;
  const workspaceId = draft ?? summaries?.find((summary) => summary.id === selected)?.workspaceId ?? null;

  useEffect(() => store.getState().setMobile(mobile), [store, mobile]);
  useEffect(() => store.getState().followRoute(route), [store, route]);
  useEffect(() => {
    if (listed !== undefined) resources.retain(listed.map((workspace) => workspace.id));
  }, [listed, resources]);
  useEffect(() => {
    if (selected !== null && summaries !== undefined && !summaries.some((summary) => summary.id === selected))
      store.getState().select(null);
  }, [selected, summaries, store]);
  useDisposable(resources);

  const actions = useMemo<WorkbenchActions>(() => {
    const reportFailure = (title: string, error: unknown) => toast.error(title, { description: errorMessage(error) });
    const command = async (title: string, run: () => Promise<void>) => {
      try {
        await run();
      } catch (error) {
        reportFailure(title, error);
        throw error;
      }
    };
    return {
      projectFiles: (id) => resources.get(id).files,
      comments: (id) => resources.get(id).comments,
      reportFailure,
      openFile(path, place) {
        if (workspaceId === null) return;
        store.getState().showFiles(true);
        store.getState().showTab("files");
        resources.get(workspaceId).files.open(path, place);
      },
      openChange(target) {
        if (workspaceId !== null) store.getState().revealChange({ workspaceId, ...target });
      },
      removeProject(id) {
        const before = store.getState();
        void command("Could not remove the project", async () => {
          await workspaces.remove(id, BACKGROUND_CONTEXT);
          const after = store.getState();
          if (workspaceId === id && after.selected === before.selected && after.draft === before.draft)
            after.select(null);
        }).catch(() => {});
      },
      renameConversation: (id, title) =>
        command("Could not rename the conversation", () => conversations.rename(id, title, BACKGROUND_CONTEXT)),
      removeConversation: (id) =>
        command("Could not delete the conversation", async () => {
          await conversations.remove(id, BACKGROUND_CONTEXT);
          if (store.getState().selected === id) store.getState().select(null);
        }),
    };
  }, [resources, store, workspaceId, workspaces, conversations]);
  const value = useMemo(() => ({ store, actions, workspaceId }), [store, actions, workspaceId]);
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

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { useConnected } from "@/rpc/connection.tsx";
import { AddProjectDialog } from "./add-project-dialog.tsx";

const LAST_WORKSPACE_KEY = "tandem.lastWorkspace";

/** Something the user asked for that did not happen. */
export interface Failure {
  title: string;
  message: string;
}

interface Workbench {
  /** The open conversation, kept in the URL hash so that reloads and links keep it. */
  selected: number | null;
  select(id: number | null): void;
  /** A conversation is being created; until it exists, no conversation is shown, so typing cannot reach the old one. */
  starting: boolean;
  startConversation(workspaceId: number): void;
  /** The project a conversation was last started in, or the last one added. It may have been removed since. */
  lastWorkspaceId: number | undefined;
  addProject(): void;
  /** Takes the project off the list, and closes its conversation if it is the open one. */
  removeProject(workspaceId: number): void;
  failure: Failure | null;
  dismissFailure(): void;
}

const WorkbenchContext = createContext<Workbench | null>(null);

export function useWorkbench(): Workbench {
  const workbench = useContext(WorkbenchContext);
  if (workbench === null) throw new Error("useWorkbench() must be used inside WorkbenchProvider");
  return workbench;
}

/** The app's navigation state and the actions that change it. */
export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const { workspaces, conversations } = useConnected();
  const [selected, setSelected] = useState(selectedInHash);
  const [starting, setStarting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lastWorkspaceId, setLastWorkspaceId] = useState(storedWorkspaceId);

  useEffect(() => {
    const onChange = (): void => setSelected(selectedInHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // The state changes along with the hash, so the new conversation shows in the same render that ends `starting`.
  const select = (id: number | null): void => {
    setSelected(id);
    window.location.hash = id === null ? "" : String(id);
  };
  const remember = (workspaceId: number): void => {
    localStorage.setItem(LAST_WORKSPACE_KEY, String(workspaceId));
    setLastWorkspaceId(workspaceId);
  };

  const workbench: Workbench = {
    selected,
    select,
    starting,
    startConversation(workspaceId) {
      if (starting) return;
      setStarting(true);
      setFailure(null);
      conversations.create({ workspaceId }, BACKGROUND_CONTEXT).then(
        (id) => {
          remember(workspaceId);
          select(id);
          setStarting(false);
        },
        (error: unknown) => {
          setFailure({ title: "Could not start a conversation", message: messageOf(error) });
          setStarting(false);
        },
      );
    },
    lastWorkspaceId,
    addProject: () => setAdding(true),
    removeProject(workspaceId) {
      const open = conversations.state.value?.conversations.find((summary) => summary.id === selected);
      workspaces.remove(workspaceId, BACKGROUND_CONTEXT).then(
        () => {
          if (open?.workspaceId === workspaceId) select(null);
        },
        (error: unknown) => setFailure({ title: "Could not remove the project", message: messageOf(error) }),
      );
    },
    failure,
    dismissFailure: () => setFailure(null),
  };

  return (
    <WorkbenchContext.Provider value={workbench}>
      {children}
      <AddProjectDialog open={adding} onOpenChange={setAdding} onAdded={remember} />
    </WorkbenchContext.Provider>
  );
}

function selectedInHash(): number | null {
  return parseId(window.location.hash.slice(1)) ?? null;
}

function storedWorkspaceId(): number | undefined {
  return parseId(localStorage.getItem(LAST_WORKSPACE_KEY) ?? "");
}

function parseId(text: string): number | undefined {
  const id = Number(text);
  return text !== "" && Number.isSafeInteger(id) && id >= 0 ? id : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

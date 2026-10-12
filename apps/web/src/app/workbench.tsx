import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { ProjectFiles } from "@/files/project-files.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { AddProjectDialog } from "./add-project-dialog.tsx";

const LAST_WORKSPACE_KEY = "tandem.lastWorkspace";
const FILES_SHOWN_KEY = "tandem.filesShown";

/** Something the user asked for that did not happen. */
export interface Failure {
  title: string;
  message: string;
}

interface Workbench {
  /** The open conversation, kept in the URL hash so that reloads and links keep it. */
  selected: number | null;
  select(id: number | null): void;
  /**
   * The project of the new conversation being written, if one is. Nothing exists on the server until its first
   * message is sent, so it has no ID and is not in the URL.
   */
  draft: number | null;
  newConversation(workspaceId: number): void;
  /** The project of the open conversation, or of the new one. */
  workspaceId: number | null;
  /** The files panel is shown; the user's choice, kept across reloads. */
  filesShown: boolean;
  showFiles(shown: boolean): void;
  /** What the files panel shows of a project, kept while the page is open. */
  projectFiles(workspaceId: number): ProjectFiles;
  /** Show a file of the current project in the files panel, at a line if one is given. */
  openFile(path: string, line?: number): void;
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
  const { workspaces, conversations, files } = useConnected();
  const [selected, setSelected] = useState(selectedInHash);
  const [draft, setDraft] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lastWorkspaceId, setLastWorkspaceId] = useState(storedWorkspaceId);
  const [filesShown, setFilesShown] = useState(() => localStorage.getItem(FILES_SHOWN_KEY) !== "false");
  const [projects] = useState(() => new Map<number, ProjectFiles>());
  const summaries = useReplicatedState(conversations.state)?.conversations;
  const workspaceId = draft ?? summaries?.find((summary) => summary.id === selected)?.workspaceId ?? null;

  useEffect(() => {
    const onChange = (): void => {
      const id = selectedInHash();
      setSelected(id);
      // Following a link to a conversation leaves the new one. Clearing the hash for a new one must not.
      if (id !== null) setDraft(null);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // The state changes along with the hash, so a started conversation replaces the new one in a single render.
  const select = (id: number | null): void => {
    setSelected(id);
    setDraft(null);
    window.location.hash = id === null ? "" : String(id);
  };
  const remember = (workspaceId: number): void => {
    localStorage.setItem(LAST_WORKSPACE_KEY, String(workspaceId));
    setLastWorkspaceId(workspaceId);
  };

  const projectFiles = (id: number): ProjectFiles => {
    let project = projects.get(id);
    if (project === undefined) {
      project = new ProjectFiles(files, id);
      projects.set(id, project);
    }
    return project;
  };
  const showFiles = (shown: boolean): void => {
    localStorage.setItem(FILES_SHOWN_KEY, String(shown));
    setFilesShown(shown);
  };

  const workbench: Workbench = {
    selected,
    select,
    draft,
    newConversation(id) {
      select(null);
      setDraft(id);
      remember(id);
    },
    workspaceId,
    filesShown,
    showFiles,
    projectFiles,
    openFile(path, line) {
      if (workspaceId === null) return;
      showFiles(true);
      projectFiles(workspaceId).open(path, line);
    },
    lastWorkspaceId,
    addProject: () => setAdding(true),
    removeProject(id) {
      workspaces.remove(id, BACKGROUND_CONTEXT).then(
        () => {
          if (workspaceId === id) select(null);
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

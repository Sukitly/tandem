import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ChangeTarget } from "@/changes/change-target.ts";
import { ProjectComments } from "@/comments/project-comments.ts";
import { type OpenedFile, ProjectFiles } from "@/files/project-files.ts";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { preferences } from "@/lib/preferences.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { AddProjectDialog } from "./add-project-dialog.tsx";
import { navigate, subscribeNavigation } from "./navigation.ts";

const FILES_SHOWN_KEY = "tandem.filesShown";
const PANEL_TAB_KEY = "tandem.panelTab";
const SHOW_HIDDEN_FILES_KEY = "tandem.showHiddenFiles";

/** The view of the panel beside the conversation. */
export type PanelTab = "files" | "changes" | "terminal" | "preview";

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
  /** The panel beside the conversation is shown; the user's choice, kept across reloads. */
  filesShown: boolean;
  showFiles(shown: boolean): void;
  /** Whether hidden/excluded files (such as `.git`) are shown in the files tree. */
  showHiddenFiles: boolean;
  setShowHiddenFiles(show: boolean): void;
  /** Which view of the panel is shown, kept across reloads. Opening a file shows its own. */
  panelTab: PanelTab;
  showTab(tab: PanelTab): void;
  /** Show a place of the project's changes in the panel: the file's diff, at the line. */
  openChange(target: Omit<ChangeTarget, "workspaceId">): void;
  /** What the changes panel was last asked to show. Each request is a new object, so asking again shows it again. */
  changeTarget: ChangeTarget | null;
  /** The request is settled: it was shown, or the changes had nothing to show it in. */
  forgetChangeTarget(): void;
  /** What the files panel shows of a project, kept while the page is open. */
  projectFiles(workspaceId: number): ProjectFiles;
  /** The comment threads of a project. */
  comments(workspaceId: number): ProjectComments;
  /** Show a file of the current project in the files panel, at a line or a comment thread if one is given. */
  openFile(path: string, place?: Omit<OpenedFile, "path">): void;
  addProject(): void;
  /** Takes the project off the list, and closes its conversation if it is the open one. */
  removeProject(workspaceId: number): void;
  /** Renames a conversation. */
  renameConversation(id: number, title: string): Promise<void>;
  /** Removes a conversation. Closes it if it is the open one. */
  removeConversation(id: number): Promise<void>;
  failure: Failure | null;
  /** Show that something the user asked for did not happen. */
  reportFailure(title: string, error: unknown): void;
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
  const { workspaces, conversations, files, comments: commentService } = useConnected();
  const [selected, setSelected] = useState(selectedInHash);
  const [draft, setDraft] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const isMobile = useIsMobile();
  const [filesShown, setFilesShown] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      return false;
    }
    return preferences.getItem(FILES_SHOWN_KEY) !== "false";
  });
  const wasMobile = useRef(isMobile);
  useEffect(() => {
    if (isMobile && !wasMobile.current) {
      setFilesShown(false);
    } else if (!isMobile && wasMobile.current) {
      setFilesShown(preferences.getItem(FILES_SHOWN_KEY) !== "false");
    }
    wasMobile.current = isMobile;
  }, [isMobile]);
  const [showHiddenFiles, setShowHiddenFilesState] = useState(() => {
    return typeof window !== "undefined" && preferences.getItem(SHOW_HIDDEN_FILES_KEY) === "true";
  });
  const [panelTab, setPanelTab] = useState<PanelTab>(() => panelTabOf(preferences.getItem(PANEL_TAB_KEY)));
  const [changeTarget, setChangeTarget] = useState<ChangeTarget | null>(null);
  const [projects] = useState(() => new Map<number, ProjectFiles>());
  const [comments] = useState(() => new Map<number, ProjectComments>());
  const summaries = useReplicatedState(conversations.state)?.conversations;
  const listed = useReplicatedState(workspaces.state)?.workspaces;
  useEffect(() => {
    if (listed === undefined) return;
    const existing = new Set(listed.map((workspace) => workspace.id));
    for (const [id, project] of projects)
      if (!existing.has(id)) {
        project.close();
        projects.delete(id);
      }
    for (const id of comments.keys()) if (!existing.has(id)) comments.delete(id);
  }, [listed, projects, comments]);
  const workspaceId = draft ?? summaries?.find((summary) => summary.id === selected)?.workspaceId ?? null;

  // The state changes along with the hash, so a started conversation replaces the new one in a single render.
  const select = useCallback((id: number | null): void => {
    setSelected(id);
    setDraft(null);
    navigate(id === null ? window.location.pathname + window.location.search : `#${id}`);
  }, []);

  useEffect(() => {
    const onChange = (): void => {
      // Public access hides the workbench; it must not clear its conversation or new-conversation draft.
      if (window.location.hash === "#public-access") return;
      const id = selectedInHash();
      setSelected(id);
      // Following a link to a conversation leaves the new one. Clearing the hash for a new one must not.
      if (id !== null) setDraft(null);
    };
    return subscribeNavigation(onChange);
  }, []);

  useEffect(() => {
    if (selected !== null && summaries !== undefined && !summaries.some((summary) => summary.id === selected)) {
      select(null);
    }
  }, [selected, summaries, select]);

  const projectFiles = (id: number): ProjectFiles => {
    let project = projects.get(id);
    if (project === undefined) {
      project = new ProjectFiles(files, id);
      projects.set(id, project);
    }
    return project;
  };
  const projectComments = (id: number): ProjectComments => {
    let project = comments.get(id);
    if (project === undefined) {
      project = new ProjectComments(commentService, id);
      comments.set(id, project);
    }
    return project;
  };
  const showFiles = (shown: boolean): void => {
    if (!isMobile) {
      preferences.setItem(FILES_SHOWN_KEY, String(shown));
    }
    setFilesShown(shown);
  };
  const showTab = (tab: PanelTab): void => {
    preferences.setItem(PANEL_TAB_KEY, tab);
    setPanelTab(tab);
  };
  const setShowHiddenFiles = (show: boolean): void => {
    if (typeof window !== "undefined") {
      preferences.setItem(SHOW_HIDDEN_FILES_KEY, String(show));
    }
    setShowHiddenFilesState(show);
  };

  const workbench: Workbench = {
    selected,
    select,
    draft,
    newConversation(id) {
      select(null);
      setDraft(id);
    },
    workspaceId,
    filesShown,
    showFiles,
    showHiddenFiles,
    setShowHiddenFiles,
    panelTab,
    showTab,
    changeTarget,
    forgetChangeTarget: () => setChangeTarget(null),
    openChange(target) {
      if (workspaceId === null) return;
      showFiles(true);
      showTab("changes");
      setChangeTarget({ workspaceId, ...target });
    },
    projectFiles,
    comments: projectComments,
    openFile(path, place) {
      if (workspaceId === null) return;
      showFiles(true);
      // A file is shown in the files tab: opening it under another tab would show nothing.
      showTab("files");
      projectFiles(workspaceId).open(path, place);
    },
    addProject: () => setAdding(true),
    removeProject(id) {
      workspaces.remove(id, BACKGROUND_CONTEXT).then(
        () => {
          if (workspaceId === id) select(null);
        },
        (error: unknown) => {
          toast.error("Could not remove the project", { description: messageOf(error) });
        },
      );
    },
    async renameConversation(id, title) {
      try {
        await conversations.rename(id, title, BACKGROUND_CONTEXT);
      } catch (error) {
        toast.error("Could not rename the conversation", { description: messageOf(error) });
        throw error;
      }
    },
    async removeConversation(id) {
      try {
        await conversations.remove(id, BACKGROUND_CONTEXT);
        if (selected === id) select(null);
      } catch (error) {
        toast.error("Could not delete the conversation", { description: messageOf(error) });
        throw error;
      }
    },
    failure: null,
    reportFailure(title, error) {
      toast.error(title, { description: messageOf(error) });
    },
    dismissFailure() {},
  };

  return (
    <WorkbenchContext.Provider value={workbench}>
      {children}
      <AddProjectDialog open={adding} onOpenChange={setAdding} />
    </WorkbenchContext.Provider>
  );
}

/** A stored tab, or the files for anything else. */
export function panelTabOf(value: unknown): PanelTab {
  return value === "changes" || value === "terminal" || value === "preview" ? value : "files";
}

function selectedInHash(): number | null {
  return parseId(window.location.hash.slice(1)) ?? null;
}

function parseId(text: string): number | undefined {
  const id = Number(text);
  return text !== "" && Number.isSafeInteger(id) && id >= 0 ? id : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

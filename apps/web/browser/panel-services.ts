import type { Comments, Files } from "@tandem/contracts";
import { createContext, createElement, type ReactNode, useContext, useEffect, useState } from "react";
import { ProjectComments } from "../src/comments/project-comments.ts";
import { ProjectFiles } from "../src/files/project-files.ts";

// Service boundaries only: the real project toolbar, file tree, changes view, and preview frames are rendered.
const noSubscription = () => () => {};
const files = new ProjectFiles({ list: async () => [] } as unknown as Files, 1);
const comments = new ProjectComments(
  { state: { value: { threads: [] }, subscribe: noSubscription } } as unknown as Comments,
  1,
);
const connected = {
  terminals: {
    state: {
      value: {
        terminals: [
          { id: "one", title: "Shell one", workspaceId: 1 },
          { id: "two", title: "Shell two", workspaceId: 2 },
        ],
      },
      subscribe: noSubscription,
    },
  },
  openTerminal: (_id: string, sink: { write(data: string): void }, options: { onLink?(link: "open"): void }) => {
    document.body.dataset.terminalOpens = String(Number(document.body.dataset.terminalOpens ?? 0) + 1);
    options.onLink?.("open");
    sink.write("Fixture shell\r\n");
    return {
      input: (data: string) => sink.write(data),
      inputBinary: () => {},
      resize: () => {},
      reconnect: () => {},
      close: () => {
        document.body.dataset.terminalCloses = String(Number(document.body.dataset.terminalCloses ?? 0) + 1);
      },
    };
  },
  preview: {
    state: {
      value: {
        ports: [
          { port: 5173, detectedAt: 0 },
          { port: 8080, detectedAt: 0 },
        ],
      },
      subscribe: noSubscription,
    },
    register: async () => {},
    unregister: async () => {},
  },
};
export const useConnected = () => connected;
export const useOptionalConnected = () => connected;
export function useProjectChanges(workspaceId: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const key = `changesHold${workspaceId}`;
    document.body.dataset[key] = String(Number(document.body.dataset[key] ?? 0) + 1);
    return () => {
      document.body.dataset[key] = String(Number(document.body.dataset[key]) - 1);
    };
  }, [workspaceId, enabled]);
  return undefined;
}
export const useProjectChangesFailure = () => null;
export const panelTabOf = (value: string) => value;
function useWorkbenchValue() {
  const [filesShown, showFiles] = useState(true);
  const [panelTab, showTab] = useState("files");
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  return {
    panelTab,
    showTab,
    filesShown,
    showFiles,
    showHiddenFiles,
    setShowHiddenFiles,
    projectFiles: () => files,
    comments: () => comments,
    reportFailure: () => {},
  };
}
const WorkbenchContext = createContext<ReturnType<typeof useWorkbenchValue> | null>(null);
export function WorkbenchFixtureProvider({ children }: { children: ReactNode }) {
  return createElement(WorkbenchContext.Provider, { value: useWorkbenchValue() }, children);
}
export function useWorkbench() {
  const value = useContext(WorkbenchContext);
  if (value === null) throw new Error("Fixture provider missing");
  return value;
}

import type { ReactNode } from "react";
import { useOpenWorkspaceId, usePanelNavigation } from "@/app/workbench.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { type FileTarget, projectPath } from "./file-link.ts";

/** A link in a message to a file of the current project: it opens the file in the files panel, at the line if given. */
export function FileLink({ target, children }: { target: FileTarget; children: ReactNode }) {
  const workspaceId = useOpenWorkspaceId();
  const { openFile } = usePanelNavigation();
  const { workspaces } = useConnected();
  const project = useReplicatedState(workspaces.state)?.workspaces.find((candidate) => candidate.id === workspaceId);
  const path = project === undefined ? undefined : projectPath(target.path, project.path);
  // Outside the project, there is nothing to open.
  if (path === undefined) return children;
  return (
    <button
      type="button"
      className="cursor-pointer appearance-none text-left font-medium wrap-anywhere text-primary underline"
      title={target.line === undefined ? path : `${path}:${target.line}`}
      onClick={() => openFile(path, target.line === undefined ? {} : { line: target.line })}
    >
      {children}
    </button>
  );
}

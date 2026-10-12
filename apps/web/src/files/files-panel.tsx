import { AlertCircleIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useWorkbench } from "@/app/workbench.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ancestors, FileTree } from "./file-tree.tsx";
import { FileView } from "./file-view.tsx";

/**
 * The current project's files: the tree, and under it the opened file. Both are read from disk when they open and
 * when the user refreshes; they do not follow changes by themselves.
 */
export function FilesPanel({ workspaceId }: { workspaceId: number }) {
  const { workspaces } = useConnected();
  const project = useReplicatedState(workspaces.state)?.workspaces.find((candidate) => candidate.id === workspaceId);
  const { openedFile, openFile, closeFile } = useWorkbench();
  const file = openedFile?.workspaceId === workspaceId ? openedFile : null;
  const [expanded, setExpanded] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // A file opened from a message shows in the tree too: its directories open.
  useEffect(() => {
    if (file === null) return;
    setExpanded((current) => [...new Set([...current, ...ancestors(file.path)])]);
  }, [file]);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Files">
      <header className="flex h-9 shrink-0 items-center gap-1 px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={project?.path}>
          {project?.name ?? "Files"}
        </h2>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Refresh"
                onClick={() => {
                  setError(null);
                  setRefresh((count) => count + 1);
                }}
              />
            }
          >
            <RotateCwIcon />
          </TooltipTrigger>
          <TooltipContent>Read the files again</TooltipContent>
        </Tooltip>
      </header>
      {error !== null && (
        <div className="px-2 pb-2">
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Cannot list a directory</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <AlertAction>
              <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setError(null)}>
                <XIcon />
              </Button>
            </AlertAction>
          </Alert>
        </div>
      )}
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="tree" minSize={80} className="overflow-auto">
          <FileTree
            key={refresh}
            workspaceId={workspaceId}
            expanded={expanded}
            onExpandedChange={setExpanded}
            selected={file?.path}
            reveal={file?.request ?? 0}
            onOpen={(path) => openFile(path)}
            onError={setError}
          />
        </ResizablePanel>
        {file !== null && (
          <>
            <ResizableHandle />
            <ResizablePanel id="file" defaultSize="60" minSize={120}>
              <FileView
                workspaceId={workspaceId}
                path={file.path}
                line={file.line}
                request={file.request}
                refresh={refresh}
                onClose={closeFile}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </section>
  );
}
